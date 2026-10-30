// 종목 분석과 테마 순위 - 여러 API가 같이 씁니다.
import { THEMES } from "../../config/themes.js";
import { getQuote, getDailyCandles, getInvestorFlows } from "./naver.js";
import { getDailyChange } from "./yahoo.js";
import { scoreStock, priceStats } from "./score.js";

// 한 종목의 시세 + 일봉 + 수급 + 점수
export async function analyzeStock(code, { withCandles = false } = {}) {
  const [quote, candles, flows] = await Promise.all([
    getQuote(code),
    getDailyCandles(code),
    getInvestorFlows(code, 20).catch(() => []), // 수급이 없어도 기술 점수는 계산
  ]);
  const stats = priceStats(candles);
  const score = scoreStock(candles, flows);
  return {
    ...quote,
    score,
    stats,
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

  // 변동성(등락 절댓값 평균) 큰 순서. 데이터가 하나도 없는 테마는 맨 뒤로.
  themes.sort((a, b) => (b.volatility ?? -1) - (a.volatility ?? -1));
  return themes;
}
