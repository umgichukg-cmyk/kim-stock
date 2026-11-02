// GET /api/chart?id=kospi&range=1d - 시장 지표 상세 차트 (config/themes.js의 MARKET·CHART_ONLY 목록만 허용)
import { MARKET, CHART_ONLY } from "../../config/themes.js";
import { getCandles, CHART_RANGES } from "../_lib/yahoo.js";
import { getIndexQuote, getIndexMinuteCandles, getIndexCandles } from "../_lib/naver.js";
import { sendJson, sendError } from "../_lib/http.js";

// 한국 지수의 1일·5일 차트는 네이버 분봉 (Yahoo 장중 값이 네이버 현재가와 다를 때가 있음)
const NAVER_INTRADAY = { "1d": { days: 1, bucket: 5 }, "5d": { days: 5, bucket: 15 } };
// naverHistory 지표(코스피200)는 Yahoo에 긴 기간 데이터가 없어 1개월 이상도 네이버 일봉·주봉
const NAVER_HISTORY = { "1mo": ["day", 31], "3mo": ["day", 92], "1y": ["day", 366], "5y": ["week", 5 * 366] };

const kstYmd = (daysAgo) => new Date(Date.now() + 9 * 3600_000 - daysAgo * 86400_000).toISOString().slice(0, 10).replace(/-/g, "");

async function naverIntraday(index, range) {
  const { days, bucket } = NAVER_INTRADAY[range];
  const all = await getIndexMinuteCandles(index, kstYmd(days + 9), bucket);
  const dates = [...new Set(all.map((c) => c.date))].slice(-days);
  return all.filter((c) => dates.includes(c.date)).map(({ date, ...c }) => c);
}

export default async function handler(req, res) {
  const item = [...MARKET, ...CHART_ONLY].find((m) => m.id === req.query.id);
  const range = req.query.range || "1d";
  if (!item) return sendJson(res, 400, { error: "알 수 없는 지표입니다" });
  if (!CHART_RANGES[range]) return sendJson(res, 400, { error: `기간은 ${Object.keys(CHART_RANGES).join(", ")} 중 하나여야 합니다` });
  const intraday = item.naver && NAVER_INTRADAY[range];
  const history = item.naverHistory && NAVER_HISTORY[range];
  const useNaver = intraday || history;
  try {
    // 네이버 차트를 쓸 때도 나머지 정보는 Yahoo에서 (못 받아도 차트는 보여줌)
    const [yahoo, quote, candles, year] = await Promise.all([
      getCandles(item.symbol, range).catch((e) => (useNaver ? null : Promise.reject(e))),
      item.naver ? getIndexQuote(item.naver).catch(() => null) : null,
      intraday
        ? naverIntraday(item.naver, range).catch(() => [])
        : history
          ? getIndexCandles(item.naver, history[0], kstYmd(history[1])).catch(() => [])
          : null,
      // 52주 최고·최저도 Yahoo에 없으면 네이버 일봉으로
      item.naverHistory ? getIndexCandles(item.naver, "day", kstYmd(366)).catch(() => []) : null,
    ]);
    const data = yahoo ?? { symbol: item.symbol, range, interval: CHART_RANGES[range], intraday: !!intraday, candles: [] };
    data.source = "Yahoo Finance";
    if (candles?.length) {
      Object.assign(data, { candles, interval: intraday ? `${intraday.bucket}m` : history[0] === "week" ? "1wk" : "1d", source: "네이버 증권" });
      if (intraday) {
        const lastDay = candles.at(-1).time - (candles.at(-1).time % 86400);
        const today = candles.filter((c) => c.time >= lastDay);
        Object.assign(data, { dayHigh: Math.max(...today.map((c) => c.high)), dayLow: Math.min(...today.map((c) => c.low)) });
      }
    }
    if (year?.length) Object.assign(data, { high52: Math.max(...year.map((c) => c.high)), low52: Math.min(...year.map((c) => c.low)) });
    // 한국 지수는 현재가·전일 종가를 네이버 값으로 (Yahoo 전일 종가가 늦게 바뀔 때가 있음)
    if (quote?.price) Object.assign(data, { price: quote.price, prevClose: quote.prevClose });
    if (!data.candles.length) throw new Error("차트 데이터가 없어요");
    // 하루 차트는 자주 바뀌니 짧게, 긴 기간은 길게 저장
    sendJson(res, 200, { ...item, ...data }, range === "1d" ? 30 : range === "5d" ? 120 : 600);
  } catch (e) {
    sendError(res, e, { id: item.id });
  }
}
