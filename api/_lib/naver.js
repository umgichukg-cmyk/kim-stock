// 네이버 증권 데이터 (인증키 불필요)
import { fetchJson, toNumber } from "./http.js";

const REFERER = { Referer: "https://m.stock.naver.com/" };

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// 시장 전체 종목 목록 (시가총액 순, ETF·ETN 포함)
export async function listMarket(market) {
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const j = await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`, {
      headers: REFERER,
    });
    if (!j.stocks?.length) break;
    all.push(
      ...j.stocks.map((s) => ({
        code: s.itemCode,
        name: s.stockName,
        market: market === "KOSPI" ? "코스피" : "코스닥",
        type: s.stockEndType, // stock / etf / etn
        halted: s.tradeStopType?.name === "HALTED",
      }))
    );
  }
  return all;
}

// 종목 관련 뉴스. 같은 사건 기사 묶음마다 대표 기사 1개 + 관련 기사 수
// 기사 본문은 저작권 때문에 가져오지 않고 제목·언론사·시각·원문 주소만 씀
const decodeEntities = (s) =>
  String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

export async function getNews(code, count = 10) {
  const groups = await fetchJson(`https://m.stock.naver.com/api/news/stock/${code}?pageSize=${count}&page=1`, {
    headers: REFERER,
  });
  if (!Array.isArray(groups)) return [];
  return groups
    .map((g) => {
      const a = g.items?.[0];
      if (!a?.title) return null;
      const d = String(a.datetime); // YYYYMMDDHHmm
      return {
        title: decodeEntities(a.titleFull || a.title),
        press: decodeEntities(a.officeName),
        time: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:${d.slice(10, 12)}:00+09:00`,
        url: a.mobileNewsUrl || `https://n.news.naver.com/mnews/article/${a.officeId}/${a.articleId}`,
        related: Math.max(0, (g.total ?? g.items.length) - 1),
      };
    })
    .filter(Boolean);
}

// 증권 주요 뉴스 (시장 전체)
export async function getMainNews(count = 10) {
  const j = await fetchJson(`https://m.stock.naver.com/front-api/news/category?category=mainnews&pageSize=${count}&page=1`, {
    headers: REFERER,
  });
  return (j.result || [])
    .filter((a) => a.title)
    .map((a) => {
      const d = String(a.datetime); // YYYYMMDDHHmmss
      return {
        title: decodeEntities(a.titleFull || a.title),
        press: decodeEntities(a.officeName),
        time: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:${d.slice(10, 12)}:00+09:00`,
        url: `https://n.news.naver.com/mnews/article/${a.officeId}/${a.articleId}`,
      };
    });
}

// 국내 지수 현재가 (KOSPI / KOSDAQ / KPI200). Yahoo는 한국 지수 전일 종가가 늦게 바뀔 때가 있어 네이버 값을 씀
export async function getIndexQuote(index) {
  const j = await fetchJson(`https://m.stock.naver.com/api/index/${index}/basic`, { headers: REFERER });
  const price = toNumber(j.closePrice);
  const change = toNumber(j.compareToPreviousClosePrice);
  return { price, change, changePct: toNumber(j.fluctuationsRatio), prevClose: price != null && change != null ? price - change : null };
}

// 국내 지수 일봉 (오래된 순)
export async function getIndexDaily(index, fromYmd, toYmd) {
  const rows = await fetchJson(
    `https://api.stock.naver.com/chart/domestic/index/${index}/day?startDateTime=${fromYmd}0000&endDateTime=${toYmd}2359`,
    { headers: REFERER }
  );
  return (Array.isArray(rows) ? rows : []).map((r) => ({ date: String(r.localDate), close: r.closePrice })).filter((r) => r.close > 0);
}

// 시장 전체 투자자별 순매수 (억 원). bizdate(YYYYMMDD)를 주면 그날 기준
export async function getIndexInvestors(index, bizdate) {
  const j = await fetchJson(`https://m.stock.naver.com/api/index/${index}/trend${bizdate ? `?bizdate=${bizdate}` : ""}`, {
    headers: REFERER,
  });
  return {
    date: j.bizdate,
    individual: toNumber(j.personalValue),
    foreign: toNumber(j.foreignValue),
    institution: toNumber(j.institutionalValue),
  };
}

// 업종별 등락 (마지막 시세 기준, 등락률 높은 순)
export async function getIndustries() {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const j = await fetchJson(`https://m.stock.naver.com/api/stocks/industry?page=${page}&pageSize=50`, { headers: REFERER, retries: 0 }).catch(
      () => null
    );
    if (!j?.groups?.length) break;
    all.push(...j.groups.map((g) => ({ name: g.name, changePct: toNumber(g.changeRate), count: g.totalCount, up: g.riseCount, down: g.fallCount })));
  }
  return all;
}

// 종목명(또는 코드 일부)으로 국내 종목 찾기
export async function searchStocks(query, limit = 10) {
  const url = `https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=stock`;
  const j = await fetchJson(url, { headers: REFERER });
  return (j.items || [])
    .filter((i) => i.nationCode === "KOR" && i.code)
    .slice(0, limit)
    .map((i) => ({ code: i.code, name: i.name, market: i.typeName || i.typeCode }));
}

// 현재가 / 전일대비 / 종목명
export async function getQuote(code) {
  const j = await fetchJson(`https://m.stock.naver.com/api/stock/${code}/basic`, { headers: REFERER, retries: 0 }).catch(
    (e) => {
      throw /HTTP (404|409)/.test(e.message) ? new Error(`종목코드 ${code}를 찾을 수 없어요`) : e;
    }
  );
  return {
    code,
    name: j.stockName,
    market: j.stockExchangeType?.nameKor || (j.sosok === "1" ? "코스닥" : "코스피"),
    price: toNumber(j.closePrice),
    change: toNumber(j.compareToPreviousClosePrice),
    changePct: toNumber(j.fluctuationsRatio),
    marketStatus: j.marketStatus, // OPEN / CLOSE
    tradedAt: j.localTradedAt,
  };
}

// 일봉 (오래된 날짜 → 최신 순)
export async function getDailyCandles(code, calendarDays = 200) {
  const end = new Date();
  const start = new Date(end.getTime() - calendarDays * 86400000);
  const url =
    `https://api.stock.naver.com/chart/domestic/item/${code}/day` +
    `?startDateTime=${ymd(start)}0000&endDateTime=${ymd(end)}2359`;
  const rows = await fetchJson(url, { headers: REFERER });
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({
      date: String(r.localDate),
      open: r.openPrice,
      high: r.highPrice,
      low: r.lowPrice,
      close: r.closePrice,
      volume: r.accumulatedTradingVolume,
      foreignRate: r.foreignRetentionRate ?? null,
    }))
    .filter((r) => r.close > 0);
}

// 기본적 분석 데이터: PER/PBR, 연간 실적(최근 실적 + 올해 추정치), 증권사 컨센서스
export async function getFundamentals(code) {
  const [integ, annual] = await Promise.all([
    fetchJson(`https://m.stock.naver.com/api/stock/${code}/integration`, { headers: REFERER }),
    fetchJson(`https://m.stock.naver.com/api/stock/${code}/finance/annual`, { headers: REFERER }).catch(() => null),
  ]);

  const info = {};
  for (const x of integ.totalInfos || []) info[x.code] = x.value;

  // 연간 실적: 실제 값 컬럼과 추정치(컨센서스) 컬럼 분리
  const fin = annual?.financeInfo;
  const titles = fin?.trTitleList || [];
  const actualKeys = titles.filter((t) => t.isConsensus !== "Y").map((t) => t.key);
  const estimateKey = titles.find((t) => t.isConsensus === "Y")?.key ?? null;
  const rows = {};
  for (const r of fin?.rowList || []) {
    rows[r.title] = Object.fromEntries(Object.entries(r.columns || {}).map(([k, v]) => [k, toNumber(v.value)]));
  }
  const series = (title) => actualKeys.map((k) => ({ year: k.slice(0, 4), value: rows[title]?.[k] ?? null }));
  const estimate = (title) => (estimateKey ? rows[title]?.[estimateKey] ?? null : null);

  return {
    per: toNumber(info.per),
    pbr: toNumber(info.pbr),
    estPer: toNumber(info.cnsPer),
    dividendYield: toNumber(info.dividendYieldRatio),
    marketValue: info.marketValue ?? null, // "34조 3,341억" 형태 그대로
    estimateYear: estimateKey?.slice(0, 4) ?? null,
    revenue: series("매출액"),
    operatingProfit: series("영업이익"),
    roe: series("ROE"),
    operatingMargin: series("영업이익률"),
    debtRatio: series("부채비율"),
    revenueEst: estimate("매출액"),
    operatingProfitEst: estimate("영업이익"),
    targetPrice: toNumber(integ.consensusInfo?.priceTargetMean),
    recommMean: toNumber(integ.consensusInfo?.recommMean), // 1(매도)~5(매수)
  };
}

// 투자자별 순매수 (최신 → 오래된 순으로 오는 것을 오래된 → 최신 순으로 정리)
// 수량(주)과 그날 종가로 계산한 금액(원)을 함께 돌려줍니다.
export async function getInvestorFlows(code, days = 20) {
  const rows = await fetchJson(`https://m.stock.naver.com/api/stock/${code}/trend?pageSize=${days}`, {
    headers: REFERER,
  });
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => {
      const close = toNumber(r.closePrice) ?? 0;
      const foreign = toNumber(r.foreignerPureBuyQuant) ?? 0;
      const institution = toNumber(r.organPureBuyQuant) ?? 0;
      const individual = toNumber(r.individualPureBuyQuant) ?? 0;
      return {
        date: String(r.bizdate),
        close,
        foreign,
        institution,
        individual,
        foreignAmt: foreign * close,
        institutionAmt: institution * close,
        individualAmt: individual * close,
        foreignHoldRatio: toNumber(r.foreignerHoldRatio),
      };
    })
    .reverse();
}
