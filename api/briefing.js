// GET /api/briefing - 전일(장 마감된 마지막 거래일) 미국 시장 브리핑
// 지수·금리·원자재·섹터·빅테크 등락과, 그 숫자로 만든 요약 문장, 관련 뉴스
import { BRIEFING } from "../config/themes.js";
import { getDailyChange } from "./_lib/yahoo.js";
import { getNews } from "./_lib/naver.js";
import { rankThemes } from "./_lib/analyze.js";
import { sendJson, sendError } from "./_lib/http.js";

const sign = (v, d = 2) => `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;
const fmt = (v, d = 2) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

// 등락 크기를 말로
function move(v) {
  const a = Math.abs(v);
  if (a < 0.3) return "보합";
  if (a >= 3) return v > 0 ? "급등" : "급락";
  return v > 0 ? "상승" : "하락";
}

function vixLevel(v) {
  if (v < 15) return "안정";
  if (v < 20) return "보통";
  if (v < 30) return "경계";
  return "공포";
}

async function quotes(list) {
  const settled = await Promise.allSettled(list.map((x) => getDailyChange(x.symbol)));
  return list.map((x, i) =>
    settled[i].status === "fulfilled"
      ? { ...x, ok: true, price: settled[i].value.price, prevClose: settled[i].value.prevClose, changePct: settled[i].value.changePct, date: settled[i].value.date }
      : { ...x, ok: false }
  );
}

function summarize({ indices, macro, sectors, megacaps, themes, sessionDate }) {
  const by = (list, sym) => list.find((x) => x.symbol === sym && x.ok);
  const lines = [];
  const main = ["^GSPC", "^IXIC", "^DJI"].map((s) => by(indices, s)).filter(Boolean);
  if (main.length) {
    const ups = main.filter((x) => x.changePct > 0).length;
    const tone = ups === main.length ? "일제히 상승" : ups === 0 ? "일제히 하락" : "혼조";
    lines.push(`뉴욕증시 ${tone} 마감: ${main.map((x) => `${x.name} ${sign(x.changePct)}`).join(", ")}`);
  }
  const sox = by(indices, "^SOX");
  if (sox) lines.push(`필라델피아 반도체지수 ${sign(sox.changePct)} ${move(sox.changePct)}`);
  const ok = sectors.filter((x) => x.ok).sort((a, b) => b.changePct - a.changePct);
  if (ok.length >= 2) {
    const upCount = ok.filter((x) => x.changePct > 0).length;
    lines.push(
      `11개 업종 중 ${upCount}개 상승 · 가장 강한 업종 ${ok[0].name}(${sign(ok[0].changePct)}), 가장 약한 업종 ${ok.at(-1).name}(${sign(ok.at(-1).changePct)})`
    );
  }
  const mc = megacaps.filter((x) => x.ok).sort((a, b) => b.changePct - a.changePct);
  if (mc.length) {
    const top = `${mc[0].name}(${sign(mc[0].changePct)})`;
    const bottom = `${mc.at(-1).name}(${sign(mc.at(-1).changePct)})`;
    if (mc.every((x) => x.changePct < 0)) lines.push(`빅테크 ${mc.length}종목 모두 하락 · 가장 적게 내린 ${top}, 가장 많이 내린 ${bottom}`);
    else if (mc.every((x) => x.changePct > 0)) lines.push(`빅테크 ${mc.length}종목 모두 상승 · 가장 많이 오른 ${top}, 가장 적게 오른 ${bottom}`);
    else lines.push(`빅테크 ${mc.filter((x) => x.changePct > 0).length}종목 상승 · 가장 강한 ${top}, 가장 약한 ${bottom}`);
  }
  const vix = by(indices, "^VIX");
  if (vix) lines.push(`VIX 공포지수 ${fmt(vix.price)} (${sign(vix.changePct, 1)}) · ${vixLevel(vix.price)} 구간`);
  const parts = [];
  const tnx = by(macro, "^TNX");
  if (tnx) parts.push(`미 10년물 ${tnx.price.toFixed(2)}%(${tnx.price - tnx.prevClose >= 0 ? "+" : ""}${Math.round((tnx.price - tnx.prevClose) * 100)}bp)`);
  const dxy = by(macro, "DX-Y.NYB");
  if (dxy) parts.push(`달러인덱스 ${fmt(dxy.price)}(${sign(dxy.changePct)})`);
  const wti = by(macro, "CL=F");
  if (wti) parts.push(`WTI ${fmt(wti.price)}달러(${sign(wti.changePct)})`);
  const gold = by(macro, "GC=F");
  if (gold) parts.push(`금 ${fmt(gold.price, 1)}달러(${sign(gold.changePct)})`);
  if (parts.length) lines.push(parts.join(" · "));
  const rising = themes.filter((t) => t.avgChange > 0);
  const worst = themes.filter((t) => t.avgChange != null).at(-1);
  if (themes.length) {
    lines.push(
      rising.length
        ? `우리 테마 중 상승: ${rising.map((t) => `${t.name}(${sign(t.avgChange)})`).join(", ")}${worst && worst.avgChange < 0 ? ` · 가장 약한 테마 ${worst.name}(${sign(worst.avgChange)})` : ""}`
        : `우리 테마는 모두 하락 · 가장 약한 테마 ${worst.name}(${sign(worst.avgChange)})`
    );
  }
  return { sessionDate, lines };
}

export default async function handler(req, res) {
  try {
    const [indices, macro, sectors, megacaps, themeRank] = await Promise.all([
      quotes(BRIEFING.indices),
      quotes(BRIEFING.macro),
      quotes(BRIEFING.sectors),
      quotes(BRIEFING.megacaps),
      rankThemes().catch(() => ({ themes: [] })),
    ]);
    // 기준 거래일: 지수에서 가장 많이 나온 날짜
    const counts = {};
    indices.filter((x) => x.ok).forEach((x) => (counts[x.date] = (counts[x.date] || 0) + 1));
    const sessionDate = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const themes = themeRank.themes.map(({ kr, ...t }) => t);

    // 빅테크 뉴스를 모아 최신순, 같은 제목은 하나만
    const newsLists = await Promise.allSettled(BRIEFING.megacaps.map((m) => getNews(m.news, 4)));
    const seen = new Set();
    const news = newsLists
      .flatMap((r, i) => (r.status === "fulfilled" ? r.value.map((n) => ({ ...n, about: BRIEFING.megacaps[i].name })) : []))
      .sort((a, b) => b.time.localeCompare(a.time))
      .filter((n) => (seen.has(n.title) ? false : seen.add(n.title)))
      .slice(0, 10);

    const summary = summarize({ indices, macro, sectors, megacaps, themes, sessionDate });
    sendJson(res, 200, { updatedAt: new Date().toISOString(), sessionDate, summary: summary.lines, indices, macro, sectors, megacaps, themes, news }, 600);
  } catch (e) {
    sendError(res, e);
  }
}
