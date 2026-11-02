// GET /api/top30 - 한국 시장 전체 종목 점수 상위 30 (매일 장 마감 후 계산된 결과)
import { readDataFile, DataNotReady } from "../_lib/datafile.js";
import { sendJson, sendError } from "../_lib/http.js";

export default async function handler(req, res) {
  try {
    sendJson(res, 200, await readDataFile("top30.json"), 300);
  } catch (e) {
    if (e instanceof DataNotReady) return sendJson(res, 404, { error: e.message });
    sendError(res, e);
  }
}
