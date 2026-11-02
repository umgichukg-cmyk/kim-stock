// GET /api/search?q=삼성 - 종목명으로 국내 종목 찾기
import { searchStocks } from "../_lib/naver.js";
import { sendJson, sendError } from "../_lib/http.js";

export default async function handler(req, res) {
  const q = String(req.query.q ?? "").trim().slice(0, 30);
  if (!q) return sendJson(res, 400, { error: "검색어가 필요합니다 (예: q=삼성전자)" });
  try {
    sendJson(res, 200, { query: q, items: await searchStocks(q) }, 3600);
  } catch (e) {
    sendError(res, e, { query: q });
  }
}
