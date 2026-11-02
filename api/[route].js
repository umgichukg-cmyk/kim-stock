// 모든 /api/* 요청을 받는 서버 함수 하나
// Vercel 무료 요금제는 배포당 서버 함수가 12개까지라, 실제 처리는 _routes/ 아래 파일로 나눠 줍니다.
// /api/stock?code=005930 → _routes/stock.js (주소의 이름은 Vercel이 req.query.route로 넘겨줌)
import briefing from "./_routes/briefing.js";
import candles from "./_routes/candles.js";
import chart from "./_routes/chart.js";
import ipo from "./_routes/ipo.js";
import krBriefing from "./_routes/kr-briefing.js";
import krLive from "./_routes/kr-live.js";
import krThemes from "./_routes/kr-themes.js";
import market from "./_routes/market.js";
import news from "./_routes/news.js";
import picks from "./_routes/picks.js";
import search from "./_routes/search.js";
import stock from "./_routes/stock.js";
import top30 from "./_routes/top30.js";
import watch from "./_routes/watch.js";
import { sendJson } from "./_lib/http.js";

const ROUTES = {
  briefing,
  candles,
  chart,
  ipo,
  "kr-briefing": krBriefing,
  "kr-live": krLive,
  "kr-themes": krThemes,
  market,
  news,
  picks,
  search,
  stock,
  top30,
  watch,
};

export default function handler(req, res) {
  const { route, ...query } = req.query;
  const fn = Object.hasOwn(ROUTES, route) ? ROUTES[route] : null;
  if (!fn) return sendJson(res, 404, { error: "없는 API예요" });
  req.query = query;
  return fn(req, res);
}
