// GET /api/kr-live                       - 한국 시장 장중 흐름 (지수 1분봉, 투자자, 등락 종목 수, 순위, 업종·테마)
// GET /api/kr-live?group=industry&no=123 - 업종(또는 theme) 대표 종목의 지금 시세 (시가총액 순 15개)
// 모두 네이버 실시간 값이라 1분 동안만 저장해 둡니다.
import {
  getIndexQuote,
  getIndexMinute,
  getIndexInvestors,
  getRanking,
  getIndustries,
  getThemes,
  getGroupLive,
} from "../_lib/naver.js";
import { sendJson, sendError } from "../_lib/http.js";

const INDICES = [
  { symbol: "KOSPI", name: "코스피" },
  { symbol: "KOSDAQ", name: "코스닥" },
  { symbol: "KPI200", name: "코스피200" },
];
const MARKETS = ["KOSPI", "KOSDAQ"];
const MIN_VALUE = 10; // 상승·하락률 순위는 거래대금 10억 이상만 (거래가 거의 없는 종목 제외)
const TOP = 10;

const isCommon = (s) => s.type === "stock" && /0$/.test(s.code); // 보통주만 (ETF·우선주 제외)

async function overview() {
  const indices = await Promise.all(
    INDICES.map(async (x) => {
      const [q, minute] = await Promise.all([getIndexQuote(x.symbol).catch(() => null), getIndexMinute(x.symbol).catch(() => [])]);
      if (!q?.price) return { ...x, ok: false };
      // 오늘 1분봉만 (장 시작 전에는 전날 것이 올 수 있어 날짜로 거름)
      const today = q.tradedAt?.slice(0, 10).replace(/-/g, "");
      const points = minute.filter((m) => !today || m.date === today).map((m) => [m.time, m.price]);
      return { ...x, ok: true, price: q.price, change: q.change, changePct: q.changePct, prevClose: q.prevClose, status: q.status, tradedAt: q.tradedAt, points };
    })
  );

  const [investors, rankings, industries, themes] = await Promise.all([
    Promise.all(MARKETS.map((m) => getIndexInvestors(m).catch(() => null))),
    Promise.all(
      MARKETS.flatMap((m) => ["up", "down", "priceTop"].map((k) => getRanking(k, m).catch(() => ({ total: 0, stocks: [] }))))
    ),
    getIndustries().catch(() => []),
    getThemes().catch(() => []),
  ]);

  // rankings 순서: KOSPI up, down, priceTop, KOSDAQ up, down, priceTop
  const pick = (k) => MARKETS.map((m, i) => rankings[i * 3 + k]);
  const [ups, downs, values] = [pick(0), pick(1), pick(2)];
  const breadth = Object.fromEntries(
    MARKETS.map((m, i) => [
      m,
      {
        up: ups[i].total,
        down: downs[i].total,
        upper: ups[i].stocks.filter((s) => s.limit === "upper").length,
        lower: downs[i].stocks.filter((s) => s.limit === "lower").length,
      },
    ])
  );
  const merge = (lists) => lists.flatMap((l) => l.stocks).filter(isCommon);
  const strip = ({ type, limit, marketValue, ...s }) => ({ ...s, ...(limit ? { limit } : {}) });
  const movers = {
    gainers: merge(ups).filter((s) => s.value >= MIN_VALUE).sort((a, b) => b.changePct - a.changePct).slice(0, TOP).map(strip),
    losers: merge(downs).filter((s) => s.value >= MIN_VALUE).sort((a, b) => a.changePct - b.changePct).slice(0, TOP).map(strip),
    value: merge(values).sort((a, b) => b.value - a.value).slice(0, TOP).map(strip),
  };
  const limits = {
    upper: merge(ups).filter((s) => s.limit === "upper").sort((a, b) => b.value - a.value).map(strip),
    lower: merge(downs).filter((s) => s.limit === "lower").sort((a, b) => b.value - a.value).map(strip),
  };

  const groups = (all, n) => (all.length ? { count: all.length, top: all.slice(0, n), bottom: all.slice(-n).reverse() } : null);

  const status = indices.find((x) => x.ok)?.status ?? null;
  return {
    updatedAt: new Date().toISOString(),
    status,
    tradedAt: indices.find((x) => x.ok)?.tradedAt ?? null,
    indices,
    investors: Object.fromEntries(MARKETS.map((m, i) => [m, investors[i]])),
    breadth,
    movers,
    limits,
    industries: groups(industries, 7),
    themes: groups(themes, 10),
  };
}

export default async function handler(req, res) {
  try {
    const { group, no } = req.query;
    if (group != null) {
      if (!["industry", "theme"].includes(group) || !/^\d+$/.test(String(no))) return sendJson(res, 400, { error: "group=industry|theme 와 no 가 필요해요" });
      const g = await getGroupLive(group, no);
      const stocks = g.stocks
        .filter(isCommon)
        .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0))
        .slice(0, 15)
        .map(({ type, ...s }) => s);
      return sendJson(res, 200, { updatedAt: new Date().toISOString(), stocks }, 60);
    }
    sendJson(res, 200, await overview(), 60);
  } catch (e) {
    sendError(res, e);
  }
}
