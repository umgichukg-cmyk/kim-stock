// 한국 시장 전체 종목 점수 계산 → 상위 30개를 JSON으로 저장
//
// 실행: node scripts/scan-market.js [--out data/top30.json] [--history data/history.json] [--top 30] [--min-value 10]
//
// - 대상: 코스피·코스닥 일반 주식 (ETF·ETN·우선주·스팩·거래정지 제외)
// - 20일 평균 거래대금이 --min-value 억 원 미만이면 제외 (거래가 적으면 점수가 왜곡되기 쉬움)
// - 마지막으로 끝난 한국 장 기준: 장중에 실행하면 진행 중인 오늘 데이터는 뺌
// - 점수는 화면과 같은 기준 (기술 45 + 수급 45 + 기본 10)
// - 날짜별 상위 종목을 history 파일에 쌓아서, 거래일 기준 연속 상위 진입 일수(streak)를 계산
// GitHub Actions가 매일 장 마감 후 실행해서 data 브랜치에 결과를 올립니다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listMarket, getDailyCandles, getInvestorFlows, getFundamentals } from "../api/_lib/naver.js";
import { scoreStock } from "../api/_lib/score.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
const OUT = join(ROOT, args.out || "data/top30.json");
const HISTORY = join(ROOT, args.history || join(dirname(args.out || "data/top30.json"), "history.json"));
const HISTORY_DAYS = 60; // 기록을 남길 거래일 수
const TOP = Number(args.top ?? 30);
const MIN_VALUE = Number(args["min-value"] ?? 10) * 1e8; // 원
const CONCURRENCY = 8;

// 한국 시간 기준 오늘 날짜와, 오늘 장이 끝났는지 (16:00 이후면 종가 확정으로 봄)
function koreaNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return { today: `${parts.year}${parts.month}${parts.day}`, closed: Number(parts.hour) * 60 + Number(parts.minute) >= 16 * 60 };
}

async function pool(items, size, fn, label) {
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]).catch((e) => ({ error: e.message }));
      if (++done % 200 === 0) console.log(`  ${label} ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: size }, worker));
  return out;
}

async function main() {
  const started = Date.now();
  const { today, closed } = koreaNow();
  const dropToday = (rows) => (!closed && rows.at(-1)?.date === today ? rows.slice(0, -1) : rows);

  // 1) 종목 목록과 제외
  const list = [...(await listMarket("KOSPI")), ...(await listMarket("KOSDAQ"))];
  const stocks = list.filter((s) => s.type === "stock");
  const excluded = {
    "ETF·ETN": list.length - stocks.length,
    우선주: stocks.filter((s) => !/0$/.test(s.code)).length,
    스팩: stocks.filter((s) => s.name.includes("스팩")).length,
    거래정지: stocks.filter((s) => s.halted).length,
  };
  const universe = stocks.filter((s) => /0$/.test(s.code) && !s.name.includes("스팩") && !s.halted);
  console.log(`전체 ${list.length}개 중 계산 대상 ${universe.length}개 (제외: ${JSON.stringify(excluded)})`);

  // 2) 일봉 받아서 거래대금으로 거르기
  console.log("일봉 받는 중...");
  const withCandles = await pool(
    universe,
    CONCURRENCY,
    async (s) => {
      const candles = dropToday(await getDailyCandles(s.code));
      const recent = candles.slice(-20);
      const avgValue = recent.length ? recent.reduce((t, c) => t + c.close * c.volume, 0) / recent.length : 0;
      return { ...s, candles, avgValue };
    },
    "일봉"
  );
  const failedCandles = withCandles.filter((s) => s.error).length;
  const liquid = withCandles.filter((s) => !s.error && s.candles.length >= 25 && s.avgValue >= MIN_VALUE);
  excluded[`20일 평균 거래대금 ${MIN_VALUE / 1e8}억 미만·신규상장`] = withCandles.length - failedCandles - liquid.length;

  // 기준일: 가장 많은 종목의 마지막 일봉 날짜
  const counts = {};
  liquid.forEach((s) => (counts[s.candles.at(-1).date] = (counts[s.candles.at(-1).date] || 0) + 1));
  const basisDate = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  console.log(`기준일 ${basisDate} · 거래대금 조건 통과 ${liquid.length}개`);

  // 3) 수급·재무 받아서 점수 계산
  console.log("수급·재무 받는 중...");
  const scored = await pool(
    liquid,
    CONCURRENCY,
    async (s) => {
      const [flows, fundamentals] = await Promise.all([
        getInvestorFlows(s.code, 20).then(dropToday).catch(() => []),
        getFundamentals(s.code).catch(() => null),
      ]);
      const score = scoreStock(s.candles, flows, fundamentals);
      const last = s.candles.at(-1);
      const prev = s.candles.at(-2);
      return {
        code: s.code,
        name: s.name,
        market: s.market,
        date: last.date,
        price: last.close,
        changePct: prev ? ((last.close - prev.close) / prev.close) * 100 : null,
        avgValue: Math.round(s.avgValue / 1e8), // 억 원
        score: {
          total: score.total,
          grade: score.grade,
          complete: score.complete,
          technical: { score: score.technical.score, max: score.technical.max },
          supply: { score: score.supply.score, max: score.supply.max },
          basic: { score: score.basic.score, max: score.basic.max },
        },
        spark: s.candles.slice(-30).map((c) => c.close),
      };
    },
    "점수"
  );

  // 기준일에 거래된 종목만, 점수 높은 순 (같으면 거래대금 큰 순)
  const ranked = scored
    .filter((s) => !s.error && s.score.total != null && s.date === basisDate)
    .sort((a, b) => b.score.total - a.score.total || b.avgValue - a.avgValue);

  const top = ranked.slice(0, TOP);

  // 4) 날짜별 기록에 오늘 결과를 넣고 연속 진입 일수 계산
  //    거래일 달력은 일봉 날짜로 만들어서, 주말·휴장일은 건너뛰고 기록이 빠진 거래일에서는 끊음
  const history = await readFile(HISTORY, "utf8").then(JSON.parse).catch(() => ({}));
  history[basisDate] = top.map((s) => s.code);
  const calendar = [...new Set(liquid.flatMap((s) => s.candles.map((c) => c.date)))]
    .filter((d) => d <= basisDate)
    .sort()
    .reverse();
  const streakOf = (code) => {
    let n = 0;
    for (const d of calendar) {
      if (!history[d]?.includes(code)) break;
      n++;
    }
    return n;
  };
  for (const d of Object.keys(history)) if (!calendar.slice(0, HISTORY_DAYS).includes(d)) delete history[d];

  const result = {
    basisDate,
    generatedAt: new Date().toISOString(),
    minValueEok: MIN_VALUE / 1e8,
    historyDays: Object.keys(history).length,
    counts: { listed: list.length, universe: universe.length, scored: ranked.length, failed: failedCandles + scored.filter((s) => s.error).length },
    excluded,
    items: top.map((s, i) => ({ rank: i + 1, streak: streakOf(s.code), ...s })),
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(result));
  await writeFile(HISTORY, JSON.stringify(history));
  console.log(`\n완료 ${((Date.now() - started) / 1000).toFixed(0)}초 · 점수 계산 ${ranked.length}개 · 실패 ${result.counts.failed}개`);
  console.log(`상위 ${TOP}: ${result.items.slice(0, 10).map((s) => `${s.name} ${s.score.total}`).join(", ")} ...`);
  console.log(`연속 진입: ${result.items.filter((s) => s.streak > 1).length}개 종목이 2일 이상 (기록 ${result.historyDays}일치)`);
  console.log(`저장: ${OUT}, ${HISTORY}`);
}

main().catch((e) => {
  console.error("전체 종목 계산 실패:", e.message);
  process.exit(1);
});
