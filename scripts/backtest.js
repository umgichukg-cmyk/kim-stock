// 백테스트: "전일 미국장에서 오른 테마 → 한국 관련주를 다음 날 시가에 매수"를 과거 데이터로 검증
//
// 실행: node scripts/backtest.js [--from 2025-11-03] [--to 2026-10-30] [--cost 0.25] [--top 4]
//
// 규칙 (화면과 같은 규칙을 그날 기준으로 다시 계산)
// - 한국 거래일 D의 기준 미국장 = 뉴욕 날짜가 D보다 앞선 마지막 거래일 (한국 아침이면 이미 마감된 장)
// - 그 미국장에서 평균 등락이 플러스인 테마만, 상승률 높은 순으로 최대 --top 개
// - 그 테마의 한국 종목 점수는 D 전날까지의 일봉·수급으로만 계산 (미래 데이터 사용 안 함)
// - 기본(재무) 점수는 과거 시점 데이터가 없어 빼고, 기술 45 + 수급 45를 100점으로 환산
// - D 시가에 사서 N거래일째 종가에 판다고 가정. 왕복 비용 --cost % 차감
//
// 받아온 데이터는 .cache/backtest/ 에 저장해서 다시 실행할 때 재사용합니다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES } from "../config/themes.js";
import { fetchJson, toNumber } from "../api/_lib/http.js";
import { scoreStock } from "../api/_lib/score.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CACHE = join(ROOT, ".cache", "backtest");
const OUT = join(ROOT, "backtest-results");

// ---------- 옵션 ----------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
const today = new Date();
const yearAgo = new Date(today.getTime() - 365 * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);
const FROM = args.from || iso(yearAgo);
const TO = args.to || iso(today);
const COST = Number(args.cost ?? 0.25); // 왕복 비용 % (세금 + 수수료 + 약간의 체결 오차)
const TOP = Number(args.top ?? 4);
const HOLDS = [1, 2, 3, 5]; // 보유 거래일 수 (1 = 당일 시가 매수 → 당일 종가 매도)

const NAVER = { Referer: "https://m.stock.naver.com/" };

// ---------- 캐시 ----------
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

async function pool(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

const ymd = (s) => s.replace(/-/g, "");
const dash = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

// ---------- 데이터 받기 ----------

// 미국 종목 일별 등락률 { "YYYY-MM-DD": pct }
async function usDaily(symbol) {
  return cached(`us-${symbol}`, async () => {
    const j = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`);
    const r = j.chart.result[0];
    const tz = r.meta.exchangeTimezoneName || "America/New_York";
    const closes = r.indicators.quote[0].close;
    const out = {};
    let prev = null;
    r.timestamp.forEach((t, i) => {
      const c = closes[i];
      if (c == null) return;
      const date = new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: tz });
      if (prev != null) out[date] = ((c - prev) / prev) * 100;
      prev = c;
    });
    return out;
  });
}

// 한국 종목 일봉 (오래된 순)
async function krCandles(code, fromYmd) {
  return cached(`kr-candle-${code}-${fromYmd}`, async () => {
    const rows = await fetchJson(
      `https://api.stock.naver.com/chart/domestic/item/${code}/day?startDateTime=${fromYmd}0000&endDateTime=${ymd(TO)}2359`,
      { headers: NAVER }
    );
    return rows
      .map((r) => ({
        date: String(r.localDate),
        open: r.openPrice,
        high: r.highPrice,
        low: r.lowPrice,
        close: r.closePrice,
        volume: r.accumulatedTradingVolume,
      }))
      .filter((r) => r.close > 0 && r.open > 0);
  });
}

// 투자자별 순매수: 한 번에 60일씩, 날짜를 지정해 과거로 이어 받기 (오래된 순)
async function krFlows(code, fromYmd) {
  return cached(`kr-flow-${code}-${fromYmd}`, async () => {
    const all = new Map();
    let bizdate = null;
    for (let page = 0; page < 12; page++) {
      const url = `https://m.stock.naver.com/api/stock/${code}/trend?pageSize=60${bizdate ? `&bizdate=${bizdate}` : ""}`;
      const rows = await fetchJson(url, { headers: NAVER });
      if (!Array.isArray(rows) || !rows.length) break;
      for (const r of rows) {
        const close = toNumber(r.closePrice) ?? 0;
        const foreign = toNumber(r.foreignerPureBuyQuant) ?? 0;
        const institution = toNumber(r.organPureBuyQuant) ?? 0;
        const individual = toNumber(r.individualPureBuyQuant) ?? 0;
        all.set(r.bizdate, {
          date: r.bizdate,
          close,
          foreignAmt: foreign * close,
          institutionAmt: institution * close,
          individualAmt: individual * close,
        });
      }
      const oldest = rows.at(-1).bizdate;
      if (oldest <= fromYmd) break;
      // 가장 오래된 날 하루 전부터 다시
      const d = new Date(`${dash(oldest)}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      bizdate = ymd(iso(d));
    }
    return [...all.values()].sort((a, b) => a.date.localeCompare(b.date));
  });
}

// ---------- 통계 ----------

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const fmt = (v, d = 2) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const pad = (s, n) => {
  const str = String(s);
  const w = [...str].reduce((acc, ch) => acc + (/[ㄱ-힝]/.test(ch) ? 2 : 1), 0);
  return str + " ".repeat(Math.max(0, n - w));
};

function summarize(trades, hold) {
  const rets = trades.map((t) => t.ret[hold]).filter((v) => v != null);
  return {
    trades: rets.length,
    avg: mean(rets),
    win: rets.length ? (rets.filter((v) => v > 0).length / rets.length) * 100 : null,
  };
}

// 매일 같은 금액으로 나눠 사서 당일 종가에 판다고 가정한 누적 수익률과 최대 낙폭 (1일 보유만)
function equityCurve(trades, days) {
  let equity = 1;
  let peak = 1;
  let mdd = 0;
  let traded = 0;
  for (const d of days) {
    const today = trades.filter((t) => t.date === d && t.ret[1] != null);
    if (!today.length) continue;
    traded++;
    equity *= 1 + mean(today.map((t) => t.ret[1])) / 100;
    peak = Math.max(peak, equity);
    mdd = Math.min(mdd, (equity - peak) / peak);
  }
  return { total: (equity - 1) * 100, mdd: mdd * 100, traded };
}

// ---------- 실행 ----------

async function main() {
  const warmup = new Date(new Date(FROM).getTime() - 150 * 86400000); // 60일선 계산용 여유
  const fromYmd = ymd(iso(warmup));
  const stocks = [...new Map(THEMES.flatMap((t) => t.kr.map((k) => [k.code, k]))).values()];
  const usSymbols = [...new Set(THEMES.flatMap((t) => t.us))];

  console.log(`기간 ${FROM} ~ ${TO} · 왕복 비용 ${COST}% · 상승 테마 최대 ${TOP}개`);
  console.log(`데이터 받는 중: 미국 ${usSymbols.length}종목, 한국 ${stocks.length}종목 (처음 한 번만 오래 걸려요)`);

  const us = Object.fromEntries(await pool(usSymbols, 4, async (s) => [s, await usDaily(s).catch(() => ({}))]));
  const kr = Object.fromEntries(
    await pool(stocks, 3, async (k) => {
      const [candles, flows] = await Promise.all([krCandles(k.code, fromYmd), krFlows(k.code, fromYmd).catch(() => [])]);
      return [k.code, { ...k, candles, flows }];
    })
  );

  // 미국 거래일 목록 (뉴욕 날짜)
  const usDates = [...new Set(Object.values(us).flatMap((m) => Object.keys(m)))].sort();
  // 한국 거래일 목록: 삼성전자 일봉 기준
  const krDays = (kr["005930"]?.candles || Object.values(kr)[0].candles)
    .map((c) => c.date)
    .filter((d) => d >= ymd(FROM) && d <= ymd(TO));

  const trades = { rising: [], allDays: [], falling: [] };
  const themeLog = [];

  for (const D of krDays) {
    const usDate = usDates.filter((d) => d < dash(D)).at(-1);
    if (!usDate) continue;

    // 그 미국장 테마별 평균 등락
    const ranked = THEMES.map((t) => {
      const v = t.us.map((s) => us[s]?.[usDate]).filter((x) => x != null);
      return { theme: t, avg: v.length ? mean(v) : null };
    })
      .filter((t) => t.avg != null)
      .sort((a, b) => b.avg - a.avg);
    const rising = ranked.filter((t) => t.avg > 0).slice(0, TOP);
    const falling = ranked.filter((t) => t.avg < 0);
    themeLog.push({ date: D, usDate, rising: rising.map((t) => `${t.theme.name} ${fmt(t.avg)}`) });

    const evaluate = (code, themeName, themeAvg) => {
      const s = kr[code];
      const i = s.candles.findIndex((c) => c.date === D);
      if (i < 61) return null; // 지표 계산에 필요한 과거 일봉 부족
      const past = s.candles.slice(0, i);
      const pastFlows = s.flows.filter((f) => f.date < D);
      const score = scoreStock(past, pastFlows, null).total;
      const entry = s.candles[i].open;
      const ret = {};
      for (const h of HOLDS) {
        const exit = s.candles[i + h - 1];
        ret[h] = exit ? ((exit.close - entry) / entry) * 100 - COST : null;
      }
      const gap = ((entry - past.at(-1).close) / past.at(-1).close) * 100;
      return { date: D, usDate, code, name: s.name, theme: themeName, themeAvg, score, gap, ret };
    };

    const seen = new Set();
    for (const t of rising) {
      for (const k of t.theme.kr) {
        if (seen.has(k.code)) continue;
        seen.add(k.code);
        const r = evaluate(k.code, t.theme.name, t.avg);
        if (r) trades.rising.push(r);
      }
    }
    for (const t of falling) for (const k of t.theme.kr) {
      const r = evaluate(k.code, t.theme.name, t.avg);
      if (r) trades.falling.push(r);
    }
    for (const k of stocks) {
      const r = evaluate(k.code, "-", null);
      if (r) trades.allDays.push(r);
    }
  }

  // 전략별 거래 목록
  const byDay = (list, pickFn) => krDays.flatMap((d) => pickFn(list.filter((t) => t.date === d)));
  const strategies = [
    ["① 상승 테마 종목 전부", trades.rising],
    ["② 상승 테마 중 점수 상위 3", byDay(trades.rising, (l) => [...l].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3))],
    ["③ 상승 테마 중 60점 이상", trades.rising.filter((t) => (t.score ?? 0) >= 60)],
    ["④ 상승 테마 중 75점 이상", trades.rising.filter((t) => (t.score ?? 0) >= 75)],
    ["⑤ 비교: 하락 테마 종목", trades.falling],
    ["⑥ 비교: 매일 전체 종목", trades.allDays],
  ];

  console.log(`\n한국 거래일 ${krDays.length}일 분석 완료\n`);
  console.log("[전략별 결과] 시가 매수 → N거래일째 종가 매도, 비용 차감 후 1회 평균 수익률 (승률)");
  console.log(pad("전략", 30) + HOLDS.map((h) => pad(`${h}일 보유`, 20)).join("") + "거래수");
  const report = [];
  for (const [name, list] of strategies) {
    const cols = HOLDS.map((h) => summarize(list, h));
    const curve = equityCurve(list, krDays);
    report.push({ name, cols, curve });
    console.log(pad(name, 30) + cols.map((c) => pad(`${fmt(c.avg)} (${c.win?.toFixed(0) ?? "-"}%)`, 20)).join("") + cols[0].trades);
  }

  console.log("\n[1일 보유를 매일 반복했을 때] 누적 수익률 · 최대 낙폭 · 매매한 날");
  for (const r of report) {
    console.log(pad(r.name, 30) + pad(fmt(r.curve.total, 1), 12) + pad(fmt(r.curve.mdd, 1), 12) + `${r.curve.traded}일`);
  }

  console.log("\n[점수 구간별] 상승 테마 종목의 1일 보유 평균 수익률 (점수가 쓸모 있는지)");
  const bands = [[0, 45, "45점 미만"], [45, 60, "45~59점"], [60, 75, "60~74점"], [75, 101, "75점 이상"]];
  for (const [lo, hi, label] of bands) {
    const l = trades.rising.filter((t) => t.score != null && t.score >= lo && t.score < hi);
    const s1 = summarize(l, 1);
    const s3 = summarize(l, 3);
    console.log(pad(label, 12) + pad(`1일 ${fmt(s1.avg)} (${s1.win?.toFixed(0) ?? "-"}%)`, 24) + pad(`3일 ${fmt(s3.avg)}`, 16) + `${s1.trades}건`);
  }

  const gaps = trades.rising.map((t) => t.gap);
  const gapsAll = trades.allDays.map((t) => t.gap);
  console.log("\n[시초가 갭] 전일 종가 대비 시가 (이미 오른 채 시작하는지)");
  console.log(`상승 테마 종목 평균 ${fmt(mean(gaps))} · 전체 종목 평균 ${fmt(mean(gapsAll))}`);

  // 전일 종가 → 당일 종가 (비용 제외). 신호가 나오기 전에 살 수는 없어서 실제 매매는 불가능하지만,
  // 미국 신호가 한국 주가에 영향을 주는지 자체를 보여줌
  const closeToClose = (list) => mean(list.map((t) => t.ret[1] + COST + t.gap + (t.ret[1] + COST) * t.gap / 100));
  console.log("\n[신호 효과] 전일 종가 → 당일 종가 평균 (비용 제외, 실제 매매 불가 · 참고용)");
  console.log(`상승 테마 종목 ${fmt(closeToClose(trades.rising))} · 하락 테마 종목 ${fmt(closeToClose(trades.falling))} · 전체 종목 ${fmt(closeToClose(trades.allDays))}`);

  await mkdir(OUT, { recursive: true });
  const stamp = `${FROM}_${TO}`;
  await writeFile(join(OUT, `summary-${stamp}.json`), JSON.stringify({ FROM, TO, COST, TOP, days: krDays.length, report, themeLog }, null, 2));
  const csv = ["날짜,미국장,테마,테마등락,종목,코드,점수,시초가갭,1일,2일,3일,5일"]
    .concat(
      trades.rising.map((t) =>
        [t.date, t.usDate, t.theme, t.themeAvg?.toFixed(2), t.name, t.code, t.score, t.gap.toFixed(2), ...HOLDS.map((h) => t.ret[h]?.toFixed(2) ?? "")].join(",")
      )
    )
    .join("\n");
  await writeFile(join(OUT, `trades-${stamp}.csv`), "﻿" + csv);
  console.log(`\n거래 내역: backtest-results/trades-${stamp}.csv`);
}

main().catch((e) => {
  console.error("백테스트 실패:", e.message);
  process.exit(1);
});
