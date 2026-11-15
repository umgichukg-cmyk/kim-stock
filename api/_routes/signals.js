// GET /api/signals - 조건 검색 결과 (거래량 급증 + 5·20일선 골든크로스 + 외국인·기관 순매수)
// 매일 장 마감 후 저녁 자동 계산이 날짜별로 남긴 목록, 최근 60거래일
import { readDataFile, DataNotReady } from "../_lib/datafile.js";
import { sendJson, sendError } from "../_lib/http.js";

export default async function handler(req, res) {
  try {
    sendJson(res, 200, await readDataFile("signals.json"), 300);
  } catch (e) {
    if (e instanceof DataNotReady) return sendJson(res, 404, { error: e.message });
    sendError(res, e);
  }
}
