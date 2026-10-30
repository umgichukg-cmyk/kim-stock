// GET /api/market - 코스피/코스닥/미국 선물/환율
import { MARKET } from "../config/themes.js";
import { getIntraday } from "./_lib/yahoo.js";
import { sendJson, sendError } from "./_lib/http.js";

export default async function handler(req, res) {
  try {
    const settled = await Promise.allSettled(MARKET.map((m) => getIntraday(m.symbol)));
    const items = MARKET.map((m, i) => {
      const r = settled[i];
      return r.status === "fulfilled"
        ? { ...m, ...r.value, ok: true }
        : { ...m, ok: false, error: r.reason?.message || String(r.reason) };
    });
    sendJson(res, 200, { updatedAt: new Date().toISOString(), items }, 30);
  } catch (e) {
    sendError(res, e);
  }
}
