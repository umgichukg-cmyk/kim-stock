// GET /api/kr-briefing - 전일(장 마감된 마지막 거래일) 한국 시장 브리핑
// 숫자는 매일 장 마감 후 계산해 둔 kr-briefing.json, 뉴스는 지금 기준 주요 뉴스
import { readDataFile, DataNotReady } from "./_lib/datafile.js";
import { getMainNews } from "./_lib/naver.js";
import { sendJson, sendError } from "./_lib/http.js";

export default async function handler(req, res) {
  try {
    const [data, news] = await Promise.all([readDataFile("kr-briefing.json"), getMainNews(10).catch(() => [])]);
    sendJson(res, 200, { ...data, news }, 300);
  } catch (e) {
    if (e instanceof DataNotReady) return sendJson(res, 404, { error: e.message });
    sendError(res, e);
  }
}
