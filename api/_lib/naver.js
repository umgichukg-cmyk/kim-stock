// 네이버 증권 데이터 (인증키 불필요)
import { fetchJson, toNumber } from "./http.js";

const REFERER = { Referer: "https://m.stock.naver.com/" };

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
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
