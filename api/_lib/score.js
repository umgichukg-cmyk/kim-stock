// 지표 계산과 100점 스코어링
// 기술 45 + 수급 45 + 기본 10 = 100
// 모든 점수는 실제 일봉, 투자자별 순매수, 재무 데이터에서만 계산합니다.
// 데이터가 부족하면 그 항목은 0점이 아니라 "계산 불가"로 표시하고 만점에서 제외합니다.

export function sma(values, period) {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let k = i - period + 1; k <= i; k++) sum += values[k];
    return sum / period;
  });
}

// Wilder 방식 RSI
export function rsi(closes, period = 14) {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// 거래량 가중 평균가: Σ(종가×거래량) / Σ거래량
export function vwap(candles, days) {
  if (candles.length < days) return null; // 기간만큼 데이터가 없으면 계산하지 않음
  const slice = candles.slice(-days);
  const vol = slice.reduce((s, c) => s + c.volume, 0);
  if (!vol) return null;
  return slice.reduce((s, c) => s + c.close * c.volume, 0) / vol;
}

const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

function eok(won) {
  const v = won / 1e8;
  return `${v >= 0 ? "+" : ""}${Math.abs(v) >= 100 ? Math.round(v).toLocaleString("ko-KR") : v.toFixed(1)}억`;
}

// ---------- 기술 점수 (45) ----------

function trendItem(closes) {
  const max = 15;
  const ma5 = sma(closes, 5).at(-1);
  const ma20 = sma(closes, 20).at(-1);
  const ma60 = sma(closes, 60).at(-1);
  const last = closes.at(-1);
  if (ma20 == null) return { key: "trend", label: "추세", max, score: null, detail: "일봉 20개 미만" };
  let score = 0;
  const notes = [];
  if (last > ma20) { score += 5; notes.push("주가>20일선"); } else notes.push("주가<20일선");
  if (ma5 > ma20) { score += 5; notes.push("5일선>20일선"); } else notes.push("5일선<20일선");
  if (ma60 != null) {
    if (ma20 > ma60) { score += 5; notes.push("20일선>60일선"); } else notes.push("20일선<60일선");
  } else notes.push("60일선 데이터 부족");
  return { key: "trend", label: "추세", max, score, detail: notes.join(" · ") };
}

function momentumItem(closes) {
  const max = 15;
  const r = rsi(closes, 14);
  if (r == null) return { key: "momentum", label: "모멘텀", max, score: null, detail: "일봉 15개 미만" };
  let score;
  let zone;
  if (r >= 80) { score = 3; zone = "과열"; }
  else if (r >= 70) { score = 8; zone = "강세·과열 근접"; }
  else if (r >= 50) { score = 15; zone = "건강한 상승"; }
  else if (r >= 40) { score = 9; zone = "중립"; }
  else if (r >= 30) { score = 4; zone = "약세"; }
  else { score = 2; zone = "과매도"; }
  return { key: "momentum", label: "모멘텀", max, score, detail: `RSI(14) ${r.toFixed(1)} · ${zone}`, rsi: r };
}

function volumeItem(candles) {
  const max = 15;
  if (candles.length < 25) return { key: "volume", label: "거래대금", max, score: null, detail: "일봉 25개 미만" };
  const values = candles.map((c) => c.close * c.volume);
  const recent = avg(values.slice(-5));
  const base = avg(values.slice(-25, -5));
  const ratio = base ? recent / base : 0;
  let score = 0;
  if (ratio >= 2) score = 15;
  else if (ratio >= 1.5) score = 12;
  else if (ratio >= 1.2) score = 9;
  else if (ratio >= 1) score = 6;
  else if (ratio >= 0.7) score = 3;
  return {
    key: "volume",
    label: "거래대금",
    max,
    score,
    detail: `최근 5일 평균이 직전 20일 평균의 ${(ratio * 100).toFixed(0)}%`,
    ratio,
  };
}

// ---------- 수급 점수 (45) ----------

// 5일 순매수 금액을 같은 5일간 전체 거래대금과 비교
function netBuyScore(ratio, max) {
  if (ratio >= 0.1) return max;
  if (ratio >= 0.05) return Math.round(max * 0.8);
  if (ratio >= 0.02) return Math.round(max * 0.6);
  if (ratio > 0) return Math.round(max * 0.4);
  if (ratio > -0.02) return Math.round(max * 0.2);
  return 0;
}

function investorItem(key, label, flows, candles) {
  const max = 18;
  const recent = flows.slice(-5);
  const traded = candles.slice(-recent.length).reduce((s, c) => s + c.close * c.volume, 0);
  if (recent.length < 3 || !traded) return { key, label, max, score: null, detail: "수급 데이터 부족" };
  const field = key === "foreign" ? "foreignAmt" : "institutionAmt";
  const net = recent.reduce((s, f) => s + f[field], 0);
  const ratio = net / traded;
  return {
    key,
    label,
    max,
    score: netBuyScore(ratio, max),
    detail: `최근 ${recent.length}일 순매수 ${eok(net)} (같은 기간 거래대금의 ${(ratio * 100).toFixed(1)}%)`,
    net,
  };
}

function consistencyItem(flows) {
  const max = 9;
  const recent = flows.slice(-5);
  if (recent.length < 3) return { key: "consistency", label: "매수 연속성", max, score: null, detail: "수급 데이터 부족" };
  const days = recent.filter((f) => f.foreignAmt + f.institutionAmt > 0).length;
  return {
    key: "consistency",
    label: "매수 연속성",
    max,
    score: Math.round((days / recent.length) * max),
    detail: `최근 ${recent.length}일 중 ${days}일 외국인+기관 순매수`,
  };
}

// ---------- 기본 점수 (10) ----------

// 실제 값 중 가장 최근 연도와 그 전년도
function lastTwo(series = []) {
  const valid = series.filter((p) => p.value != null);
  return [valid.at(-2) ?? null, valid.at(-1) ?? null];
}

function growthItem(f) {
  const max = 3;
  const [revPrev, revLast] = lastTwo(f?.revenue);
  const [opPrev, opLast] = lastTwo(f?.operatingProfit);
  if (!revLast || !opLast) return { key: "growth", label: "성장성", max, score: null, detail: "연간 실적 데이터 없음" };
  let score = 0;
  const notes = [];
  if (revPrev) {
    const up = revLast.value > revPrev.value;
    if (up) score += 1;
    notes.push(`${revLast.year} 매출 ${up ? "증가" : "감소"}`);
  }
  if (opPrev) {
    const up = opLast.value > opPrev.value;
    if (up) score += 1;
    notes.push(`영업이익 ${up ? "증가" : "감소"}`);
  }
  if (f.operatingProfitEst != null) {
    const up = f.operatingProfitEst > opLast.value;
    if (up) score += 1;
    notes.push(`${f.estimateYear} 추정 영업이익 ${up ? "개선" : "후퇴"}`);
  } else notes.push("추정치 없음");
  return { key: "growth", label: "성장성", max, score, detail: notes.join(" · ") };
}

function profitabilityItem(f) {
  const max = 3;
  const [, roe] = lastTwo(f?.roe);
  if (!roe) return { key: "profitability", label: "수익성", max, score: null, detail: "ROE 데이터 없음" };
  const v = roe.value;
  const score = v >= 10 ? 3 : v >= 5 ? 2 : v > 0 ? 1 : 0;
  const [, margin] = lastTwo(f?.operatingMargin);
  return {
    key: "profitability",
    label: "수익성",
    max,
    score,
    detail: `${roe.year} ROE ${v.toFixed(1)}%${margin ? ` · 영업이익률 ${margin.value.toFixed(1)}%` : ""}`,
  };
}

function valuationItem(f) {
  const max = 2;
  // 재무제표 자체가 없으면(ETF 등) 계산 불가, 실적은 있는데 PER이 없으면 적자로 보고 0점
  if (!f || !lastTwo(f.operatingProfit)[1]) return { key: "valuation", label: "가치", max, score: null, detail: "PER 데이터 없음" };
  const per = f.per;
  let score = 0;
  let note;
  if (per == null || per <= 0) note = "PER 없음(적자 등)";
  else {
    score = per <= 15 ? 2 : per <= 30 ? 1 : 0;
    note = `PER ${per.toFixed(1)}배`;
  }
  const extra = [f.pbr != null ? `PBR ${f.pbr.toFixed(2)}배` : null, f.estPer != null ? `추정PER ${f.estPer.toFixed(1)}배` : null];
  return { key: "valuation", label: "가치", max, score, detail: [note, ...extra].filter(Boolean).join(" · ") };
}

function stabilityItem(f) {
  const max = 2;
  const [, debt] = lastTwo(f?.debtRatio);
  if (!debt) return { key: "stability", label: "재무 안정성", max, score: null, detail: "부채비율 데이터 없음" };
  const v = debt.value;
  return {
    key: "stability",
    label: "재무 안정성",
    max,
    score: v <= 100 ? 2 : v <= 200 ? 1 : 0,
    detail: `${debt.year} 부채비율 ${v.toFixed(0)}%`,
  };
}

// ---------- 종합 ----------

// 종합 점수를 내려면 100점 중 이만큼은 계산할 수 있어야 함
const MIN_AVAILABLE = 60;

export function scoreStock(candles, flows, fundamentals) {
  const closes = candles.map((c) => c.close);

  const technical = [trendItem(closes), momentumItem(closes), volumeItem(candles)];
  const supply = [
    investorItem("foreign", "외국인", flows, candles),
    investorItem("institution", "기관", flows, candles),
    consistencyItem(flows),
  ];
  const basic = [
    growthItem(fundamentals),
    profitabilityItem(fundamentals),
    valuationItem(fundamentals),
    stabilityItem(fundamentals),
  ];

  const sum = (items) => items.reduce((s, i) => s + (i.score ?? 0), 0);
  const maxOf = (items) => items.reduce((s, i) => s + (i.score == null ? 0 : i.max), 0);
  const groups = [technical, supply, basic];
  const raw = groups.reduce((s, g) => s + sum(g), 0);
  const available = groups.reduce((s, g) => s + maxOf(g), 0);
  // 계산 가능한 항목만으로 100점 환산. 단, 계산 가능한 배점이 너무 적으면(신규 상장 등)
  // 몇 개 항목만으로 점수가 부풀려지므로 종합 점수를 내지 않음
  const total = available >= MIN_AVAILABLE ? Math.round((raw / available) * 100) : null;

  return {
    total,
    available,
    grade: total == null ? "데이터 부족" : total >= 75 ? "강함" : total >= 60 ? "양호" : total >= 45 ? "보통" : "약함",
    technical: { score: sum(technical), max: maxOf(technical), items: technical },
    supply: { score: sum(supply), max: maxOf(supply), items: supply },
    basic: { score: sum(basic), max: maxOf(basic), items: basic },
    complete: available === 100,
  };
}

// 가격 요약: 기간 수익률, 고가/저가, VWAP
export function priceStats(candles) {
  const last = candles.at(-1)?.close ?? null;
  // 90일 지표는 일봉이 90개 이상일 때만 (신규 상장 종목은 상장 후 기간이라 이름과 맞지 않음)
  const full = candles.length >= 90;
  const span = candles.slice(-90);
  const first = span[0]?.close;
  const closes = candles.map((c) => c.close);
  return {
    days: candles.length,
    return90: full && first && last ? ((last - first) / first) * 100 : null,
    high90: full ? Math.max(...span.map((c) => c.high)) : null,
    low90: full ? Math.min(...span.map((c) => c.low)) : null,
    vwap5: vwap(candles, 5),
    vwap20: vwap(candles, 20),
    ma5: sma(closes, 5).at(-1),
    ma20: sma(closes, 20).at(-1),
    ma60: sma(closes, 60).at(-1),
  };
}
