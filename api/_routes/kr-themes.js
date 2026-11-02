// GET /api/kr-themes        - 전일(장 마감 기준) 한국 테마 목록 (관련 종목 제외, 가볍게)
// GET /api/kr-themes?no=123 - 그 테마의 관련 종목 (기준일 등락률 높은 순)
// 매일 장 마감 후 계산해 둔 kr-themes.json을 읽습니다.
import { readDataFile, DataNotReady } from "../_lib/datafile.js";
import { sendJson, sendError } from "../_lib/http.js";

export default async function handler(req, res) {
  try {
    const data = await readDataFile("kr-themes.json");
    const head = { basisDate: data.basisDate, generatedAt: data.generatedAt, count: data.count, newThemes: data.newThemes || [] };
    if (req.query.no != null) {
      const theme = data.themes.find((t) => String(t.no) === String(req.query.no));
      if (!theme) return sendJson(res, 404, { error: "테마를 찾을 수 없어요" });
      return sendJson(res, 200, { ...head, theme }, 300);
    }
    const themes = data.themes.map(({ members, ...t }) => ({ ...t, listed: members?.length ?? 0 }));
    sendJson(res, 200, { ...head, themes }, 300);
  } catch (e) {
    if (e instanceof DataNotReady) return sendJson(res, 404, { error: e.message });
    sendError(res, e);
  }
}
