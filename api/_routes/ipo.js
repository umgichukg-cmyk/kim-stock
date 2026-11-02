// GET /api/ipo - 공모주 청약 일정 (청약일이 잡힌 기업은 청약일 순, 나머지는 상장 준비 중)
// 청약 일정이 잡힌 기업은 상세 정보로 참고용 "청약 점수"를 계산합니다.
//   기관 경쟁률 40 + 공모가 위치 25 + 실적 20 + 공모 규모 15 = 100
//   검증되지 않은 규칙 기반 점수이고, 의무보유확약·유통 물량은 데이터가 없어 빠져 있습니다.
import { getIpoList, getIpoDetail } from "../_lib/naver.js";
import { sendJson, sendError } from "../_lib/http.js";

const eok = (won) => `${Math.round(won / 1e8).toLocaleString("ko-KR")}억`;

function rateItem(rate) {
  const max = 40;
  if (!rate) return { label: "기관 경쟁률", max, score: null, detail: "수요예측 전" };
  const score = rate >= 1000 ? 40 : rate >= 500 ? 32 : rate >= 200 ? 22 : rate >= 100 ? 14 : 5;
  return { label: "기관 경쟁률", max, score, detail: `${rate.toLocaleString("ko-KR")} : 1` };
}

function priceItem(d) {
  const max = 25;
  if (!d.fixedPrice || !d.bandHigh) return { label: "공모가 위치", max, score: null, detail: "공모가 확정 전" };
  const p = d.fixedPrice;
  if (p > d.bandHigh) return { label: "공모가 위치", max, score: 25, detail: "희망 범위 상단 초과" };
  if (p === d.bandHigh) return { label: "공모가 위치", max, score: 20, detail: "희망 범위 상단" };
  if (p > d.bandLow) return { label: "공모가 위치", max, score: 10, detail: "희망 범위 안" };
  return { label: "공모가 위치", max, score: 0, detail: p < d.bandLow ? "희망 범위 하단 미만" : "희망 범위 하단" };
}

function earningsItem(fin) {
  const max = 20;
  if (!fin) return { label: "실적", max, score: null, detail: "실적 정보 없음" };
  const [s0, s1, s2] = fin.sales;
  const [o0, o1, o2] = fin.opProfit;
  let score = 0;
  const notes = [];
  if (o0 != null) {
    if (o0 > 0) score += 8;
    notes.push(`최근 영업${o0 > 0 ? "이익" : "손실"} ${eok(Math.abs(o0))}`);
  }
  if (o1 != null && o1 > 0) score += 4;
  if (s1 != null && s2 != null && s1 > s2) {
    score += 4;
    notes.push("매출 증가");
  }
  if (o1 != null && o2 != null && o1 > o2) {
    score += 4;
    notes.push(o1 > 0 && o2 > 0 ? "영업이익 증가" : "영업손익 개선"); // 적자 폭이 줄어든 경우 등
  }
  return { label: "실적", max, score, detail: notes.join(" · ") || "-" };
}

function sizeItem(amount) {
  const max = 15;
  if (!amount) return { label: "공모 규모", max, score: null, detail: "공모 규모 정보 없음" };
  const e = amount / 1e8;
  const score = e <= 300 ? 15 : e <= 500 ? 12 : e <= 1000 ? 8 : e <= 3000 ? 5 : 3;
  return { label: "공모 규모", max, score, detail: `약 ${eok(amount)}원` };
}

function ipoScore(x, d) {
  if (/스팩/.test(x.name)) return { spac: true, total: null, grade: "스팩", items: [] };
  const items = [rateItem(d.rate), priceItem(d), earningsItem(d.fin), sizeItem(d.amount)];
  // 경쟁률·공모가는 수요예측이 끝나야 나와서, 둘 중 하나라도 없으면 종합 점수를 내지 않음
  const ready = items[0].score != null && items[1].score != null;
  const total = ready ? items.reduce((s, i) => s + (i.score ?? 0), 0) : null;
  const grade = total == null ? "수요예측 전" : total >= 75 ? "유리" : total >= 60 ? "양호" : total >= 45 ? "보통" : "주의";
  return { spac: false, total, grade, items };
}

export default async function handler(req, res) {
  try {
    const all = await getIpoList();
    const scheduled = all.filter((x) => x.subStart).sort((a, b) => a.subStart.localeCompare(b.subStart) || a.name.localeCompare(b.name));
    const pending = all.filter((x) => !x.subStart);

    const details = await Promise.allSettled(scheduled.map((x) => getIpoDetail(x.code)));
    scheduled.forEach((x, i) => {
      const d = details[i].status === "fulfilled" ? details[i].value : null;
      x.score = d ? ipoScore(x, d) : null;
      if (d) Object.assign(x, { amount: d.amount, majorHolderRatio: d.majorHolderRatio, companyClass: d.companyClass });
    });

    sendJson(res, 200, { updatedAt: new Date().toISOString(), scheduled, pending }, 1800);
  } catch (e) {
    sendError(res, e);
  }
}
