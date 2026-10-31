// GET /api/market - 코스피/코스닥/미국 선물/환율 등
import { MARKET } from "../config/themes.js";
import { getIntraday } from "./_lib/yahoo.js";
import { getIndexQuote } from "./_lib/naver.js";
import { sendJson, sendError } from "./_lib/http.js";

export default async function handler(req, res) {
  try {
    const settled = await Promise.allSettled(
      MARKET.map(async (m) => {
        const [y, n] = await Promise.all([getIntraday(m.symbol), m.naver ? getIndexQuote(m.naver).catch(() => null) : null]);
        // 한국 지수는 가격·등락을 네이버 값으로, 작은 그래프 선은 Yahoo 5분봉으로
        return n?.price ? { ...y, price: n.price, change: n.change, changePct: n.changePct, prevClose: n.prevClose } : y;
      })
    );
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
