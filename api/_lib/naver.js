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
  return {
    price,
    change,
    changePct: toNumber(j.fluctuationsRatio),
    prevClose: price != null && change != null ? price - change : null,
    status: j.marketStatus, // OPEN / CLOSE 등
    tradedAt: j.localTradedAt,
  };
}

// 국내 지수 오늘 1분봉 (장중 흐름 차트용, 오래된 순). time은 "HHmm"
export async function getIndexMinute(index) {
  const rows = await fetchJson(`https://api.stock.naver.com/chart/domestic/index/${index}/minute`, { headers: REFERER });
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ date: String(r.localDateTime).slice(0, 8), time: String(r.localDateTime).slice(8, 12), price: r.currentPrice }))
    .filter((r) => r.price > 0);
}

// 국내 지수 분봉 캔들 (fromYmd부터, bucket분 단위로 묶음). time은 Yahoo와 같은 "한국 시각을 UTC처럼 쓴" 초
export async function getIndexMinuteCandles(index, fromYmd, bucket = 1) {
  const rows = await fetchJson(
    `https://api.stock.naver.com/chart/domestic/index/${index}/minute?startDateTime=${fromYmd}0900&endDateTime=${ymd(new Date(Date.now() + 9 * 3600_000))}1600`,
    { headers: REFERER }
  );
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!(r.currentPrice > 0)) continue;
    const s = String(r.localDateTime);
    const minute = Number(s.slice(8, 10)) * 60 + Number(s.slice(10, 12));
    const start = minute - (minute % bucket);
    const time = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), Math.floor(start / 60), start % 60) / 1000;
    const last = out.at(-1);
    if (last?.time === time) {
      last.high = Math.max(last.high, r.highPrice);
      last.low = Math.min(last.low, r.lowPrice);
      last.close = r.currentPrice;
      last.volume += r.accumulatedTradingVolume ?? 0;
    } else {
      out.push({ date: s.slice(0, 8), time, open: r.openPrice, high: r.highPrice, low: r.lowPrice, close: r.currentPrice, volume: r.accumulatedTradingVolume ?? 0 });
    }
  }
  return out;
}

// 종목 분봉(최근 days거래일 1분봉)·주봉(약 10년)·월봉(2000년부터) 캔들 (오래된 순)
// time은 분봉이면 한국 시각을 UTC처럼 쓴 초, 주봉·월봉이면 "YYYY-MM-DD" (차트 라이브러리 형식)
export async function getStockCandles(code, period, days = 5) {
  const today = new Date(Date.now() + 9 * 3600_000);
  const ago = (n) => ymd(new Date(today.getTime() - n * 86400_000));
  const from = period === "minute" ? `${ago(days + 9)}0000` : period === "week" ? `${ago(3660)}0000` : "200001010000";
  const rows = await fetchJson(
    `https://api.stock.naver.com/chart/domestic/item/${code}/${period}?startDateTime=${from}&endDateTime=${ymd(today)}2359`,
    { headers: REFERER }
  );
  if (!Array.isArray(rows)) return [];
  if (period !== "minute") {
    return rows
      .filter((r) => r.closePrice > 0)
      .map((r) => {
        const d = String(r.localDate);
        return { time: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, open: r.openPrice, high: r.highPrice, low: r.lowPrice, close: r.closePrice, volume: r.accumulatedTradingVolume ?? 0 };
      });
  }
  // 정규장(09:00~15:30)만: 네이버 분봉에는 대체거래소(넥스트레이드) 애프터마켓 거래가 저녁 8시까지 섞여 있음
  const regular = (s) => s.slice(8, 12) >= "0900" && s.slice(8, 12) <= "1530";
  const out = rows
    .filter((r) => r.currentPrice > 0 && regular(String(r.localDateTime)))
    .map((r) => {
      const s = String(r.localDateTime);
      return {
        date: s.slice(0, 8),
        time: Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)) / 1000,
        open: r.openPrice,
        high: r.highPrice,
        low: r.lowPrice,
        close: r.currentPrice,
        volume: r.accumulatedTradingVolume ?? 0,
      };
    });
  const dates = [...new Set(out.map((c) => c.date))].slice(-days);
  return out.filter((c) => dates.includes(c.date));
}

// 국내 지수 일봉(day)·주봉(week) 캔들 (오래된 순). time은 그날 0시를 UTC처럼 쓴 초
export async function getIndexCandles(index, period, fromYmd) {
  const rows = await fetchJson(
    `https://api.stock.naver.com/chart/domestic/index/${index}/${period}?startDateTime=${fromYmd}0000&endDateTime=${ymd(new Date(Date.now() + 9 * 3600_000))}2359`,
    { headers: REFERER }
  );
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r.closePrice > 0)
    .map((r) => {
      const d = String(r.localDate);
      return {
        time: Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) / 1000,
        open: r.openPrice,
        high: r.highPrice,
        low: r.lowPrice,
        close: r.closePrice,
        volume: r.accumulatedTradingVolume ?? 0,
      };
    });
}

// 실시간 시세 목록의 종목 한 줄 (거래대금은 억 원)
function liveRow(s) {
  return {
    code: s.itemCode,
    name: s.stockName,
    market: s.sosok === "1" ? "코스닥" : "코스피",
    type: s.stockEndType,
    price: toNumber(s.closePrice),
    changePct: toNumber(s.fluctuationsRatio),
    value: Math.round((toNumber(s.accumulatedTradingValue) ?? 0) / 100),
    marketValue: toNumber(s.marketValue),
    limit: s.compareToPreviousPrice?.name === "UPPER_LIMIT" ? "upper" : s.compareToPreviousPrice?.name === "LOWER_LIMIT" ? "lower" : null,
  };
}

// 실시간 순위: up(상승률) / down(하락률) / priceTop(거래대금). total은 그 목록 전체 종목 수
export async function getRanking(kind, market, size = 100) {
  const j = await fetchJson(`https://m.stock.naver.com/api/stocks/${kind}/${market}?page=1&pageSize=${size}`, { headers: REFERER });
  return { total: j.totalCount ?? 0, stocks: (j.stocks || []).map(liveRow) };
}

// 업종·테마 소속 종목의 지금 시세
export async function getGroupLive(kind, no) {
  const j = await fetchJson(`https://m.stock.naver.com/api/stocks/${kind}/${no}?page=1&pageSize=100`, { headers: REFERER });
  return { name: j.groupInfo?.name ?? null, stocks: (j.stocks || []).map(liveRow) };
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

// 업종(industry)·테마(theme)별 등락 (마지막 시세 기준, 등락률 높은 순)
async function getGroups(kind) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const j = await fetchJson(`https://m.stock.naver.com/api/stocks/${kind}?page=${page}&pageSize=50`, { headers: REFERER, retries: 0 }).catch(
      () => null
    );
    if (!j?.groups?.length) break;
    all.push(...j.groups.map((g) => ({ no: g.no, name: g.name, changePct: toNumber(g.changeRate), count: g.totalCount, up: g.riseCount, down: g.fallCount })));
  }
  return all;
}

export const getIndustries = () => getGroups("industry");
export const getThemes = () => getGroups("theme");

// 업종·테마에 속한 종목 (시가총액은 억 원)
export const getIndustryStocks = (no) => getGroupStocks("industry", no);
export const getThemeStocks = (no) => getGroupStocks("theme", no);

async function getGroupStocks(kind, no) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const j = await fetchJson(`https://m.stock.naver.com/api/stocks/${kind}/${no}?page=${page}&pageSize=100`, { headers: REFERER });
    if (!j.stocks?.length) break;
    all.push(...j.stocks.map((s) => ({ code: s.itemCode, name: s.stockName, type: s.stockEndType, marketValue: toNumber(s.marketValue) })));
    if (j.stocks.length < 100) break;
  }
  return all;
}

// 공모주: 청약 일정이 잡힌 기업과 상장 준비 중인 기업 (네이버 공모주 목록)
const IPO_MARKET = { D: "코스닥", K: "코스피" };
export async function getIpoList() {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const j = await fetchJson(`https://m.stock.naver.com/api/stocks/ipo?page=${page}&pageSize=50`, { headers: REFERER });
    if (!j.ipoCoInfos?.length) break;
    all.push(...j.ipoCoInfos);
    if (all.length >= (j.totalCount ?? 0)) break;
  }
  const blank = (v) => (v == null || v === "" ? null : v);
  return all.map((x) => ({
    code: x.itemCode,
    name: x.itemName,
    category: blank(x.bizCategory),
    market: IPO_MARKET[x.marketClasses] ?? null,
    stage: blank(x.ipoStatus), // 예비심사청구서제출 → 예비심사청구승인 → 증권신고서제출 → 수요예측 → 수요예측완료
    subStart: blank(x.poStartDate), // 청약 시작일 YYYYMMDD
    subEnd: blank(x.poEndDate),
    listingDate: blank(x.listedDueDate),
    priceLow: toNumber(x.expectedPoStart),
    priceHigh: toNumber(x.expectedPoEnd),
    price: toNumber(x.poPrice), // 확정 공모가
    institutionRate: toNumber(x.instituteCompRate), // 기관 수요예측 경쟁률
    subscriptionRate: toNumber(x.subscriptCompRate), // 일반 청약 경쟁률
    leadManager: blank(x.leadManager),
    coManager: blank(x.coHost),
    url: x.endUrl || null,
    docs: (x.ipoInvestInfoList || []).filter((d) => d.contentUrl).map((d) => ({ title: d.articleTitle, url: d.contentUrl })),
  }));
}

// 공모주 상세: 수요예측 결과, 공모 규모, 최근 실적 (금액은 원)
export async function getIpoDetail(code) {
  const j = await fetchJson(`https://m.stock.naver.com/front-api/ipo/detail?code=${encodeURIComponent(code)}`, { headers: REFERER });
  const r = j.result || j;
  const reg = r.registrationStatement || {};
  const fin = r.registrationStatementDetail || {};
  const df = r.demandForecastingResult || {};
  return {
    rate: df.cmptnRate ?? null, // 기관 수요예측 경쟁률
    fixedPrice: df.fixPubPrice ?? null,
    amount: df.fnlPoPrice ?? reg.pubPriceEnd ?? null, // 확정 공모금액, 없으면 희망 상단 기준 금액
    bandLow: reg.hopePubStart ?? null,
    bandHigh: reg.hopePubEnd ?? null,
    // 재무: n0 = 최근(분기 누적일 수 있음), n1 = 직전 연도, n2 = 그 전 연도
    fin: fin.notEmpty
      ? {
          periods: [fin.n0Ptitle, fin.n1Ptitle, fin.n2Ptitle],
          sales: [fin.n0Sales, fin.n1Sales, fin.n2Sales],
          opProfit: [fin.n0BizPrft, fin.n1BizPrft, fin.n2BizPrft],
        }
      : null,
    majorHolderRatio: r.listedExamination?.largstShareRatio ?? null,
    companyClass: r.listedExamination?.compClass ?? null,
  };
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
