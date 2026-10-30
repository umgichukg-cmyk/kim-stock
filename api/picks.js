// GET /api/picks - 미국 테마 순위 + 상위 테마의 한국 종목 점수
import { TOP_THEMES } from "../config/themes.js";
import { analyzeStock, rankThemes } from "./_lib/analyze.js";
import { sendJson, sendError } from "./_lib/http.js";

export default async function handler(req, res) {
  try {
    const themes = await rankThemes();
    const top = themes.filter((t) => t.volatility != null).slice(0, TOP_THEMES);

    const targets = top.flatMap((t) => t.kr.map((k) => ({ ...k, theme: t.name, themeChange: t.avgChange })));
    const settled = await Promise.allSettled(targets.map((k) => analyzeStock(k.code)));

    const picks = [];
    const failed = [];
    settled.forEach((r, i) => {
      const k = targets[i];
      if (r.status === "fulfilled") picks.push({ ...r.value, theme: k.theme, themeChange: k.themeChange });
      else failed.push({ name: k.name, code: k.code, error: r.reason?.message || String(r.reason) });
    });
    picks.sort((a, b) => (b.score.total ?? -1) - (a.score.total ?? -1));

    sendJson(
      res,
      200,
      {
        updatedAt: new Date().toISOString(),
        themes: themes.map(({ kr, ...t }) => ({ ...t, krCount: kr.length })),
        topThemes: top.map((t) => t.name),
        picks,
        failed,
      },
      120
    );
  } catch (e) {
    sendError(res, e);
  }
}
