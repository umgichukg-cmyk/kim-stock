// 네이버 증권 데이터 (인증키 불필요)
import { fetchJson, toNumber } from "./http.js";

const REFERER = { Referer: "https://m.stock.naver.com/" };

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
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
