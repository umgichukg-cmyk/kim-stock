// Yahoo Finance 시세 (미국 종목, 지수, 선물, 환율)
import { fetchJson } from "./http.js";

// 최근 거래일 종가 기준 등락률. 장중이면 현재가 기준.
export async function getDailyChange(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const j = await fetchJson(url);
  const result = j.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo 데이터 없음: ${symbol}`);
  const closes = (result.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
  const price = result.meta?.regularMarketPrice ?? closes.at(-1);
  // 마지막 봉이 오늘(진행 중) 봉이면 그 이전 종가가 기준
  const prevClose = closes.length >= 2 ? closes.at(-2) : result.meta?.chartPreviousClose;
  if (price == null || !prevClose) throw new Error(`Yahoo 가격 없음: ${symbol}`);
  return {
    symbol,
    name: result.meta?.shortName || result.meta?.longName || symbol,
    price,
    prevClose,
    changePct: ((price - prevClose) / prevClose) * 100,
    time: result.meta?.regularMarketTime ?? null,
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
