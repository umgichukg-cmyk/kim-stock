// GET /api/news?code=005930 - 종목 관련 최근 뉴스 (제목·언론사·시각·원문 주소)
import { getNews } from "../_lib/naver.js";
import { sendJson, sendError, cleanCode } from "../_lib/http.js";

export default async function handler(req, res) {
  const code = cleanCode(req.query.code);
  if (!code) return sendJson(res, 400, { error: "6자리 종목코드가 필요합니다 (예: code=005930)" });
  try {
    sendJson(res, 200, { code, items: await getNews(code, 10) }, 300);
  } catch (e) {
    sendError(res, e, { code });
  }
}
