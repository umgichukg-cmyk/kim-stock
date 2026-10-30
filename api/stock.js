// GET /api/stock?code=005930 - 종목 상세 (일봉, 20일 수급, 점수 근거)
import { analyzeStock } from "./_lib/analyze.js";
import { sendJson, sendError, cleanCode } from "./_lib/http.js";

export default async function handler(req, res) {
  const code = cleanCode(req.query.code);
  if (!code) return sendJson(res, 400, { error: "6자리 종목코드가 필요합니다 (예: code=005930)" });
  try {
    const data = await analyzeStock(code, { withCandles: true });
    sendJson(res, 200, { updatedAt: new Date().toISOString(), ...data }, 60);
  } catch (e) {
    sendError(res, e, { code });
  }
}
