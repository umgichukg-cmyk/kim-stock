// Yahoo Finance 시세 (미국 종목, 지수, 선물, 환율)
import { fetchJson } from "./http.js";

// 장이 끝난 마지막 거래일(전일)의 종가 등락률.
// 지금 미국장이 열려 있으면 진행 중인 오늘 봉은 빼고 그 전날 봉을 씁니다.
export async function getDailyChange(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10d&interval=1d`;
  const j = await fetchJson(url);
  const result = j.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo 데이터 없음: ${symbol}`);
  const meta = result.meta || {};
  const rawCloses = result.indicators?.quote?.[0]?.close || [];
  const bars = (result.timestamp || [])
    .map((t, i) => ({ t, close: rawCloses[i] }))
    .filter((b) => b.close != null);

  const regular = meta.currentTradingPeriod?.regular;
  const now = Date.now() / 1000;
  if (regular && bars.length && bars.at(-1).t >= regular.start && now < regular.end) bars.pop();
  if (bars.length < 2) throw new Error(`Yahoo 가격 없음: ${symbol}`);

  const last = bars.at(-1);
  const prev = bars.at(-2);
  return {
    symbol,
    name: meta.shortName || meta.longName || symbol,
    price: last.close,
    prevClose: prev.close,
    changePct: ((last.close - prev.close) / prev.close) * 100,
    // 거래일 (뉴욕 기준 YYYY-MM-DD)
    date: new Date(last.t * 1000).toLocaleDateString("en-CA", { timeZone: meta.exchangeTimezoneName || "America/New_York" }),
  };
}

// 기간별 봉 데이터 (상세 차트용). time은 한국 시간으로 보이도록 +9시간 한 유닉스 초
export const CHART_RANGES = {
  "1d": "5m",
  "5d": "15m",
  "1mo": "1d",
  "3mo": "1d",
  "1y": "1d",
  "5y": "1wk",
};

export async function getCandles(symbol, range) {
  const interval = CHART_RANGES[range];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const j = await fetchJson(url);
  const result = j.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo 데이터 없음: ${symbol}`);
  const meta = result.meta || {};
  const q = result.indicators?.quote?.[0] || {};
  const KST = 9 * 3600;
  const candles = (result.timestamp || [])
    .map((t, i) => ({ time: t + KST, open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] ?? 0 }))
    .filter((c) => c.open != null && c.close != null && c.high != null && c.low != null);
  return {
    symbol,
    range,
    interval,
    intraday: /m$/.test(interval),
    price: meta.regularMarketPrice ?? candles.at(-1)?.close ?? null,
    prevClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
    dayHigh: meta.regularMarketDayHigh ?? null,
    dayLow: meta.regularMarketDayLow ?? null,
    high52: meta.fiftyTwoWeekHigh ?? null,
    low52: meta.fiftyTwoWeekLow ?? null,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    time: meta.regularMarketTime ?? null,
    candles,
  };
}

// 당일 5분봉 흐름 (작은 선 그래프용)
export async function getIntraday(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`;
  const j = await fetchJson(url);
  const result = j.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo 데이터 없음: ${symbol}`);
  const meta = result.meta || {};
  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
  const points = (result.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
  return {
    symbol,
    price,
    prevClose,
    change: price != null && prevClose ? price - prevClose : null,
    changePct: price != null && prevClose ? ((price - prevClose) / prevClose) * 100 : null,
    points,
    time: meta.regularMarketTime ?? null,
  };
}
