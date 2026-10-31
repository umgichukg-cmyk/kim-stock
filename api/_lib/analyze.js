// 종목 분석과 테마 순위 - 여러 API가 같이 씁니다.
import { THEMES } from "../../config/themes.js";
import { getQuote, getDailyCandles, getInvestorFlows, getFundamentals } from "./naver.js";
import { getDailyChange } from "./yahoo.js";
import { scoreStock, priceStats } from "./score.js";

// 한 종목의 시세 + 일봉 + 수급 + 점수
export async function analyzeStock(code, { withCandles = false } = {}) {
  const [quote, candles, rawFlows, fundamentals] = await Promise.all([
    getQuote(code),
    getDailyCandles(code),
    getInvestorFlows(code, 30).catch(() => []), // 수급이 없어도 기술 점수는 계산
    getFundamentals(code).catch(() => null), // 재무가 없어도(ETF 등) 나머지는 계산
  ]);
  // 수급 평단 추정용 하루 대표가격 (고가 + 저가 + 종가) ÷ 3 - 실제 투자자별 체결가는 공개되지 않아요
  const typical = new Map(candles.map((c) => [c.date, (c.high + c.low + c.close) / 3]));
  const flows = rawFlows.map((f) => ({ ...f, typical: typical.get(f.date) ?? f.close }));
  const stats = priceStats(candles);
  const score = scoreStock(candles, flows, fundamentals);
  return {
    ...quote,
    score,
    stats,
    fundamentals: withCandles ? fundamentals : undefined,
    flows: withCandles ? flows : flows.slice(-5),
    candles: withCandles ? candles : undefined,
    spark: candles.slice(-30).map((c) => c.close),
  };
}

// 테마별 미국 대표 종목의 최근 거래일 등락
export async function rankThemes() {
  const symbols = [...new Set(THEMES.flatMap((t) => t.us))];
  const results = await Promise.allSettled(symbols.map((s) => getDailyChange(s)));
  const bySymbol = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") bySymbol[symbols[i]] = r.value;
  });

  const themes = THEMES.map((t) => {
    const us = t.us.map((s) => bySymbol[s]).filter(Boolean);
    const avgChange = us.length ? us.reduce((s, q) => s + q.changePct, 0) / us.length : null;
    const volatility = us.length ? us.reduce((s, q) => s + Math.abs(q.changePct), 0) / us.length : null;
    return {
      id: t.id,
      name: t.name,
      avgChange,
      volatility,
      us: us.map((q) => ({ symbol: q.symbol, price: q.price, changePct: q.changePct })),
      missing: t.us.filter((s) => !bySymbol[s]),
      kr: t.kr,
    };
  });

  // 상승률(평균 등락) 높은 순서. 데이터가 하나도 없는 테마는 맨 뒤로.
  themes.sort((a, b) => (b.avgChange ?? -Infinity) - (a.avgChange ?? -Infinity));

  // 기준 거래일: 종목들 중 가장 많이 나온 날짜
  const counts = {};
  Object.values(bySymbol).forEach((q) => (counts[q.date] = (counts[q.date] || 0) + 1));
  const sessionDate = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return { themes, sessionDate };
}
