// 시장 상태: 코스피·코스닥이 각각 20일선 위인지로 상승 / 주의 / 하락을 판단
// (1년치 검증에서 "둘 다 20일선 위"인 날에 나온 매수 신호가 가장 나았고, 둘 다 아래인 날은 나빴음.
//  꺾이기 직전은 못 잡으니 "들어갈 때"보다 "쉬어야 할 때"를 알려주는 용도)
import { getIndexDaily } from "./naver.js";

const TTL = 10 * 60_000;
let cache = null;

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

async function indexState(index, name) {
  const now = new Date(Date.now() + 9 * 3600_000);
  const rows = await getIndexDaily(index, ymd(new Date(now.getTime() - 60 * 86400_000)), ymd(now));
  if (rows.length < 20) throw new Error(`${name} 일봉 부족`);
  const last = rows.at(-1);
  const ma20 = rows.slice(-20).reduce((s, r) => s + r.close, 0) / 20;
  return { name, date: last.date, close: last.close, ma20, gapPct: (last.close / ma20 - 1) * 100, above: last.close > ma20 };
}

export async function getMarketTrend() {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  const indices = await Promise.all([indexState("KOSPI", "코스피"), indexState("KOSDAQ", "코스닥")]);
  const up = indices.filter((i) => i.above).length;
  const value = { state: up === 2 ? "up" : up === 0 ? "down" : "caution", label: up === 2 ? "상승" : up === 0 ? "하락" : "주의", date: indices[0].date, indices };
  cache = { at: Date.now(), value };
  return value;
}
