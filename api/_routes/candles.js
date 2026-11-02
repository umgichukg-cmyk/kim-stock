// GET /api/candles?code=005930&period=minute|week|month - 종목 상세 차트의 분봉·주봉·월봉
// 분봉은 최근 5거래일 1분봉 (5분·15분·60분은 화면에서 묶음), 주봉은 약 10년, 월봉은 2000년부터
import { getStockCandles } from "../_lib/naver.js";
import { sendJson, sendError, cleanCode } from "../_lib/http.js";

const PERIODS = ["minute", "week", "month"];

export default async function handler(req, res) {
  const code = cleanCode(req.query.code);
  const period = req.query.period;
  if (!code) return sendJson(res, 400, { error: "6자리 종목코드가 필요합니다 (예: code=005930)" });
  if (!PERIODS.includes(period)) return sendJson(res, 400, { error: `period는 ${PERIODS.join(", ")} 중 하나여야 합니다` });
  try {
    const candles = await getStockCandles(code, period);
    // 분봉은 자주 바뀌니 짧게, 주봉·월봉은 길게 저장
    sendJson(res, 200, { code, period, updatedAt: new Date().toISOString(), candles }, period === "minute" ? 30 : 600);
  } catch (e) {
    sendError(res, e, { code });
  }
}
