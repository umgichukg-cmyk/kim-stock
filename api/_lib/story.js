// 한국 시장 장중 흐름을 친구가 말해 주듯 풀어 쓴 브리핑
// 모든 문장은 /api/kr-live 숫자에서만 만들고, 숫자가 없으면 그 문장을 빼요. (예측·추천 문장은 쓰지 않음)

// ---------- 한국어 조사 ----------
const DIGIT_BATCHIM = { 0: true, 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: true, 8: true, 9: false };
function hasBatchim(word) {
  const ch = String(word).trim().at(-1) ?? "";
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/\d/.test(ch)) return DIGIT_BATCHIM[ch];
  if (/[lmnr]/i.test(ch)) return true; // 영어 이름은 대략
  return false;
}
// josa("코스닥", "은/는") → "코스닥은"
const josa = (word, pair) => {
  const [withB, withoutB] = pair.split("/");
  // "으로/로"는 ㄹ 받침 뒤에도 "로" (서울로, 1로, 7로, 8로)
  if (pair === "으로/로" && endsWithRieul(word)) return `${word}로`;
  return `${word}${hasBatchim(word) ? withB : withoutB}`;
};
function endsWithRieul(word) {
  const ch = String(word).trim().at(-1) ?? "";
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 8;
  return ["1", "7", "8"].includes(ch);
}

// ---------- 누를 수 있는 이름 ----------
// 화면이 버튼으로 바꿔요: [[종류|번호|이름]] - s 종목 상세, i 업종, t 테마, x 지수 상세 차트
const link = (kind, id, name) => `[[${kind}|${id}|${String(name).replace(/[|]]/g, " ")}]]`;
// 이름 링크 + 조사: linkJ("s", "005930", "삼성전자", "이/가") → [[s|005930|삼성전자]]가
const linkJ = (kind, id, name, pair) => `${link(kind, id, name)}${josa(name, pair).slice(String(name).length)}`;
const INDEX_CHART = { KOSPI: "kospi", KOSDAQ: "kosdaq", KPI200: "kpi200" };

// ---------- 숫자 ----------
const n0 = (v) => Math.round(v).toLocaleString("ko-KR");
const n2 = (v) => v.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
// 억 원 → "3,712억" / "1조 5,467억"
function eok(v) {
  const a = Math.abs(Math.round(v));
  if (a < 10000) return `${n0(a)}억`;
  const jo = Math.floor(a / 10000);
  const rest = a % 10000;
  return rest ? `${jo}조 ${n0(rest)}억` : `${jo}조`;
}
// "1020" → "10시 20분"
const clock = (t) => `${Number(t.slice(0, 2))}시${t.slice(2) === "00" ? "" : ` ${Number(t.slice(2))}분`}`;

// ---------- 문단 ----------

function indexLine(x, live) {
  if (!x?.ok || !x.points?.length || x.prevClose == null) return null;
  const pts = x.points;
  const open = pts[0][1];
  const gap = ((open - x.prevClose) / x.prevClose) * 100;
  const hi = pts.reduce((a, p) => (p[1] > a[1] ? p : a));
  const lo = pts.reduce((a, p) => (p[1] < a[1] ? p : a));
  const start = gap >= 0.3 ? `${josa(n2(open), "으로/로")} 위에서 출발했어` : gap <= -0.3 ? `${josa(n2(open), "으로/로")} 아래에서 출발했어` : `전날과 비슷한 ${n2(open)}에서 출발했어`;
  const now = live ? "지금은" : "마감은";
  const result = `${now} ${n2(x.price)}, 전날보다 ${pct(x.changePct)}${x.changePct > 0 ? " 올랐어" : x.changePct < 0 ? " 내렸어" : "로 제자리야"}`;
  // 하루 폭이 아주 작으면 흐름 설명은 생략
  const range = ((hi[1] - lo[1]) / x.prevClose) * 100;
  let path = "";
  if (range >= 0.4 && pts.length >= 10) {
    const first = pts[0][0];
    if (hi[0] > lo[0]) {
      path = lo[0] === first ? ` 그 자리가 오늘 저점이었고 ${clock(hi[0])}쯤 ${n2(hi[1])}까지 올라왔고,` : ` ${clock(lo[0])}쯤 ${n2(lo[1])}까지 밀렸다가 ${clock(hi[0])}쯤 ${n2(hi[1])}까지 올라왔고,`;
    } else {
      path = hi[0] === first ? ` 그 자리가 오늘 고점이었고 ${clock(lo[0])}쯤 ${n2(lo[1])}까지 밀렸고,` : ` ${clock(hi[0])}쯤 ${n2(hi[1])}까지 올랐다가 ${clock(lo[0])}쯤 ${n2(lo[1])}까지 밀렸고,`;
    }
    const pos = hi[1] === lo[1] ? 0.5 : (x.price - lo[1]) / (hi[1] - lo[1]);
    const where = pos >= 0.85 ? "고점 근처" : pos <= 0.15 ? "저점 근처" : pos >= 0.5 ? "고점에서 조금 내려온 자리" : "저점에서 조금 올라온 자리";
    return `${linkJ("x", INDEX_CHART[x.symbol], x.name, "은/는")} ${start}.${path} ${result}. ${live ? `하루 범위로 보면 ${where}야.` : `하루 범위로 보면 ${where}에서 끝났어.`}`;
  }
  return `${linkJ("x", INDEX_CHART[x.symbol], x.name, "은/는")} ${start}. ${result}.`;
}

function indexPara(indices, live) {
  const kospi = indices.find((x) => x.symbol === "KOSPI");
  const kosdaq = indices.find((x) => x.symbol === "KOSDAQ");
  const lines = [indexLine(kospi, live), indexLine(kosdaq, live)].filter(Boolean);
  if (!lines.length) return null;
  if (kospi?.ok && kosdaq?.ok) {
    const a = kospi.changePct, b = kosdaq.changePct;
    const tail =
      a > 0 && b > 0 ? "두 시장이 같이 오르고 있어." : a < 0 && b < 0 ? "두 시장이 같이 약해." : a > 0 ? "코스피는 오르는데 코스닥은 힘이 없어서, 큰 종목 위주로 움직이는 장이야." : b > 0 ? "코스닥이 코스피보다 강해서 중소형주 쪽 분위기가 더 좋아." : "";
    if (tail) lines.push(live ? tail : tail.replace("오르고 있어.", "올랐어.").replace("약해.", "약했어.").replace("장이야.", "장이었어.").replace("좋아.", "좋았어."));
  }
  return { title: "지수 흐름", text: lines.join(" ") };
}

const WHO = { foreign: "외국인", institution: "기관", individual: "개인" };

function flowPara(investors, live) {
  const k = investors?.KOSPI;
  if (!k || k.foreign == null) return null;
  const doing = (v) => (v > 0 ? (live ? "사는 중이고" : "샀고") : live ? "파는 중이고" : "팔았고");
  const sorted = Object.keys(WHO).sort((a, b) => Math.abs(k[b]) - Math.abs(k[a]));
  // 금액이 큰 순서로 누가 사고 누가 파는지
  const parts = sorted.map((w, i) => `${WHO[w]}${i === 0 ? "이" : "은"} ${eok(k[w])} ${doing(k[w])}`);
  let text = `코스피 수급을 보면 ${parts.join(", ").replace(/(중이고|샀고|팔았고)$/, (m) => (m === "중이고" ? "중이야" : m === "샀고" ? "샀어" : "팔았어"))}.`;
  const f = k.foreign, inst = k.institution;
  if (f > 0 && inst > 0) text += " 외국인이랑 기관이 같이 사고 있어서 수급은 좋은 편이야.";
  else if (f < 0 && inst < 0) text += " 외국인이랑 기관이 같이 팔고 있어서 수급은 부담스러운 편이야.";
  else if (f < 0 && inst > 0) text += ` 외국인이 파는 걸 기관이 받아 주는 모양이야.`;
  else if (f > 0 && inst < 0) text += ` 외국인이 사는 걸 기관이 팔면서 맞서는 모양이야.`;
  const q = investors?.KOSDAQ;
  if (q?.foreign != null) {
    const big = Object.keys(WHO).sort((a, b) => Math.abs(q[b]) - Math.abs(q[a]))[0];
    text += ` 코스닥은 ${WHO[big]}이 ${eok(q[big])} ${q[big] > 0 ? "순매수" : "순매도"}로 제일 크게 움직이고 있어.`;
  }
  if (!live)
    text = text
      .replace("움직이고 있어.", "움직였어.")
      .replace("사고 있어서", "사서")
      .replace("팔고 있어서", "팔아서")
      .replace("받아 주는 모양이야.", "받아 준 하루였어.")
      .replace("맞서는 모양이야.", "맞선 하루였어.");
  return { title: "수급", text: `${text} ${live ? "(금액은 장중 잠정치야.)" : "(금액은 잠정치라 저녁 확정치와 조금 다를 수 있어.)"}` };
}

function moodPara(breadth, indices, limits, live) {
  const up = (breadth?.KOSPI?.up ?? 0) + (breadth?.KOSDAQ?.up ?? 0);
  const down = (breadth?.KOSPI?.down ?? 0) + (breadth?.KOSDAQ?.down ?? 0);
  if (!up && !down) return null;
  const ratio = up / (up + down);
  let text = `코스피·코스닥 합쳐서 오른 종목이 ${n0(up)}개, 내린 종목이 ${n0(down)}개야.`;
  const kospi = indices.find((x) => x.symbol === "KOSPI");
  if (kospi?.ok && kospi.changePct > 0.3 && ratio < 0.45) text += " 지수는 오르는데 내린 종목이 더 많아서, 몇몇 큰 종목이 지수를 끌어올리는 장이야. 들고 있는 종목은 체감이 다를 수 있어.";
  else if (kospi?.ok && kospi.changePct < -0.3 && ratio > 0.55) text += " 지수는 내렸는데 오른 종목이 더 많아. 큰 종목 몇 개가 지수를 끌어내리는 거라 전체 분위기는 생각보다 괜찮아.";
  else if (ratio >= 0.6) text += " 오른 종목이 확실히 많아서 전체 분위기가 좋아.";
  else if (ratio <= 0.4) text += " 내린 종목이 훨씬 많아서 전체 분위기는 약한 편이야.";
  else text += " 오른 종목과 내린 종목이 비슷해서 종목마다 갈리는 장이야.";
  const upper = limits?.upper?.length ?? 0;
  const lower = limits?.lower?.length ?? 0;
  if (upper || lower) text += ` 보통주 중 상한가는 ${upper}개, 하한가는 ${lower}개야.`;
  if (!live) text = text.replace("좋아.", "좋았어.").replace("편이야.", "편이었어.").replace("장이야.", "장이었어.");
  return { title: "시장 분위기", text };
}

function groupPara(industries, themes, live) {
  const parts = [];
  const name = (k, g) => `${link(k, g.no, g.name)}(${pct(g.changePct)})`;
  // 조사는 괄호 앞 이름 기준: 조선(+7.90%)이
  const nameJ = (k, g, pair) => `${name(k, g)}${josa(g.name, pair).slice(g.name.length)}`;
  if (industries?.top?.length) {
    const [a, b] = industries.top;
    parts.push(`업종으로는 ${nameJ("i", a, "이/가")} 제일 세고${b ? `, 그다음이 ${name("i", b)}야` : "야"}.`);
    const w = industries.bottom?.[0];
    if (w && w.changePct < 0) parts.push(`반대로 ${nameJ("i", w, "은/는")} 제일 약해.`);
  }
  if (themes?.top?.length) {
    const top = themes.top.slice(0, 3).filter((t) => t.changePct > 0);
    if (top.length) parts.push(`테마는 ${top.map((t) => name("t", t)).join(", ")} 쪽으로 돈이 몰리고 있어.`);
    const w = themes.bottom?.[0];
    if (w && w.changePct < 0) parts.push(`${nameJ("t", w, "은/는")} 많이 빠지는 테마야.`);
  }
  if (!parts.length) return null;
  let text = parts.join(" ");
  if (!live) text = text.replace("몰리고 있어.", "몰렸어.").replace("많이 빠지는 테마야.", "많이 빠진 테마야.").replace("제일 약해.", "제일 약했어.");
  return { title: "업종 · 테마", text };
}

function stockPara(movers, limits) {
  const parts = [];
  const v = movers?.value ?? [];
  if (v.length >= 2) {
    const [a, b] = v;
    parts.push(`거래대금은 ${linkJ("s", a.code, a.name, "이/가")} ${josa(eok(a.value), "으로/로")} 제일 많고(${pct(a.changePct)}), ${linkJ("s", b.code, b.name, "이/가")} ${josa(eok(b.value), "으로/로")} 그다음이야(${pct(b.changePct)}).`);
  }
  const up = limits?.upper ?? [];
  if (up.length) {
    const shown = up.slice(0, 4);
    const names = shown.map((s) => link("s", s.code, s.name)).join(", ");
    const last = shown.at(-1).name;
    parts.push(up.length > 4 ? `상한가는 ${names} 등 ${up.length}종목이야.` : `상한가는 ${names}${josa(last, "이야/야").slice(last.length)}.`);
  }
  const g = (movers?.gainers ?? []).find((s) => s.limit !== "upper");
  if (g) parts.push(`상한가 말고 제일 많이 오른 건 ${link("s", g.code, g.name)}(${pct(g.changePct)})야.`);
  const l = (movers?.losers ?? [])[0];
  if (l) parts.push(`${linkJ("s", l.code, l.name, "은/는")} ${pct(l.changePct)}로 많이 빠졌어.`);
  return parts.length ? { title: "눈에 띄는 종목", text: parts.join(" ") } : null;
}

export function buildStory(data, news = []) {
  const live = data.status === "OPEN";
  const paras = [
    indexPara(data.indices ?? [], live),
    flowPara(data.investors, live),
    moodPara(data.breadth, data.indices ?? [], data.limits, live),
    groupPara(data.industries, data.themes, live),
    stockPara(data.movers, data.limits),
  ].filter(Boolean);
  if (!paras.length) return null;
  return {
    headline: live ? "김가들아~ 지금 시장 이렇게 흘러가고 있어" : "김가들아~ 오늘 시장 이렇게 끝났어",
    paragraphs: paras,
    news: news.slice(0, 2).map(({ title, press, url, time }) => ({ title, press, url, time })),
  };
}
