// 조건 검색: 거래량이 터지면서 5일선이 20일선을 골든크로스하고 외국인·기관이 같이 산 날 찾기
//
// 조건 (모두 같은 날):
//  - 거래량이 직전 20거래일 평균의 2배 이상 (5배 이상이면 "엄격")
//  - 5일선이 20일선을 아래에서 위로 넘음
//  - 외국인·기관 모두 순매수
// "엄격"은 거래량 5배 이상이면서 과열(RSI 80 이상 또는 20일선보다 20% 이상 높음)이 아닌 경우.
// 1년치 검증(2025-11~2026-10)에서 시장 상태가 "상승"인 날의 엄격 신호가 가장 나았지만
// 46건뿐이라 매수 신호가 아니라 살펴볼 후보 목록으로만 씀.
import { rsi } from "./score.js";

export const SIGNAL_RULE = { volume: 2, strictVolume: 5, overheatRsi: 80, overheatGap: 20 };

const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;

// candles: 일봉(오래된 → 최신), flows: 투자자별 순매수(getInvestorFlows 결과)
// 수급이 있는 날짜마다 조건을 확인해서 맞는 날만 돌려줌
export function findSignals(candles, flows) {
  const flowByDate = new Map(flows.map((f) => [f.date, f]));
  const out = [];
  for (let t = 25; t < candles.length; t++) {
    const c = candles[t];
    const f = flowByDate.get(c.date);
    if (!f || !(f.foreign > 0 && f.institution > 0)) continue;
    const base = avg(candles.slice(t - 20, t).map((x) => x.volume));
    const volx = base ? c.volume / base : 0;
    if (volx < SIGNAL_RULE.volume) continue;
    const ma = (n, k) => avg(candles.slice(k - n + 1, k + 1).map((x) => x.close));
    const ma20 = ma(20, t);
    if (!(ma(5, t) > ma20 && ma(5, t - 1) <= ma(20, t - 1))) continue;
    const r = rsi(candles.slice(Math.max(0, t - 60), t + 1).map((x) => x.close), 14);
    const gap = (c.close / ma20 - 1) * 100;
    const overheat = (r != null && r >= SIGNAL_RULE.overheatRsi) || gap >= SIGNAL_RULE.overheatGap;
    out.push({
      date: c.date,
      close: c.close,
      changePct: ((c.close - candles[t - 1].close) / candles[t - 1].close) * 100,
      volx: Math.round(volx * 10) / 10,
      foreignEok: Math.round(f.foreignAmt / 1e7) / 10, // 억 원
      institutionEok: Math.round(f.institutionAmt / 1e7) / 10,
      overheat,
      strict: volx >= SIGNAL_RULE.strictVolume && !overheat,
    });
  }
  return out;
}
