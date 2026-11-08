// GET /api/score-history?code=005930 - 한 종목의 날짜별 종합 점수 기록 (상세 화면 "점수 흐름" 그래프용)
// 매일 장 마감 후 저녁 자동 계산이 남긴 값이라 거래일마다 한 칸, 최근 약 2년치
import { readScoreHistory, scoreHistoryOf } from "../_lib/datafile.js";
import { sendJson, sendError, cleanCode } from "../_lib/http.js";

export default async function handler(req, res) {
  const code = cleanCode(req.query.code);
  if (!code) return sendJson(res, 400, { error: "종목코드가 필요합니다 (예: code=005930)" });
  try {
    const h = await readScoreHistory();
    sendJson(res, 200, { code, lastDate: h?.dates?.at(-1) ?? null, history: scoreHistoryOf(h, code) }, 300);
  } catch (e) {
    sendError(res, e);
  }
}
