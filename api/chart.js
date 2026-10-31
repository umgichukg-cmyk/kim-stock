// GET /api/chart?id=kospi&range=1d - 시장 지표 상세 차트 (config/themes.js의 MARKET 목록만 허용)
import { MARKET } from "../config/themes.js";
import { getCandles, CHART_RANGES } from "./_lib/yahoo.js";
import { getIndexQuote } from "./_lib/naver.js";
import { sendJson, sendError } from "./_lib/http.js";

export default async function handler(req, res) {
  const item = MARKET.find((m) => m.id === req.query.id);
  const range = req.query.range || "1d";
  if (!item) return sendJson(res, 400, { error: "알 수 없는 지표입니다" });
  if (!CHART_RANGES[range]) return sendJson(res, 400, { error: `기간은 ${Object.keys(CHART_RANGES).join(", ")} 중 하나여야 합니다` });
  try {
    const data = await getCandles(item.symbol, range);
    // 한국 지수는 현재가·전일 종가를 네이버 값으로 (Yahoo 전일 종가가 늦게 바뀔 때가 있음)
    if (item.naver) {
      const n = await getIndexQuote(item.naver).catch(() => null);
      if (n?.price) Object.assign(data, { price: n.price, prevClose: n.prevClose });
    }
    // 하루 차트는 자주 바뀌니 짧게, 긴 기간은 길게 저장
    sendJson(res, 200, { ...item, ...data }, range === "1d" ? 30 : range === "5d" ? 120 : 600);
  } catch (e) {
    sendError(res, e, { id: item.id });
  }
}
