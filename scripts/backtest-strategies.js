// 연구에서 많이 언급되는 매매 전략을 한국 시장 전체 데이터로 비교하는 백테스트
//
// 실행: node scripts/backtest-strategies.js [--from 2025-01-02] [--to 2026-10-30] [--n 20] [--cost 0.25] [--min-value 10]
//
// 전략 (매월 첫 거래일 시가에 바꿔 담고, 다음 달 첫 거래일 시가에 판다고 가정, 같은 금액씩 나눠 담기)
//   1. 52주 신고가 근접: 전날 종가 ÷ 52주(250거래일) 최고가 가 가장 높은 N종목
//   2. 저변동성: 최근 60거래일 일간 수익률 표준편차가 가장 낮은 N종목
//   3. 모멘텀(12-1): 12개월 전 → 1개월 전 수익률이 가장 높은 N종목 (최근 1개월은 제외)
//   4. 밤사이 보유: 매일 종가에 대상 종목 전부를 사서 다음 날 시가에 팔기
//   비교: 코스피·코스닥 지수 보유, 대상 종목 전체를 같은 금액씩 매월 담기
//
// 대상: 매번 그 시점 기준 20일 평균 거래대금 --min-value 억 원 이상인 코스피·코스닥 보통주 (우선주·스팩·ETF 제외)
// 신호는 항상 매매일 "전날"까지의 데이터로만 계산 (미래 데이터 사용 안 함)
// 비용: 종목을 새로 살 때마다 왕복 --cost % 차감 (계속 보유하는 종목은 비용 없음)
//
// 받은 데이터는 .cache/strategies/ 에 저장해서 다시 실행할 때 재사용합니다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson } from "../api/_lib/http.js";
import { listMarket } from "../api/_lib/naver.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CACHE = join(ROOT, ".cache", "strategies");
const OUT = join(ROOT, "backtest-results");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
const FROM = (args.from || "2025-01-02").replace(/-/g, "");
const TO = (args.to || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
const N = Number(args.n ?? 20);
const COST = Number(args.cost ?? 0.25) / 100;
const MIN_VALUE = Number(args["min-value"] ?? 10) * 1e8;
const DATA_FROM = "20231201"; // 52주 최고가·12개월 모멘텀 계산용 과거 데이터
const NAVER = { Referer: "https://m.stock.naver.com/" };

// ---------- 데이터 ----------

async function cached(name, loader) {
  const file = join(CACHE, `${name}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    const data = await loader();
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, JSON.stringify(data));
    return data;
  }
}

async function pool(items, size, fn, label) {
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]).catch(() => null);
      if (++done % 500 === 0) console.log(`  ${label} ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: size }, worker));
  return out;
}

// 종목 일봉 → { 날짜: [시가, 고가, 저가, 종가, 거래량] }
async function candles(code) {
  return cached(`kr-${code}-${DATA_FROM}-${TO}`, async () => {
    const rows = await fetchJson(
      `https://api.stock.naver.com/chart/domestic/item/${code}/day?startDateTime=${DATA_FROM}0000&endDateTime=${TO}2359`,
      { headers: NAVER }
    );
    const out = {};
    for (const r of rows) if (r.closePrice > 0 && r.openPrice > 0) out[r.localDate] = [r.openPrice, r.highPrice, r.lowPrice, r.closePrice, r.accumulatedTradingVolume];
    return out;
  });
}

// 지수 일봉 (Yahoo)
async function indexCandles(symbol) {
  return cached(`idx-${symbol.replace(/\W/g, "")}-${TO}`, async () => {
    const j = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`);
    const r = j.chart.result[0];
    const q = r.indicators.quote[0];
    const out = {};
    r.timestamp.forEach((t, i) => {
      if (q.open[i] == null || q.close[i] == null) return;
      const d = new Date((t + 9 * 3600) * 1000).toISOString().slice(0, 10).replace(/-/g, "");
      out[d] = [q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i] ?? 0];
    });
    return out;
  });
}

// ---------- 통계 ----------

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const std = (a) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};
const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "-" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const pad = (s, n) => {
  const str = String(s);
  const w = [...str].reduce((acc, ch) => acc + (/[ㄱ-힝]/.test(ch) ? 2 : 1), 0);
  return str + " ".repeat(Math.max(0, n - w));
};

// 날짜별 자산 가치 기록 → 수익률·최대 낙폭·반기별 수익률
function stats(curve, days, half) {
  const total = curve.at(-1).nav / curve[0].nav - 1;
  const years = days.length / 245;
  let peak = -Infinity;
  let mdd = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.nav);
    mdd = Math.min(mdd, p.nav / peak - 1);
  }
  const navAt = (d) => {
    let last = curve[0].nav;
    for (const p of curve) {
      if (p.date > d) break;
      last = p.nav;
    }
    return last;
  };
  const h1 = navAt(half) / curve[0].nav - 1;
  const h2 = curve.at(-1).nav / navAt(half) - 1;
  // 월별 수익률로 승률
  const months = {};
  for (const p of curve) months[p.date.slice(0, 6)] = p.nav;
  const mvals = Object.values(months);
  const mrets = mvals.slice(1).map((v, i) => v / mvals[i] - 1);
  const win = mrets.length ? mrets.filter((r) => r > 0).length / mrets.length : null;
  return { total, cagr: (1 + total) ** (1 / years) - 1, mdd, h1, h2, win };
}

// ---------- 실행 ----------

async function main() {
  console.log(`기간 ${FROM} ~ ${TO} · 전략별 ${N}종목 · 왕복 비용 ${(COST * 100).toFixed(2)}% · 거래대금 ${MIN_VALUE / 1e8}억 이상`);

  const list = await cached(`list-${TO}`, async () => [...(await listMarket("KOSPI")), ...(await listMarket("KOSDAQ"))]);
  const universe = list.filter((s) => s.type === "stock" && /0$/.test(s.code) && !s.name.includes("스팩"));
  console.log(`대상 보통주 ${universe.length}개 일봉 받는 중 (처음 한 번만 오래 걸려요)`);
  const data = await pool(universe, 8, async (s) => ({ ...s, c: await candles(s.code) }), "일봉");
  const stocks = data.filter((s) => s && Object.keys(s.c).length > 30);
  const kospi = await indexCandles("^KS11");
  const kosdaq = await indexCandles("^KQ11");

  // 거래일 달력: 삼성전자 기준
  const calendar = Object.keys(stocks.find((s) => s.code === "005930").c).sort();
  const idxOf = Object.fromEntries(calendar.map((d, i) => [d, i]));
  const days = calendar.filter((d) => d >= FROM && d <= TO);
  const half = days[Math.floor(days.length / 2)];

  // 종목별로 달력 순서 배열 만들기 (없는 날은 null)
  for (const s of stocks) s.bars = calendar.map((d) => s.c[d] ?? null);

  // 그날(i) 이전까지의 데이터로 계산하는 지표들
  const lastClose = (s, i) => {
    for (let k = i - 1; k >= 0; k--) if (s.bars[k]) return s.bars[k][3];
    return null;
  };
  const avgValue = (s, i) => {
    const b = s.bars.slice(Math.max(0, i - 20), i).filter(Boolean);
    return b.length >= 15 ? mean(b.map((x) => x[3] * x[4])) : 0;
  };
  const near52w = (s, i) => {
    const b = s.bars.slice(Math.max(0, i - 250), i).filter(Boolean);
    if (b.length < 200) return null;
    return b.at(-1)[3] / Math.max(...b.map((x) => x[1]));
  };
  const vol60 = (s, i) => {
    const b = s.bars.slice(Math.max(0, i - 61), i).filter(Boolean);
    if (b.length < 55) return null;
    const r = b.slice(1).map((x, k) => x[3] / b[k][3] - 1);
    return std(r);
  };
  const mom12_1 = (s, i) => {
    if (i < 250) return null;
    const a = s.bars[i - 250];
    const b = s.bars[i - 21];
    return a && b ? b[3] / a[3] - 1 : null;
  };

  // 매월 첫 거래일
  const rebalance = days.filter((d, k) => k === 0 || d.slice(0, 6) !== days[k - 1].slice(0, 6));

  // 월간 리밸런싱 전략 실행: pick(eligible, i) → 고른 종목 배열
  function runMonthly(name, pick, limit = N) {
    let nav = 1;
    const curve = [{ date: days[0], nav }];
    let held = new Set();
    let turnover = 0;
    for (let r = 0; r < rebalance.length; r++) {
      const i = idxOf[rebalance[r]];
      const end = r + 1 < rebalance.length ? idxOf[rebalance[r + 1]] : idxOf[days.at(-1)] + 1;
      const eligible = stocks.filter((s) => s.bars[i] && avgValue(s, i) >= MIN_VALUE);
      const chosen = pick(eligible, i).slice(0, limit);
      if (!chosen.length) continue;
      const newOnes = chosen.filter((s) => !held.has(s.code)).length;
      turnover += newOnes / chosen.length;
      const costNow = (newOnes / chosen.length) * COST;
      const entry = chosen.map((s) => s.bars[i][0]);
      // 보유 기간 중 매일 종가로 평가
      for (let k = i; k < end && k < calendar.length; k++) {
        const v = mean(chosen.map((s, j) => (lastClose(s, k + 1) ?? entry[j]) / entry[j]));
        curve.push({ date: calendar[k], nav: nav * (1 - costNow) * v });
      }
      // 다음 리밸런싱일 시가에 매도 (마지막 기간은 마지막 날 종가)
      const exit = chosen.map((s, j) => {
        if (end < calendar.length && s.bars[end]) return s.bars[end][0];
        return lastClose(s, Math.min(end, calendar.length)) ?? entry[j];
      });
      nav = nav * (1 - costNow) * mean(exit.map((x, j) => x / entry[j]));
      held = new Set(chosen.map((s) => s.code));
    }
    curve.push({ date: days.at(-1), nav });
    return { name, curve, turnover: turnover / rebalance.length };
  }

  const results = [];
  results.push(runMonthly(`① 52주 신고가 근접 상위 ${N}`, (el, i) =>
    el.map((s) => ({ s, v: near52w(s, i) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v).map((x) => x.s)));
  results.push(runMonthly(`② 저변동성 상위 ${N}`, (el, i) =>
    el.map((s) => ({ s, v: vol60(s, i) })).filter((x) => x.v != null && x.v > 0).sort((a, b) => a.v - b.v).map((x) => x.s)));
  results.push(runMonthly(`③ 모멘텀(12-1) 상위 ${N}`, (el, i) =>
    el.map((s) => ({ s, v: mom12_1(s, i) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v).map((x) => x.s)));

  // ④ 밤사이 보유: 매일 종가 매수 → 다음 날 시가 매도 (대상 전체 같은 금액씩)
  {
    let nav = 1;
    let gross = 1;
    let intra = 1;
    const curve = [{ date: days[0], nav }];
    for (let k = 1; k < days.length; k++) {
      const i = idxOf[days[k]];
      const el = stocks.filter((s) => s.bars[i] && s.bars[i - 1] && avgValue(s, i) >= MIN_VALUE);
      const on = mean(el.map((s) => s.bars[i][0] / s.bars[i - 1][3] - 1));
      const id = mean(el.map((s) => s.bars[i][3] / s.bars[i][0] - 1));
      nav *= 1 + on - COST;
      gross *= 1 + on;
      intra *= 1 + id;
      curve.push({ date: days[k], nav });
    }
    results.push({ name: "④ 밤사이 보유 (종가 매수→시가 매도)", curve, turnover: 1, extra: { gross: gross - 1, intra: intra - 1 } });
  }

  // 비교 기준
  const indexCurve = (name, idx) => {
    const ds = days.filter((d) => idx[d]);
    const base = idx[ds[0]][0];
    return { name, curve: ds.map((d) => ({ date: d, nav: idx[d][3] / base })), turnover: 0 };
  };
  results.push(indexCurve("비교: 코스피 지수 보유", kospi));
  results.push(indexCurve("비교: 코스닥 지수 보유", kosdaq));
  results.push(runMonthly("비교: 대상 종목 전체 같은 금액씩", (el) => el, Infinity));

  // ---------- 출력 ----------
  console.log(`\n거래일 ${days.length}일 (${days[0]} ~ ${days.at(-1)}) · 전반기/후반기 경계 ${half} · 월 리밸런싱 ${rebalance.length}회`);
  console.log(
    "\n" + pad("전략", 40) + pad("누적", 10) + pad("연환산", 10) + pad("최대낙폭", 10) + pad("전반기", 10) + pad("후반기", 10) + pad("월승률", 8) + "월교체율"
  );
  const rows = [];
  for (const r of results) {
    const st = stats(r.curve, days, half);
    rows.push({ name: r.name, ...st, turnover: r.turnover, extra: r.extra });
    console.log(
      pad(r.name, 40) + pad(pct(st.total), 10) + pad(pct(st.cagr), 10) + pad(pct(st.mdd), 10) + pad(pct(st.h1), 10) + pad(pct(st.h2), 10) +
        pad(st.win == null ? "-" : `${(st.win * 100).toFixed(0)}%`, 8) + (r.turnover ? `${(r.turnover * 100).toFixed(0)}%` : "-")
    );
  }
  const on = results.find((r) => r.extra);
  console.log(`\n④ 참고: 비용 빼기 전 밤사이 누적 ${pct(on.extra.gross)} · 같은 종목 장중(시가→종가) 누적 ${pct(on.extra.intra)}`);
  console.log(`④ 비용이 0이 되는 손익분기 비용: 하루 평균 밤사이 수익률 ${pct((1 + on.extra.gross) ** (1 / days.length) - 1, 3)}`);

  // 최근 리밸런싱 때 고른 종목 (참고)
  const lastI = idxOf[rebalance.at(-1)];
  const el = stocks.filter((s) => s.bars[lastI] && avgValue(s, lastI) >= MIN_VALUE);
  const top = (fn, asc) => el.map((s) => ({ s, v: fn(s, lastI) })).filter((x) => x.v != null).sort((a, b) => (asc ? a.v - b.v : b.v - a.v)).slice(0, 5).map((x) => x.s.name);
  console.log(`\n${rebalance.at(-1)} 기준 상위 5 예시`);
  console.log(`  52주 신고가 근접: ${top(near52w).join(", ")}`);
  console.log(`  저변동성: ${top((s, i) => { const v = vol60(s, i); return v > 0 ? v : null; }, true).join(", ")}`);
  console.log(`  모멘텀: ${top(mom12_1).join(", ")}`);

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, `strategies-${FROM}-${TO}.json`), JSON.stringify({ FROM, TO, N, COST, rows }, null, 2));
  console.log(`\n저장: backtest-results/strategies-${FROM}-${TO}.json`);
}

main().catch((e) => {
  console.error("백테스트 실패:", e.stack || e.message);
  process.exit(1);
});
