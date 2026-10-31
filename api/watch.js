// GET /api/watch?codes=005930,000660 - 관심 종목들의 지금 시세와 점수 (카드 표시용, 최대 40개)
// 어떤 종목이 관심 종목인지는 화면이 Supabase에서 읽어 와서 넘겨줍니다. 여기서는 개인 정보를 다루지 않아요.
import { analyzeStock } from "./_lib/analyze.js";
import { sendJson, sendError, cleanCode } from "./_lib/http.js";

const MAX = 40;

export default async function handler(req, res) {
  const codes = [...new Set(String(req.query.codes || "").split(",").map(cleanCode).filter(Boolean))].slice(0, MAX);
  if (!codes.length) return sendJson(res, 400, { error: "종목코드가 필요합니다 (예: codes=005930,000660)" });
  try {
    const results = await Promise.allSettled(codes.map((c) => analyzeStock(c)));
    const items = [];
    const failed = [];
    results.forEach((r, i) => (r.status === "fulfilled" ? items.push(r.value) : failed.push(codes[i])));
    sendJson(res, 200, { updatedAt: new Date().toISOString(), items, failed }, 60);
  } catch (e) {
    sendError(res, e);
  }
}
