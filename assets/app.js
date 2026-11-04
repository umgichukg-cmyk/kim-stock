// 김가네 주식 - 화면
// 데이터는 모두 /api/* 에서 받아오고, 받아오지 못하면 지어내지 않고 오류를 그대로 보여줍니다.

import * as account from "./account.js";

const $ = (sel) => document.querySelector(sel);
const REFRESH_MS = 60_000;

const state = {
  picks: [],
  themes: [],
  topThemes: [],
  filter: "전체",
  loading: false,
};

// ---------- 형식 ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dir = (v) => (v == null || Math.abs(v) < 0.005 ? "flat" : v > 0 ? "up" : "down");
const arrow = (v) => (v == null || Math.abs(v) < 0.005 ? "" : v > 0 ? "▲" : "▼");
const pct = (v, d = 2) => (v == null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const won = (v) => (v == null ? "-" : Math.round(v).toLocaleString("ko-KR"));
const num = (v, d = 2) => (v == null ? "-" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const eok = (v) => {
  if (v == null) return "-";
  const e = v / 1e8;
  const s = Math.abs(e) >= 100 ? Math.round(e).toLocaleString("ko-KR") : e.toFixed(1);
  return `${e > 0 ? "+" : ""}${s}억`;
};
const dateLabel = (ymd) => `${ymd.slice(4, 6)}.${ymd.slice(6, 8)}`;
const timeLabel = (d) => d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// ---------- 작은 그래프 ----------

function sparkline(points, { width = 120, height = 30, base = null } = {}) {
  if (!points || points.length < 2) return `<svg viewBox="0 0 ${width} ${height}"></svg>`;
  const ref = base ?? points[0];
  const min = Math.min(...points, ref);
  const max = Math.max(...points, ref);
  const span = max - min || 1;
  const x = (i) => (i / (points.length - 1)) * width;
  const y = (v) => height - 2 - ((v - min) / span) * (height - 4);
  const line = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const color = `var(--${dir(points.at(-1) - ref)})`;
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2="${width}" y1="${y(ref)}" y2="${y(ref)}" stroke="var(--border)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
  </svg>`;
}

function ring(score, grade) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const v = score ?? 0;
  const color = v >= 75 ? "var(--up)" : v >= 60 ? "var(--accent)" : v >= 45 ? "var(--muted)" : "var(--down)";
  return `<div class="ring" title="종합 ${score ?? "-"}점 · ${esc(grade)}">
    <svg viewBox="0 0 54 54"><circle cx="27" cy="27" r="${r}" fill="none" stroke="var(--border)" stroke-width="5"/>
    <circle cx="27" cy="27" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(c * v) / 100} ${c}"/></svg>
    <div class="ring-val"><div>${score ?? "-"}<small>${esc(grade)}</small></div></div>
  </div>`;
}

function miniBar(label, part) {
  const ratio = part.max ? part.score / part.max : 0;
  return `<div>
    <div class="mini-label"><span>${label}</span><b>${part.max ? `${part.score}/${part.max}` : "-"}</b></div>
    <div class="mini-track"><div class="mini-fill" style="width:${(ratio * 100).toFixed(0)}%"></div></div>
  </div>`;
}

// ---------- 시장 지표 ----------

function renderMarket(items) {
  $("#market").innerHTML = items
    .map((m) => {
      if (!m.ok) {
        return `<button class="mkt" data-market="${esc(m.id)}"><div class="mkt-name">${esc(m.name)}</div><div class="mkt-price flat">-</div><div class="mkt-chg flat">불러오지 못함</div></button>`;
      }
      const d = dir(m.changePct);
      return `<button class="mkt" data-market="${esc(m.id)}" title="${esc(m.name)} 상세 차트 보기">
        <div class="mkt-name">${esc(m.name)}</div>
        <div class="mkt-price num">${num(m.price)}${m.unit ? `<small> ${m.unit}</small>` : ""}</div>
        <div class="mkt-chg num ${d}">${arrow(m.changePct)} ${num(Math.abs(m.change ?? 0))} (${pct(m.changePct)})</div>
        ${sparkline(m.points, { base: m.prevClose })}
      </button>`;
    })
    .join("");
}

// ---------- 기준 시각 · 다음 업데이트 예정 ----------
// 한국 탭: GitHub Actions에 평일 19:07·19:12·19:19(한국 시각) 세 번 예약. 실제로는 GitHub 사정으로 50분~1시간 늦게 돌아 19:10~20:30쯤 반영
// 미국 탭: 미국장 마감(뉴욕 16:00) 뒤 새로 열면 바로 반영. 휴장일은 따로 빼지 않아서 휴장일이면 하루 밀려요.

const KST_MS = 9 * 3600_000;
const DAY_MS = 86400_000;
const WEEKDAY = "일월화수목금토";
const kstParts = (ms) => {
  const d = new Date(ms + KST_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), w: d.getUTCDay(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
};
// 한국 시각으로 "11/2(월) 19:00"
function kstLabel(ms, withTime = true) {
  const p = kstParts(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${p.m + 1}/${p.d}(${WEEKDAY[p.w]})${withTime ? ` ${pad(p.hh)}:${pad(p.mm)}` : ""}`;
}
// "YYYYMMDD" 또는 "YYYY-MM-DD" → 그날 0시를 UTC로 쓴 값 (요일 계산용)
const dayUtc = (ymd) => {
  const s = String(ymd).replace(/-/g, "");
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
};
const isWeekend = (utcDay) => [0, 6].includes(new Date(utcDay).getUTCDay());
const ymdOf = (utcDay) => new Date(utcDay).toISOString().slice(0, 10).replace(/-/g, "");

// 다음 한국 자동 계산 시각: 기준일 다음 평일 중 19:10(+90분 여유)이 아직 안 지난 첫날
function nextKrUpdate(basisYmd, now = Date.now()) {
  const p = kstParts(now);
  let day = Date.UTC(p.y, p.m, p.d);
  for (let i = 0; i < 14; i++, day += DAY_MS) {
    if (isWeekend(day) || ymdOf(day) <= basisYmd) continue;
    const run = day + (19 * 60 + 10) * 60_000 - KST_MS;
    if (run + 90 * 60_000 > now) return run;
  }
  return null;
}

// 그날 뉴욕 16:00(미국장 마감)의 실제 시각 (서머타임 자동 반영)
function nyCloseMs(utcDay) {
  const hourInNy = (t) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(t));
  for (const offset of [4, 5]) {
    const t = utcDay + (16 + offset) * 3600_000;
    if (hourInNy(t) === 16) return t;
  }
  return utcDay + 21 * 3600_000;
}

// 다음 미국장 마감: 기준일 다음 평일 중 아직 마감 안 된 첫날
function nextUsUpdate(sessionDate, now = Date.now()) {
  let day = dayUtc(sessionDate) + DAY_MS;
  for (let i = 0; i < 14; i++, day += DAY_MS) {
    if (isWeekend(day)) continue;
    const close = nyCloseMs(day);
    if (close > now) return close;
  }
  return null;
}

function updateLineHtml(basis, next, note) {
  return `<span>기준 <b>${basis}</b></span><span>→</span><span class="next">다음 업데이트 예정 <b>${next}</b></span><span class="note">${note}</span>`;
}

function krUpdateLine(sel, basisYmd, generatedAt) {
  const el = $(sel);
  if (!el || !basisYmd) return;
  const basisDay = dayUtc(basisYmd);
  const next = nextKrUpdate(basisYmd);
  const made = generatedAt ? ` · 계산 ${kstLabel(new Date(generatedAt).getTime())}` : "";
  el.innerHTML = updateLineHtml(
    `${kstLabel(basisDay - KST_MS, false)} 장 마감${made}`,
    next ? `${kstLabel(next)}~${kstLabel(next + 80 * 60_000).slice(-5)}` : "-",
    "평일 저녁 7시 7분·12분·19분에 세 번 자동 계산을 예약해 두지만, GitHub 사정으로 1시간쯤 늦게 반영될 때가 많아요. 휴장일에는 새 결과가 없어요."
  );
}

// 다음 한국장 시작 (평일 09:00, 휴장일은 따로 빼지 않음)
function nextKrOpen(now = Date.now()) {
  const p = kstParts(now);
  let day = Date.UTC(p.y, p.m, p.d);
  for (let i = 0; i < 14; i++, day += DAY_MS) {
    if (isWeekend(day)) continue;
    const open = day + 9 * 3600_000 - KST_MS;
    if (open > now) return open;
  }
  return null;
}

// 한국 시장 장중 흐름: 장중에는 1분마다, 장이 끝나면 다음 장 시작부터
function liveUpdateLine(b) {
  const el = $("#upd-krlive");
  if (!el) return;
  const at = b.tradedAt ? new Date(b.tradedAt).getTime() : new Date(b.updatedAt).getTime();
  const status = LIVE_STATUS[b.status] || "";
  if (b.status === "OPEN") {
    el.innerHTML = updateLineHtml(
      `${kstLabel(at)} 장중 시세`,
      `${kstLabel(new Date(b.updatedAt).getTime() + 60_000).slice(-5)}쯤 (1분마다)`,
      "장중에는 이 탭을 보고 있는 동안 1분마다 자동으로 새로 받아요."
    );
    return;
  }
  const open = nextKrOpen();
  el.innerHTML = updateLineHtml(
    `${kstLabel(at)}${status ? ` ${status}` : ""}`,
    open ? `${kstLabel(open)} 장 시작` : "-",
    "장이 열리면 1분마다 자동으로 새로 받아요. 휴장일이면 다음 거래일로 밀려요."
  );
}

// 공모주 청약: 서버가 네이버 공모주 정보를 30분마다 새로 받아요
function ipoUpdateLine(updatedAt) {
  const el = $("#upd-ipo");
  if (!el || !updatedAt) return;
  const at = new Date(updatedAt).getTime();
  el.innerHTML = updateLineHtml(
    `${kstLabel(at)} 네이버 공모주 정보`,
    `${kstLabel(at + 30 * 60_000)}쯤`,
    "30분마다 새로 받아요. 그 뒤에 이 탭을 다시 열거나 새로고침하면 반영돼요."
  );
}

function usUpdateLine(sel, sessionDate) {
  const el = $(sel);
  if (!el || !sessionDate) return;
  const day = dayUtc(sessionDate);
  const next = nextUsUpdate(sessionDate);
  el.innerHTML = updateLineHtml(
    `${kstLabel(day - KST_MS, false)} 미국장 마감 (한국 시각 ${kstLabel(nyCloseMs(day))})`,
    next ? `${kstLabel(next)}쯤` : "-",
    "미국장이 끝난 뒤 이 탭을 다시 열거나 새로고침하면 바로 반영돼요. 미국 휴장일이면 하루 밀려요."
  );
}

// ---------- 테마 ----------

function renderThemes(themes, topThemes, sessionDate) {
  $("#top-count").textContent = topThemes.length ? `상승한 테마 ${topThemes.length}개` : "상승한 테마";
  if (sessionDate) {
    const d = new Date(`${sessionDate}T12:00:00`);
    const week = "일월화수목금토"[d.getDay()];
    $("#session-date").textContent = `${d.getMonth() + 1}/${d.getDate()}(${week})`;
    usUpdateLine("#upd-themes", sessionDate);
  }
  const maxAbs = Math.max(1, ...themes.map((t) => Math.abs(t.avgChange ?? 0)));
  $("#themes").innerHTML = themes
    .map((t, i) => {
      const isTop = topThemes.includes(t.name);
      const v = t.avgChange;
      const w = v == null ? 0 : (Math.abs(v) / maxAbs) * 50;
      const fill =
        v == null ? "" : `<div class="bar-fill" style="${v >= 0 ? "left:50%" : `left:${50 - w}%`};width:${w}%;background:var(--${dir(v)})"></div>`;
      const tickers = t.us
        .map((q) => `<span><b>${esc(q.symbol)}</b> <span class="num ${dir(q.changePct)}">${pct(q.changePct, 1)}</span></span>`)
        .concat(t.missing.map((s) => `<span title="데이터 없음">${esc(s)} -</span>`))
        .join("");
      return `<div class="theme-row ${isTop ? "top" : ""}">
        <div class="theme-rank">${i + 1}</div>
        <div class="theme-name">${esc(t.name)}<small>${isTop ? "점수화 대상" : `한국 ${t.krCount}종목`}</small></div>
        <div class="theme-bar"><div class="bar-track">${fill}</div><div class="tickers">${tickers}</div></div>
        <div class="theme-val num ${dir(v)}" title="평균 등락 (변동폭 ${pct(t.volatility, 2).replace("+", "")})">${pct(v)}</div>
      </div>`;
    })
    .join("");
}

// ---------- 종목 카드 ----------

function renderFilter() {
  const names = ["전체", ...state.topThemes];
  if (!names.includes(state.filter)) state.filter = "전체";
  $("#theme-filter").innerHTML = names
    .map((n) => `<button class="chip" role="tab" aria-selected="${n === state.filter}" data-theme="${esc(n)}">${esc(n)}</button>`)
    .join("");
}

// 종목 카드 (테마 탭·상위 30 탭 공통)
function cardHtml(p, { tag = null, rank = null, extra = "", streak = null } = {}) {
  const d = dir(p.changePct);
  const change = p.change != null ? `${won(Math.abs(p.change))} ` : "";
  const streakBadge = streak
    ? ` <span class="streak${streak >= 3 ? " hot" : ""}" title="거래일 기준 ${streak}일 연속 상위 진입">연속 ${streak}일</span>`
    : "";
  return `<button class="card" data-code="${esc(p.code)}">
    <div class="card-top">
      <div>
        <div class="card-name">${rank ? `<span class="rank">${rank}</span>` : ""}${esc(p.name)}${streakBadge}</div>
        <div class="card-meta">${esc(p.code)} · ${esc(p.market)}${tag ? ` · <span class="tag">${esc(tag)}</span>` : ""}${extra}</div>
      </div>
      ${ring(p.score.total, p.score.grade)}
    </div>
    <div class="card-price">
      <span class="num">${won(p.price)}원</span>
      <span class="num chg ${d}">${arrow(p.changePct)} ${change}(${pct(p.changePct)})</span>
    </div>
    <svg class="card-spark" viewBox="0 0 120 36" preserveAspectRatio="none">${sparkline(p.spark, { height: 36 }).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg>
    <div class="split">${miniBar("기술", p.score.technical)}${miniBar("수급", p.score.supply)}${miniBar("기본", p.score.basic)}</div>
  </button>`;
}

function renderPicks(failed = []) {
  const list = state.picks.filter((p) => state.filter === "전체" || p.theme === state.filter);
  if (!list.length) {
    const msg = state.topThemes.length ? "표시할 종목이 없어요." : "전일 미국장에서 오른 테마가 없어서 점수화할 종목이 없어요.";
    $("#picks").innerHTML = `<div class="state">${msg}<br><small>위쪽 검색창에 종목명이나 종목코드를 넣으면 아무 종목이나 분석할 수 있어요.</small></div>`;
    return;
  }
  const cards = list.map((p) => cardHtml(p, { tag: p.theme })).join("");
  const note = failed.length
    ? `<div class="notice state" style="padding:10px">불러오지 못한 종목: ${failed.map((f) => esc(f.name)).join(", ")}</div>`
    : "";
  $("#picks").innerHTML = cards + note;
}

function renderSkeleton() {
  $("#market").innerHTML = Array.from({ length: 5 }, () => `<div class="mkt skeleton" style="height:104px"></div>`).join("");
  $("#themes").innerHTML = Array.from({ length: 5 }, () => `<div class="skeleton" style="height:44px"></div>`).join("");
  $("#picks").innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton" style="height:190px"></div>`).join("");
}

function renderError(target, message) {
  $(target).innerHTML = `<div class="state">데이터를 불러오지 못했어요.<br><small>${esc(message)}</small><br><button data-retry>다시 시도</button></div>`;
}

// ---------- 불러오기 ----------

async function load({ quiet = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  $("#refresh-btn").classList.add("spinning");
  if (!quiet) renderSkeleton();

  const [market, picks] = await Promise.allSettled([getJson("/api/market"), getJson("/api/picks")]);

  if (market.status === "fulfilled") renderMarket(market.value.items);
  else if (!quiet) renderError("#market", market.reason.message);

  if (picks.status === "fulfilled") {
    const data = picks.value;
    state.picks = data.picks;
    state.themes = data.themes;
    state.topThemes = data.topThemes;
    renderThemes(data.themes, data.topThemes, data.sessionDate);
    renderFilter();
    renderPicks(data.failed);
    $("#updated").textContent = `${timeLabel(new Date(data.updatedAt))} 기준`;
  } else if (!quiet) {
    renderError("#themes", picks.reason.message);
    $("#picks").innerHTML = "";
    $("#updated").textContent = "불러오기 실패";
  }

  state.loading = false;
  $("#refresh-btn").classList.remove("spinning");
}

// ---------- 한국주식 상위 30 탭 ----------

let top30Loaded = 0;

async function loadTop30() {
  // 10분 안에 다시 열면 이전 결과 사용
  if (Date.now() - top30Loaded < 600_000) return;
  $("#top30").innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton" style="height:190px"></div>`).join("");
  try {
    const data = await getJson("/api/top30");
    top30Loaded = Date.now();
    const d = data.basisDate;
    krUpdateLine("#upd-top30", d, data.generatedAt);
    const date = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T12:00:00`);
    const week = "일월화수목금토"[date.getDay()];
    $("#top30-sub").textContent =
      `${date.getMonth() + 1}/${date.getDate()}(${week}) 장 마감 기준 · 코스피·코스닥 일반 주식 ${data.counts.universe.toLocaleString()}개 중 ` +
      `거래대금 조건을 통과한 ${data.counts.scored.toLocaleString()}개를 점수화 · 계산 ${timeLabel(new Date(data.generatedAt))}`;
    $("#top30").innerHTML = data.items
      .map((p) => cardHtml(p, { rank: p.rank, streak: p.streak, extra: ` · 거래대금 ${p.avgValue.toLocaleString()}억/일` }))
      .join("");
    const ex = Object.entries(data.excluded)
      .map(([k, v]) => `${k} ${v.toLocaleString()}개`)
      .join(", ");
    const note = $("#top30-note");
    note.hidden = false;
    const streakNote = data.historyDays
      ? `"연속 N일"은 거래일 기준으로 상위 30에 연속해서 든 날 수예요 (기록 ${data.historyDays}일치). `
      : "";
    note.textContent = `${streakNote}제외: ${ex}. 매일 저녁 7시쯤(평일) 새로 계산해요. 카드를 누르면 지금 시세로 상세 분석을 볼 수 있어요.`;
  } catch (e) {
    renderError("#top30", e.message);
  }
}

// ---------- 미국 시장 브리핑 탭 ----------

let briefingLoaded = 0;

function quoteTile(q) {
  if (!q.ok) return `<div class="quote"><div class="quote-name">${esc(q.name)}</div><div class="quote-price flat">-</div><div class="quote-chg flat">불러오지 못함</div></div>`;
  const value =
    q.kind === "yield"
      ? `${q.price.toFixed(2)}%`
      : `${num(q.price)}${q.unit ? `<small> ${esc(q.unit)}</small>` : ""}`;
  const change =
    q.kind === "yield"
      ? `${arrow(q.price - q.prevClose)} ${Math.abs(Math.round((q.price - q.prevClose) * 100))}bp`
      : `${arrow(q.changePct)} ${pct(q.changePct)}`;
  const d = q.kind === "yield" ? dir(q.price - q.prevClose) : dir(q.changePct);
  return `<div class="quote"><div class="quote-name">${esc(q.name)} <span class="sub">${esc(q.symbol)}</span></div>
    <div class="quote-price">${value}</div><div class="quote-chg ${d}">${change}</div></div>`;
}

async function loadBriefing() {
  if (Date.now() - briefingLoaded < 600_000) return;
  $("#briefing-summary").innerHTML = Array.from({ length: 5 }, () => `<li class="skeleton" style="height:42px"></li>`).join("");
  try {
    const b = await getJson("/api/briefing");
    briefingLoaded = Date.now();
    if (b.sessionDate) {
      const d = new Date(`${b.sessionDate}T12:00:00`);
      $("#briefing-title").textContent = `${d.getMonth() + 1}/${d.getDate()}(${"일월화수목금토"[d.getDay()]}) 미국 시장 브리핑`;
      usUpdateLine("#upd-briefing", b.sessionDate);
    }
    $("#briefing-summary").innerHTML = b.summary.map((l) => `<li>${esc(l)}</li>`).join("");
    $("#briefing-indices").innerHTML = b.indices.map(quoteTile).join("");
    $("#briefing-macro").innerHTML = b.macro.map(quoteTile).join("");
    $("#briefing-megacaps").innerHTML = [...b.megacaps].sort((a, c) => (c.changePct ?? -99) - (a.changePct ?? -99)).map(quoteTile).join("");

    // 업종: 테마 흐름과 같은 막대 모양
    const sectors = b.sectors.filter((s) => s.ok).sort((a, c) => c.changePct - a.changePct);
    const maxAbs = Math.max(1, ...sectors.map((s) => Math.abs(s.changePct)));
    $("#briefing-sectors").innerHTML = sectors
      .map((s, i) => {
        const w = (Math.abs(s.changePct) / maxAbs) * 50;
        const pos = s.changePct >= 0 ? "left:50%" : `left:${50 - w}%`;
        return `<div class="theme-row">
          <div class="theme-rank">${i + 1}</div>
          <div class="theme-name">${esc(s.name)}<small>${esc(s.symbol)}</small></div>
          <div class="theme-bar"><div class="bar-track"><div class="bar-fill" style="${pos};width:${w}%;background:var(--${dir(s.changePct)})"></div></div></div>
          <div class="theme-val num ${dir(s.changePct)}">${pct(s.changePct)}</div>
        </div>`;
      })
      .join("");

    $("#briefing-news").innerHTML = b.news.length
      ? `<ul class="news">${b.news
          .map(
            (n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">
              <span class="news-title">${esc(n.title)}</span>
              <span class="news-meta">${esc(n.about)} · ${esc(n.press)} · ${newsTime(n.time)}</span></a></li>`
          )
          .join("")}</ul>`
      : `<p class="sub">관련 뉴스가 없어요.</p>`;
  } catch (e) {
    $("#briefing-summary").innerHTML = `<li>브리핑을 불러오지 못했어요. (${esc(e.message)}) <button data-briefing-retry>다시 시도</button></li>`;
  }
}

// ---------- 한국 시장 브리핑 탭 ----------

let krLoaded = 0;
let krData = null;

// 순위 목록. attrs가 속성을 돌려주면 누를 수 있는 버튼으로 (기본: 종목코드 → 상세 분석)
function rankList(title, items, value, attrs = (s) => (s.code ? `data-code="${esc(s.code)}"` : "")) {
  if (!items?.length) return `<div><p class="col-title">${title}</p><p class="sub">데이터 없음</p></div>`;
  return `<div>${title ? `<p class="col-title">${title}</p>` : ""}<ol class="rank-list">${items
    .map((s, i) => {
      const a = attrs(s, i);
      return `<li>${a ? `<button ${a}>` : "<div>"}
        <span class="rn">${i + 1}</span><span class="nm">${esc(s.name)}</span>${value(s)}
      ${a ? "</button>" : "</div>"}</li>`;
    })
    .join("")}</ol></div>`;
}

// 종합 점수 색 상자
function scoreBadge(s) {
  const t = s.score?.total;
  if (t == null) return `<span class="sc na" title="${esc(s.score?.grade || "점수 없음")}">-</span>`;
  const level = t >= 75 ? "hi" : t >= 60 ? "good" : t >= 45 ? "mid" : "low";
  return `<span class="sc ${level}" title="종합 ${t}점 · ${esc(s.score.grade)}">${t}</span>`;
}

const capLabel = (eok) => (eok == null ? "-" : eok >= 10000 ? `${(eok / 10000).toFixed(1)}조` : `${Math.round(eok).toLocaleString("ko-KR")}억`);

// 업종을 누르면 대표 종목 창
function openIndustry(key) {
  const [side, idx] = key.split("-");
  const g = krData?.industries?.[side]?.[Number(idx)];
  if (!g) return;
  const d = krData.basisDate;
  $("#detail-body").innerHTML = `
    <div class="detail-head">
      <div>
        <h3 id="detail-title">${esc(g.name)} <span class="num ${dir(g.changePct)}" style="font-size:18px">${pct(g.changePct)}</span></h3>
        <div class="card-meta">${d.slice(4, 6)}/${d.slice(6, 8)} 장 마감 기준 · 업종 ${g.count}종목 중 상승 ${g.up} · 하락 ${g.down}</div>
      </div>
      <button class="close-btn" data-close aria-label="닫기">×</button>
    </div>
    <div class="section-title"><span>대표 종목 (시가총액 순)</span><span class="sub">색 상자는 종합 점수 · 종목을 누르면 상세 분석</span></div>
    ${
      g.members?.length
        ? rankList(
            "",
            g.members,
            (s) => `<span class="vl" style="color:var(--muted)">${capLabel(s.marketValue)}</span>${scoreBadge(s)}<span class="vl ${dir(s.changePct)}">${pct(s.changePct)}</span>`
          )
        : `<p class="sub">대표 종목 데이터가 없어요.</p>`
    }
    <p class="sub" style="margin-top:10px">업종 등락률은 네이버가 계산한 업종 평균이라, 그날 상장한 종목처럼 목록에 없는 종목이 크게 움직이면 대표 종목 흐름과 다를 수 있어요.</p>`;
  if (!$("#detail").open) $("#detail").showModal();
}

async function loadKrBriefing() {
  if (Date.now() - krLoaded < 600_000) return;
  $("#kr-summary").innerHTML = Array.from({ length: 5 }, () => `<li class="skeleton" style="height:42px"></li>`).join("");
  try {
    const b = await getJson("/api/kr-briefing");
    krLoaded = Date.now();
    krData = b;
    const d = b.basisDate;
    const date = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T12:00:00`);
    $("#kr-title").textContent = `${date.getMonth() + 1}/${date.getDate()}(${"일월화수목금토"[date.getDay()]}) 한국 시장 브리핑`;
    krUpdateLine("#upd-krbriefing", d, b.generatedAt);
    $("#kr-sub").textContent = `장 마감 기준 · 숫자로 자동 작성한 요약`;
    $("#kr-summary").innerHTML = b.summary.map((l) => `<li>${esc(l)}</li>`).join("");
    $("#kr-indices").innerHTML = b.indices.map(quoteTile).join("");

    // 투자자별 순매수 표
    const inv = b.investors;
    const cell = (v) => (v == null ? "<td>-</td>" : `<td class="num ${dir(v)}">${v > 0 ? "+" : ""}${v.toLocaleString("ko-KR")}억</td>`);
    $("#kr-investors").innerHTML =
      `<thead><tr><th>시장</th><th>외국인</th><th>기관</th><th>개인</th></tr></thead><tbody>` +
      [["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]]
        .map(([k, label]) => (inv[k] ? `<tr><td>${label}</td>${cell(inv[k].foreign)}${cell(inv[k].institution)}${cell(inv[k].individual)}</tr>` : `<tr><td>${label}</td><td colspan="3">데이터 없음</td></tr>`))
        .join("") +
      `</tbody>`;

    // 오른 종목·내린 종목 비율
    const br = b.breadth;
    const w = (n) => (br.total ? (n / br.total) * 100 : 0);
    $("#kr-breadth-sub").textContent = `보통주 ${br.total.toLocaleString()}개`;
    $("#kr-breadth").innerHTML = `<div class="breadth-bar">
        <span style="width:${w(br.up)}%;background:var(--up)"></span><span style="width:${w(br.flat)}%;background:var(--muted)"></span><span style="width:${w(br.down)}%;background:var(--down)"></span>
      </div>
      <div class="breadth-legend">
        <span>상승 <b class="up">${br.up.toLocaleString()}</b> (${w(br.up).toFixed(0)}%)</span>
        <span>보합 <b>${br.flat.toLocaleString()}</b></span>
        <span>하락 <b class="down">${br.down.toLocaleString()}</b> (${w(br.down).toFixed(0)}%)</span>
        <span>상한가 <b class="up">${br.upperLimit}</b></span>
        <span>하한가 <b class="down">${br.lowerLimit}</b></span>
      </div>`;

    // 업종
    const pctVal = (s) => `<span class="vl ${dir(s.changePct)}">${pct(s.changePct)}</span>`;
    if (b.industries) {
      $("#kr-ind-sub").textContent = `네이버 업종 분류 ${b.industries.count}개 중 · 업종을 누르면 대표 종목`;
      $("#kr-industries").innerHTML =
        rankList("많이 오른 업종", b.industries.top, pctVal, (g, i) => `data-industry="top-${i}"`) +
        rankList("많이 내린 업종", b.industries.bottom, pctVal, (g, i) => `data-industry="bottom-${i}"`);
    } else {
      $("#kr-industries").innerHTML = `<p class="sub">이번 계산은 장중에 실행돼서 업종 데이터를 넣지 않았어요.</p>`;
    }

    // 많이 움직인 종목 (종합 점수 함께)
    const scoreVal = scoreBadge;
    $("#kr-movers").innerHTML =
      rankList("상승률 상위", b.movers.gainers, (s) => scoreVal(s) + pctVal(s)) +
      rankList("하락률 상위", b.movers.losers, (s) => scoreVal(s) + pctVal(s)) +
      rankList("거래대금 상위", b.movers.value, (s) => `<span class="vl">${s.value.toLocaleString("ko-KR")}억</span>${scoreVal(s)}${pctVal(s)}`);

    $("#kr-news").innerHTML = b.news?.length
      ? `<ul class="news">${b.news
          .map(
            (n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">
              <span class="news-title">${esc(n.title)}</span>
              <span class="news-meta">${esc(n.press)} · ${newsTime(n.time)}</span></a></li>`
          )
          .join("")}</ul>`
      : `<p class="sub">뉴스를 불러오지 못했어요.</p>`;
  } catch (e) {
    $("#kr-summary").innerHTML = `<li>브리핑을 불러오지 못했어요. (${esc(e.message)}) <button data-kr-retry>다시 시도</button></li>`;
  }
}

// ---------- 한국 시장 장중 흐름 탭 ----------

let liveData = null;
let liveLoading = false;
const liveScores = { at: 0, byCode: new Map() };
const LIVE_CHART_ID = { KOSPI: "kospi", KOSDAQ: "kosdaq", KPI200: "kpi200" }; // 누르면 여는 상세 차트 (/api/chart id)
const LIVE_STATUS = { OPEN: "장중", CLOSE: "장 마감", PREOPEN: "장 시작 전" };

// 오늘 지수 1분봉 선 그래프. 가로축은 09:00~15:30 고정이라 장이 얼마나 지났는지도 보임
function intradayChart(points, prevClose) {
  const W = 320, H = 120, top = 8, bottom = 18;
  if (!points?.length) return `<div class="state" style="padding:30px 0">오늘 분봉이 아직 없어요.</div>`;
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(2, 4));
  const start = 9 * 60, end = 15 * 60 + 30;
  const prices = points.map((p) => p[1]);
  let lo = Math.min(...prices, prevClose ?? Infinity);
  let hi = Math.max(...prices, prevClose ?? -Infinity);
  const pad = (hi - lo) * 0.08 || hi * 0.002;
  lo -= pad;
  hi += pad;
  const x = (t) => (Math.min(Math.max(toMin(t) - start, 0), end - start) / (end - start)) * W;
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const last = points.at(-1);
  const color = prevClose == null || last[1] === prevClose ? "var(--muted)" : last[1] > prevClose ? "var(--up)" : "var(--down)";
  const base = prevClose == null ? "" : `<line x1="0" x2="${W}" y1="${y(prevClose)}" y2="${y(prevClose)}" stroke="var(--muted)" stroke-dasharray="3 3" stroke-width="1"/>`;
  const area = `${line}L${x(last[0]).toFixed(1)},${H - bottom}L${x(points[0][0]).toFixed(1)},${H - bottom}Z`;
  const ticks = [["0900", "9시"], ["1100", "11시"], ["1300", "13시"], ["1530", "15:30"]]
    .map(([t, l], i, a) => `<text x="${x(t)}" y="${H - 4}" text-anchor="${i === 0 ? "start" : i === a.length - 1 ? "end" : "middle"}">${l}</text>`)
    .join("");
  return `<svg class="intraday" viewBox="0 0 ${W} ${H}" role="img" aria-label="오늘 지수 흐름">
    <path d="${area}" fill="${color}" opacity="0.08"/>${base}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6"/>
    <circle cx="${x(last[0])}" cy="${y(last[1])}" r="2.8" fill="${color}"/>
    <g class="ticks">${ticks}</g>
  </svg>`;
}

function liveIndexCard(x) {
  if (!x.ok) return `<div class="quote"><div class="quote-name">${esc(x.name)}</div><div class="quote-price flat">-</div><div class="quote-chg flat">불러오지 못함</div></div>`;
  const prices = x.points.map((p) => p[1]);
  const hi = prices.length ? Math.max(...prices) : null;
  const lo = prices.length ? Math.min(...prices) : null;
  const id = LIVE_CHART_ID[x.symbol];
  return `<button class="quote live-index" type="button" data-live-chart="${id}" title="누르면 ${esc(x.name)} 상세 차트">
    <div class="quote-name">${esc(x.name)}</div>
    <div class="quote-price ${dir(x.changePct)}">${num(x.price)}</div>
    <div class="quote-chg ${dir(x.changePct)}">${arrow(x.changePct)} ${num(Math.abs(x.change ?? 0))} (${pct(x.changePct)})</div>
    ${intradayChart(x.points, x.prevClose)}
    <div class="live-range"><span>전일 ${num(x.prevClose)}</span><span>오늘 고가 ${num(hi)} · 저가 ${num(lo)}</span></div>
  </button>`;
}

// 점수 상자: 아직 계산 전이면 자리만 잡아 두고 나중에 채움
function liveScore(s) {
  const sc = liveScores.byCode.get(s.code);
  return sc ? scoreBadge({ score: sc }) : `<span class="sc na" data-score-code="${esc(s.code)}">…</span>`;
}

async function fillLiveScores(codes) {
  // 점수는 장중에도 천천히 바뀌어서 10분에 한 번만 다시 계산
  const stale = Date.now() - liveScores.at > 600_000;
  const need = [...new Set(codes)].filter((c) => stale || !liveScores.byCode.has(c)).slice(0, 40);
  if (need.length) {
    try {
      const data = await getJson(`/api/watch?codes=${need.join(",")}`);
      if (stale) liveScores.at = Date.now();
      for (const p of data.items) liveScores.byCode.set(p.code, p.score);
    } catch {
      // 점수를 못 받아도 순위는 그대로 보여줌
    }
  }
  for (const el of document.querySelectorAll("#view-krlive [data-score-code]")) {
    const sc = liveScores.byCode.get(el.dataset.scoreCode);
    el.outerHTML = sc ? scoreBadge({ score: sc }) : `<span class="sc na" title="점수 없음">-</span>`;
  }
}

async function loadKrLive({ quiet = false } = {}) {
  if (liveLoading) return;
  liveLoading = true;
  if (!quiet && !liveData) $("#live-indices").innerHTML = Array.from({ length: 3 }, () => `<div class="skeleton" style="height:230px"></div>`).join("");
  try {
    const b = await getJson("/api/kr-live");
    liveData = b;
    const status = LIVE_STATUS[b.status] || b.status || "";
    $("#live-sub").textContent = `네이버 실시간 시세${b.status === "OPEN" ? " · 1분마다 자동 갱신" : ""}`;
    liveUpdateLine(b);
    const badge = $("#live-badge");
    badge.hidden = !status;
    badge.textContent = status;
    badge.className = `live-badge${b.status === "OPEN" ? " on" : ""}`;

    renderStory(b.story);
    $("#live-indices").innerHTML = b.indices.map(liveIndexCard).join("");

    const cell = (v) => (v == null ? "<td>-</td>" : `<td class="num ${dir(v)}">${v > 0 ? "+" : ""}${v.toLocaleString("ko-KR")}</td>`);
    $("#live-investors").innerHTML =
      `<thead><tr><th>시장</th><th>외국인</th><th>기관</th><th>개인</th></tr></thead><tbody>` +
      [["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]]
        .map(([k, label]) => {
          const v = b.investors[k];
          return v ? `<tr><td>${label}</td>${cell(v.foreign)}${cell(v.institution)}${cell(v.individual)}</tr>` : `<tr><td>${label}</td><td colspan="3">데이터 없음</td></tr>`;
        })
        .join("") +
      `</tbody>`;

    $("#live-breadth").innerHTML = [["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]]
      .map(([k, label]) => {
        const br = b.breadth[k];
        const total = br.up + br.down;
        const w = (n) => (total ? (n / total) * 100 : 0);
        return `<div class="live-breadth">
          <div class="live-breadth-head"><b>${label}</b><span>상승 <b class="up">${br.up.toLocaleString()}</b> · 하락 <b class="down">${br.down.toLocaleString()}</b> · 상한가 <b class="up">${br.upper}</b> · 하한가 <b class="down">${br.lower}</b></span></div>
          <div class="breadth-bar"><span style="width:${w(br.up)}%;background:var(--up)"></span><span style="width:${w(br.down)}%;background:var(--down)"></span></div>
        </div>`;
      })
      .join("");

    const pctVal = (s) => `<span class="vl ${dir(s.changePct)}">${pct(s.changePct)}</span>`;
    const limitTag = (s) => (s.limit === "upper" ? `<span class="tbadge new">상한</span>` : s.limit === "lower" ? `<span class="tbadge turn">하한</span>` : "");
    $("#live-movers").innerHTML =
      rankList("상승률 상위", b.movers.gainers, (s) => limitTag(s) + liveScore(s) + pctVal(s)) +
      rankList("하락률 상위", b.movers.losers, (s) => limitTag(s) + liveScore(s) + pctVal(s)) +
      rankList("거래대금 상위", b.movers.value, (s) => `<span class="vl">${s.value.toLocaleString("ko-KR")}억</span>${liveScore(s)}${pctVal(s)}`);
    const limitList = (title, items) =>
      items.length
        ? rankList(`${title} ${items.length}종목`, items, (s) => `<span class="vl">${s.value.toLocaleString("ko-KR")}억</span>${liveScore(s)}${pctVal(s)}`)
        : `<div><p class="col-title">${title}</p><p class="sub">지금은 없어요.</p></div>`;
    $("#live-limits").innerHTML = limitList("상한가", b.limits.upper) + limitList("하한가", b.limits.lower);

    const groupAttrs = (kind) => (g) => `data-live-group="${kind}" data-no="${esc(g.no)}" data-name="${esc(g.name)}" data-pct="${g.changePct}" data-count="${g.count}" data-up="${g.up}" data-down="${g.down}"`;
    const groupVal = (g) => `<span class="cnt">${g.up}↑ ${g.down}↓</span>${pctVal(g)}`;
    $("#live-industries").innerHTML = b.industries
      ? rankList("많이 오른 업종", b.industries.top, groupVal, groupAttrs("industry")) + rankList("많이 내린 업종", b.industries.bottom, groupVal, groupAttrs("industry"))
      : `<p class="sub">업종 데이터를 불러오지 못했어요.</p>`;
    $("#live-themes").innerHTML = b.themes
      ? rankList("많이 오른 테마", b.themes.top, groupVal, groupAttrs("theme")) + rankList("많이 내린 테마", b.themes.bottom, groupVal, groupAttrs("theme"))
      : `<p class="sub">테마 데이터를 불러오지 못했어요.</p>`;
    $("#live-group-sub").textContent = `지금 시세 기준 네이버 평균 등락률 · 업종 ${b.industries?.count ?? 0}개 · 테마 ${b.themes?.count ?? 0}개 · 누르면 대표 종목`;

    const codes = [...b.movers.gainers, ...b.movers.losers, ...b.movers.value, ...b.limits.upper, ...b.limits.lower].map((s) => s.code);
    fillLiveScores(codes);
  } catch (e) {
    if (!liveData) $("#live-indices").innerHTML = `<div class="state">장중 흐름을 불러오지 못했어요.<br><small>${esc(e.message)}</small><br><button data-live-retry>다시 시도</button></div>`;
  } finally {
    liveLoading = false;
  }
}

// 친구 말투 브리핑 (서버가 숫자로만 만든 문장)
// 문장 속 [[종류|번호|이름]]을 누를 수 있는 이름으로: s 종목 상세, i 업종·t 테마 대표 종목, x 지수 상세 차트
const STORY_LINK_TITLE = { s: "종목 상세", i: "업종 대표 종목", t: "테마 대표 종목", x: "상세 차트" };
// 상승은 빨강, 하락은 파랑: 부호가 붙은 등락률(+1.35%, -5.37%)과 "올랐어/내렸어"
const storyColors = (html) =>
  html
    .replace(/([+-])(\d[\d,]*(?:\.\d+)?%)/g, (m, sign) => `<span class="${sign === "+" ? "up" : "down"}">${m}</span>`)
    .replace(/(올랐어|내렸어)/g, (m) => `<span class="${m === "올랐어" ? "up" : "down"}">${m}</span>`);
const storyLinks = (html) =>
  html.replace(/\[\[([sitx])\|([^|\]]+)\|([^\]]+)\]\]/g, (m, kind, id, name) => `<button type="button" class="story-link" data-story="${kind}" data-id="${id}" title="누르면 ${STORY_LINK_TITLE[kind]}">${name}</button>`);

function openStoryLink(el) {
  const { story: kind, id } = el.dataset;
  if (kind === "s") return openDetail(id);
  if (kind === "x") return openMarket(id);
  // 업종·테마는 장중 흐름 목록에 있는 정보(등락률·종목 수)로 대표 종목 창을 엶
  const list = kind === "i" ? liveData?.industries : liveData?.themes;
  const g = [...(list?.top ?? []), ...(list?.bottom ?? [])].find((x) => String(x.no) === id);
  if (!g) return;
  openLiveGroup({ dataset: { liveGroup: kind === "i" ? "industry" : "theme", no: String(g.no), name: g.name, pct: String(g.changePct), count: String(g.count), up: String(g.up), down: String(g.down) } });
}

function renderStory(story) {
  const box = $("#live-story");
  if (!story?.paragraphs?.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = `
    <p class="story-head">${esc(story.headline)}</p>
    ${story.paragraphs.map((p) => `<p class="story-p"><b>${esc(p.title)}</b>${storyColors(storyLinks(esc(p.text)))}</p>`).join("")}
    ${
      story.news?.length
        ? `<div class="story-p"><b>주요 뉴스</b>이런 소식도 있어.<ul class="story-news">${story.news
            .map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a> <span>${esc(n.press)} · ${newsTime(n.time)}</span></li>`)
            .join("")}</ul></div>`
        : ""
    }
    <p class="story-foot">실시간 숫자로 자동으로 쓴 브리핑이에요. 매수·매도 권유가 아니에요.</p>`;
}

// 업종·테마를 누르면 대표 종목의 지금 시세
async function openLiveGroup(el) {
  const { liveGroup: kind, no, name, pct: p, count, up, down } = el.dataset;
  const label = kind === "industry" ? "업종" : "테마";
  const head = `<div class="detail-head">
      <div>
        <h3 id="detail-title">${esc(name)} <span class="num ${dir(Number(p))}" style="font-size:18px">${pct(Number(p))}</span></h3>
        <div class="card-meta">지금 시세 기준 · ${label} ${count}종목 중 상승 ${up} · 하락 ${down}</div>
      </div>
      <button class="close-btn" data-close aria-label="닫기">×</button>
    </div>`;
  $("#detail-body").innerHTML = `${head}<div class="skeleton" style="height:300px;margin-top:16px"></div>`;
  if (!$("#detail").open) $("#detail").showModal();
  try {
    const g = await getJson(`/api/kr-live?group=${kind}&no=${encodeURIComponent(no)}`);
    if ($("#detail-title")?.textContent.indexOf(name) !== 0) return; // 그사이 다른 창을 열었으면 무시
    $("#detail-body").innerHTML = `${head}
      <div class="section-title"><span>대표 종목 (시가총액 순)</span><span class="sub">보통주 최대 15개 · 종목을 누르면 상세 분석</span></div>
      ${
        g.stocks.length
          ? rankList(
              "",
              g.stocks,
              (s) => `<span class="vl" style="color:var(--muted)">${capLabel(s.marketValue)}</span><span class="vl">${won(s.price)}</span><span class="vl ${dir(s.changePct)}">${pct(s.changePct)}</span>`
            )
          : `<p class="sub">대표 종목 데이터가 없어요.</p>`
      }
      <p class="sub" style="margin-top:10px">${label} 등락률은 네이버가 계산한 소속 종목 평균이에요.</p>`;
  } catch (e) {
    $("#detail-body").innerHTML = `${head}<div class="state">불러오지 못했어요.<br><small>${esc(e.message)}</small></div>`;
  }
}

$("#view-krlive").addEventListener("click", (e) => {
  const storyLink = e.target.closest("[data-story]");
  if (storyLink) return openStoryLink(storyLink);
  const chartCard = e.target.closest("[data-live-chart]");
  if (chartCard) return openMarket(chartCard.dataset.liveChart);
  const g = e.target.closest("[data-live-group]");
  if (g) return openLiveGroup(g);
  if (e.target.closest("[data-live-retry]")) return loadKrLive();
});

// 장중이고 이 탭을 보고 있을 때만 1분마다 갱신
setInterval(() => {
  if (document.visibilityState === "visible" && !$("#view-krlive").hidden && !$("#detail").open && liveData?.status === "OPEN") loadKrLive({ quiet: true });
}, 60_000);

// ---------- 상한가·하한가 탭 ----------

let limitsLoaded = 0;

async function loadLimits() {
  if (Date.now() - limitsLoaded < 600_000) return;
  $("#limits").innerHTML = `<div class="skeleton" style="height:160px"></div><div class="skeleton" style="height:160px"></div>`;
  try {
    const b = await getJson("/api/kr-briefing");
    limitsLoaded = Date.now();
    const d = b.basisDate;
    const date = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T12:00:00`);
    $("#limits-title").textContent = `${date.getMonth() + 1}/${date.getDate()}(${"일월화수목금토"[date.getDay()]}) 상한가·하한가`;
    krUpdateLine("#upd-limits", d, b.generatedAt);
    // 많이 움직인 종목과 같은 모양: 순위 · 종목명 · 거래대금 · 종합 점수 · 등락률
    const val = (s) => `<span class="vl" style="color:var(--muted)">${s.value.toLocaleString("ko-KR")}억</span>${scoreBadge(s)}<span class="vl ${dir(s.changePct)}">${pct(s.changePct)}</span>`;
    const empty = (label) => `<div><p class="col-title">${label}</p><p class="sub">${label} 마감 종목이 없어요.</p></div>`;
    const up = b.limits?.upper || [];
    const down = b.limits?.lower || [];
    $("#limits").innerHTML =
      (up.length ? rankList(`상한가 ${up.length}종목`, up, val) : empty("상한가")) +
      (down.length ? rankList(`하한가 ${down.length}종목`, down, val) : empty("하한가"));
  } catch (e) {
    $("#limits").innerHTML = `<div class="state">불러오지 못했어요.<br><small>${esc(e.message)}</small><br><button data-limits-retry>다시 시도</button></div>`;
  }
}

// ---------- 한국 테마 브리핑 탭 ----------

let krThemesLoaded = 0;
let krThemes = null;

// 테마 배지: NEW(새로 생긴 테마) / 전환(오늘 방향이 바뀜) + 연속 상승·하락 일수 (3일 이상은 색을 채움)
function themeStreak(t) {
  let out = "";
  if (t.isNew) out += `<span class="tbadge new" title="네이버에 새로 생긴 테마 (처음 본 날 ${esc(fmtYmd(t.firstSeen))})">NEW</span>`;
  else if (t.turned) out += `<span class="tbadge turn" title="전날과 반대로 움직임 (${t.streak.dir === "up" ? "하락→상승" : "상승→하락"})">전환</span>`;
  const s = t.streak;
  if (s) {
    const word = s.dir === "up" ? "상승" : "하락";
    out += `<span class="streak ${s.dir}${s.days >= 3 ? " hot" : ""}" title="거래일 기준 ${s.days}일 연속 ${word}">연속 ${s.days}일</span>`;
  }
  return out;
}

const fmtYmd = (d) => (d ? `${d.slice(4, 6)}/${d.slice(6, 8)}` : "");

function renderKrThemes() {
  if (!krThemes) return;
  const q = $("#krthemes-search").value.trim().toLowerCase();
  const list = krThemes.themes.filter((t) => !q || t.name.toLowerCase().includes(q));
  const up = list.filter((t) => t.changePct > 0).sort((a, b) => b.changePct - a.changePct);
  const down = list.filter((t) => t.changePct <= 0).sort((a, b) => a.changePct - b.changePct);
  const val = (t) =>
    `${themeStreak(t)}<span class="cnt">상승 ${t.up} · 하락 ${t.down}</span><span class="vl ${dir(t.changePct)}">${pct(t.changePct)}</span>`;
  const attrs = (t) => `data-krtheme="${esc(t.no)}"`;
  const col = (title, items) =>
    items.length ? rankList(`${title} ${items.length}개`, items, val, attrs) : `<div><p class="col-title">${title}</p><p class="sub">${q ? "검색 결과가 없어요." : "없어요."}</p></div>`;
  $("#krthemes").innerHTML = col("오른 테마", up) + col("내린 테마", down);
}

async function loadKrThemes() {
  if (Date.now() - krThemesLoaded < 600_000) return;
  $("#krthemes").innerHTML = `<div class="skeleton" style="height:300px"></div><div class="skeleton" style="height:300px"></div>`;
  try {
    krThemes = await getJson("/api/kr-themes");
    krThemesLoaded = Date.now();
    const d = krThemes.basisDate;
    const date = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T12:00:00`);
    $("#krthemes-title").textContent = `${date.getMonth() + 1}/${date.getDate()}(${"일월화수목금토"[date.getDay()]}) 한국 테마 브리핑`;
    krUpdateLine("#upd-krthemes", d, krThemes.generatedAt);
    $("#krthemes-sub").textContent = `전일 종가 기준 · 네이버 테마 ${krThemes.count}개 · 테마를 누르면 관련 종목`;
    // 새로 생긴 테마가 있으면 위쪽에 따로 알림 (누르면 관련 종목)
    const nt = krThemes.newThemes || [];
    $("#krthemes-new").hidden = !nt.length;
    $("#krthemes-new").innerHTML = nt.length
      ? `<b>새로 생긴 테마 ${nt.length}개</b> ${nt
          .map((t) => `<button class="chip new-chip" data-krtheme="${esc(t.no)}">${esc(t.name)} <small>${fmtYmd(t.firstSeen)}</small></button>`)
          .join("")}`
      : "";
    renderKrThemes();
  } catch (e) {
    $("#krthemes").innerHTML = `<div class="state">불러오지 못했어요.<br><small>${esc(e.message)}</small><br><button data-krthemes-retry>다시 시도</button></div>`;
  }
}

// 테마를 누르면 관련 종목 창 (등락률 높은 순)
async function openKrTheme(no) {
  const dlg = $("#detail");
  const body = $("#detail-body");
  body.innerHTML = `<div class="detail-head"><div class="skeleton" style="width:220px;height:40px"></div><button class="close-btn" data-close aria-label="닫기">×</button></div>
    <div class="skeleton" style="height:300px;margin-top:16px"></div>`;
  if (!dlg.open) dlg.showModal();
  let t;
  try {
    ({ theme: t } = await getJson(`/api/kr-themes?no=${encodeURIComponent(no)}`));
  } catch (e) {
    body.innerHTML = `<div class="detail-head"><h3 id="detail-title">테마</h3><button class="close-btn" data-close aria-label="닫기">×</button></div><div class="state">불러오지 못했어요.<br><small>${esc(e.message)}</small></div>`;
    return;
  }
  if (!dlg.open) return;
  const d = krThemes?.basisDate ?? "";
  body.innerHTML = `
    <div class="detail-head">
      <div>
        <h3 id="detail-title">${esc(t.name)} <span class="num ${dir(t.changePct)}" style="font-size:18px">${pct(t.changePct)}</span>${themeStreak(t)}</h3>
        <div class="card-meta">${d ? `${d.slice(4, 6)}/${d.slice(6, 8)} 장 마감 기준 · ` : ""}관련 ${t.count}종목 중 상승 ${t.up} · 하락 ${t.down}</div>
      </div>
      <button class="close-btn" data-close aria-label="닫기">×</button>
    </div>
    <div class="section-title"><span>관련 종목 (많이 오른 순)</span><span class="sub">시가총액 · 종합 점수 · 등락률 · 종목을 누르면 상세 분석</span></div>
    ${
      t.members?.length
        ? rankList(
            "",
            t.members,
            (s) => `<span class="vl" style="color:var(--muted)">${capLabel(s.marketValue)}</span>${scoreBadge(s)}<span class="vl ${dir(s.changePct)}">${pct(s.changePct)}</span>`
          )
        : `<p class="sub">관련 종목 데이터가 없어요.</p>`
    }`;
}

$("#krthemes-search").addEventListener("input", renderKrThemes);

// ---------- 공모주 청약 탭 ----------

let ipoLoaded = 0;

// 한국 시간 오늘 YYYYMMDD
const todayKst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, "");
const ymdLabel = (d) => {
  if (!d) return "-";
  const t = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T12:00:00`);
  return `${t.getMonth() + 1}/${t.getDate()}(${"일월화수목금토"[t.getDay()]})`;
};
const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6, 8)}`) - Date.parse(`${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)}`)) / 86400000);

// 청약 점수 근거 한 줄 (항목별 점수, 마우스를 올리면 근거)
function ipoScoreLine(sc) {
  if (!sc) return "";
  if (sc.spac) return `<p class="ipo-score sub">스팩(기업인수목적회사)은 성격이 달라 점수를 내지 않아요.</p>`;
  const parts = sc.items
    .map((i) => `<span title="${esc(i.detail)}">${esc(i.label)} <b>${i.score == null ? "-" : i.score}</b>/${i.max}</span>`)
    .join("");
  const head = sc.total == null ? `<span class="ipo-wait">수요예측 후 점수 확정</span>` : "";
  return `<p class="ipo-score">${head}${parts}</p>`;
}

function ipoCard(x, today) {
  // 청약 중 / 청약 예정(D-n) / 청약 마감(상장 대기)
  let st;
  if (today >= x.subStart && today <= (x.subEnd || x.subStart)) st = { cls: "live", text: "청약 중" };
  else if (today < x.subStart) {
    const n = daysBetween(today, x.subStart);
    st = { cls: "soon", text: n === 1 ? "내일 청약" : `청약 D-${n}` };
  } else st = { cls: "done", text: x.listingDate && today < x.listingDate ? "상장 대기" : "청약 마감" };
  const won = (v) => (v == null ? null : `${v.toLocaleString("ko-KR")}원`);
  const price = x.price ? `${won(x.price)} <small class="sub">확정</small>` : x.priceLow ? `${won(x.priceLow)}~${won(x.priceHigh)} <small class="sub">희망</small>` : "-";
  const rows = [
    ["청약일", `${ymdLabel(x.subStart)}${x.subEnd && x.subEnd !== x.subStart ? ` ~ ${ymdLabel(x.subEnd)}` : ""}`],
    ["공모가", price],
    ["기관 경쟁률", x.institutionRate ? `${x.institutionRate.toLocaleString("ko-KR")} : 1` : "-"],
    ...(x.subscriptionRate ? [["청약 경쟁률", `${x.subscriptionRate.toLocaleString("ko-KR")} : 1`]] : []),
    ["상장 예정", x.listingDate ? ymdLabel(x.listingDate) : "미정"],
    ["주관사", esc(x.leadManager || "-") + (x.coManager ? ` 외` : "")],
  ];
  const links = [
    x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">네이버 공모주 정보</a>` : "",
    ...x.docs.slice(0, 2).map((d) => `<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc((d.title || "자료").replace(/^\[IPO\]\s*/, ""))}</a>`),
  ].filter(Boolean);
  return `<div class="ipo ${st.cls === "live" ? "live" : ""}">
    <div class="ipo-top">
      <div><div class="ipo-name">${esc(x.name)}</div><div class="card-meta">${esc([x.market, x.category, x.stage].filter(Boolean).join(" · "))}</div></div>
      <div class="ipo-right"><span class="ipo-st ${st.cls}">${st.text}</span>${x.score?.total != null ? ring(x.score.total, x.score.grade) : ""}</div>
    </div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    ${ipoScoreLine(x.score)}
    ${links.length ? `<div class="ipo-links">${links.join("")}</div>` : ""}
  </div>`;
}

async function loadIpo() {
  if (Date.now() - ipoLoaded < 600_000) return;
  $("#ipo-scheduled").innerHTML = Array.from({ length: 4 }, () => `<div class="skeleton" style="height:220px"></div>`).join("");
  try {
    const b = await getJson("/api/ipo");
    ipoLoaded = Date.now();
    const today = todayKst();
    // 청약이 끝나고 상장도 지난 기업은 빼고, 진행 중인 것부터
    const list = b.scheduled.filter((x) => !(x.listingDate && today > x.listingDate));
    const order = (x) => (today >= x.subStart && today <= (x.subEnd || x.subStart) ? 0 : today < x.subStart ? 1 : 2);
    list.sort((a, c) => order(a) - order(c) || (order(a) === 2 ? c.subStart.localeCompare(a.subStart) : a.subStart.localeCompare(c.subStart)));
    const live = list.filter((x) => order(x) === 0).length;
    $("#ipo-sub").textContent = `청약 중 ${live}개 · 예정 ${list.filter((x) => order(x) === 1).length}개 · 네이버 공모주 정보`;
    ipoUpdateLine(b.updatedAt);
    $("#ipo-scheduled").innerHTML = list.length ? list.map((x) => ipoCard(x, today)).join("") : `<p class="sub">예정된 청약이 없어요.</p>`;

    const pend = b.pending;
    const half = Math.ceil(pend.length / 2);
    const val = (x) => `<span class="cnt">${esc(x.market || "")}</span><span class="vl" style="color:var(--muted)">${esc(x.stage || "")}</span>`;
    const attrs = (x) => (x.url ? `data-ipo-url="${esc(x.url)}"` : "");
    $("#ipo-pending").innerHTML = pend.length
      ? rankList(`${pend.length}개 기업`, pend.slice(0, half), val, attrs) + rankList("&nbsp;", pend.slice(half), val, attrs).replace(/<span class="rn">(\d+)<\/span>/g, (m, n) => `<span class="rn">${Number(n) + half}</span>`)
      : `<p class="sub">없어요.</p>`;
  } catch (e) {
    $("#ipo-scheduled").innerHTML = `<div class="state">불러오지 못했어요.<br><small>${esc(e.message)}</small><br><button data-ipo-retry>다시 시도</button></div>`;
  }
}

const VIEWS = ["krlive", "themes", "top30", "briefing", "krbriefing", "krthemes", "limits", "ipo", "watch"];

function showView(view) {
  if (!VIEWS.includes(view)) view = "krlive";
  for (const v of VIEWS) {
    $(`#view-${v}`).hidden = v !== view;
    $(`#tab-${v}`).setAttribute("aria-selected", v === view);
  }
  $("#view-select").value = view;
  if (view === "krlive") loadKrLive({ quiet: true });
  if (view === "top30") loadTop30();
  if (view === "limits") loadLimits();
  if (view === "krthemes") loadKrThemes();
  if (view === "ipo") loadIpo();
  if (view === "briefing") loadBriefing();
  if (view === "krbriefing") loadKrBriefing();
  if (view === "watch") {
    loadWatch();
    loadBroker();
  }
  const hash = view === "krlive" ? "" : `#${view}`;
  if (location.hash !== hash) history.replaceState(null, "", hash || location.pathname);
}

// 주소의 # 부분이 바뀌면(뒤로 가기, 주소 직접 입력) 그 탭으로
window.addEventListener("hashchange", () => showView(location.hash.slice(1) || "krlive"));

document.querySelector(".tabs").addEventListener("click", (e) => {
  const tab = e.target.closest("[data-view]");
  if (tab) showView(tab.dataset.view);
});

// 휴대폰용 선택 상자: 탭 목록을 그대로 옮겨 담음
$("#view-select").innerHTML = VIEWS.map((v) => `<option value="${v}">${$(`#tab-${v}`).textContent}</option>`).join("");
$("#view-select").addEventListener("change", (e) => showView(e.target.value));

// ---------- 상세 ----------

let chart = null;

function statBox(label, value, cls = "") {
  return `<div class="stat"><span>${label}</span><b class="${cls}">${value}</b></div>`;
}

function scoreColumn(title, part) {
  const items = part.items
    .map(
      (i) => `<div class="score-item">
        <div class="mini-label"><span>${esc(i.label)}</span><b>${i.score == null ? "계산 불가" : `${i.score}/${i.max}`}</b></div>
        ${i.score == null ? "" : `<div class="mini-track"><div class="mini-fill" style="width:${(i.score / i.max) * 100}%"></div></div>`}
        <p>${esc(i.detail)}</p>
      </div>`
    )
    .join("");
  return `<div class="score-col"><h4><span>${title}</span><span class="num">${part.score} / ${part.max}</span></h4>${items}</div>`;
}

// 기사 시각: 1시간 안이면 "N분 전", 오늘이면 "N시간 전", 그 외에는 날짜
function newsTime(iso) {
  const t = new Date(iso);
  const diff = (Date.now() - t.getTime()) / 60000;
  if (diff < 60) return `${Math.max(1, Math.round(diff))}분 전`;
  if (diff < 24 * 60) return `${Math.round(diff / 60)}시간 전`;
  return `${t.getMonth() + 1}.${t.getDate()} ${t.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

async function loadNews(code) {
  const box = $("#news-section");
  try {
    const { items } = await getJson(`/api/news?code=${encodeURIComponent(code)}`);
    if (!box.isConnected) return; // 그 사이 다른 종목을 열었으면 무시
    box.innerHTML = items.length
      ? `<ul class="news">${items
          .map(
            (n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">
              <span class="news-title">${esc(n.title)}</span>
              <span class="news-meta">${esc(n.press)} · ${newsTime(n.time)}${n.related ? ` · 관련 기사 ${n.related}건` : ""}</span>
            </a></li>`
          )
          .join("")}</ul>`
      : `<p class="sub">최근 관련 뉴스가 없어요.</p>`;
  } catch (e) {
    if (box.isConnected) box.innerHTML = `<p class="sub">뉴스를 불러오지 못했어요. (${esc(e.message)})</p>`;
  }
}

function fundamentalsSection(f, price) {
  if (!f || !f.revenue?.some((p) => p.value != null)) return "";
  const last = (series) => series?.filter((p) => p.value != null).at(-1)?.value ?? null;
  const fixed = (v, d, unit) => (v == null ? "-" : `${v.toFixed(d)}${unit}`);
  const upside = f.targetPrice && price ? ((f.targetPrice - price) / price) * 100 : null;
  const opinion = f.recommMean == null ? null : f.recommMean >= 3.5 ? "매수" : f.recommMean >= 2.5 ? "중립" : "매도";

  const years = f.revenue.map((p) => p.year);
  const head = years.map((y) => `<th>${y}</th>`).join("") + (f.estimateYear ? `<th>${f.estimateYear}(추정)</th>` : "");
  const row = (label, series, est, fmt) =>
    `<tr><td>${label}</td>${series.map((p) => `<td class="num">${fmt(p.value)}</td>`).join("")}${f.estimateYear ? `<td class="num">${fmt(est)}</td>` : ""}</tr>`;
  const money = (v) => (v == null ? "-" : v.toLocaleString("ko-KR"));
  const rate = (v) => (v == null ? "-" : `${v.toFixed(1)}%`);

  return `
    <div class="section-title"><span>재무 요약</span><span class="sub">연간 · 금액 단위 억원</span></div>
    <div class="stats">
      ${statBox("PER", fixed(f.per, 1, "배"))}
      ${statBox("PBR", fixed(f.pbr, 2, "배"))}
      ${statBox("ROE", fixed(last(f.roe), 1, "%"))}
      ${statBox("부채비율", fixed(last(f.debtRatio), 0, "%"))}
      ${statBox("시가총액", esc(f.marketValue ?? "-"))}
      ${statBox(
        "목표주가(평균)",
        f.targetPrice ? `${won(f.targetPrice)}${upside != null ? ` <small class="${dir(upside)}">${pct(upside, 0)}</small>` : ""}` : "-"
      )}
    </div>
    <div class="table-wrap"><table class="flow-table">
      <thead><tr><th>항목</th>${head}</tr></thead>
      <tbody>
        ${row("매출액", f.revenue, f.revenueEst, money)}
        ${row("영업이익", f.operatingProfit, f.operatingProfitEst, money)}
        ${row("영업이익률", f.operatingMargin, null, rate)}
        ${row("ROE", f.roe, null, rate)}
      </tbody>
    </table></div>
    ${opinion ? `<p class="sub" style="margin-top:6px">증권사 평균 투자의견 ${opinion} (${f.recommMean.toFixed(2)} / 5) · 목표주가는 참고용이며 점수에는 넣지 않았어요.</p>` : ""}`;
}

function flowChart(flows) {
  if (!flows.length) return `<p class="sub">수급 데이터가 없어요.</p>`;
  const W = 640;
  const H = 180;
  const pad = { l: 44, r: 6, t: 8, b: 20 };
  const keys = [
    ["foreignAmt", "var(--foreign)"],
    ["institutionAmt", "var(--institution)"],
    ["individualAmt", "var(--individual)"],
  ];
  const maxAbs = Math.max(1, ...flows.flatMap((f) => keys.map(([k]) => Math.abs(f[k]))));
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const zero = pad.t + innerH / 2;
  const slot = innerW / flows.length;
  const bw = Math.max(2, (slot * 0.75) / keys.length);
  const y = (v) => (v / maxAbs) * (innerH / 2);
  let bars = "";
  flows.forEach((f, i) => {
    keys.forEach(([k, color], j) => {
      const h = y(f[k]);
      const x = pad.l + i * slot + slot * 0.125 + j * bw;
      bars += `<rect x="${x.toFixed(1)}" y="${(h >= 0 ? zero - h : zero).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, Math.abs(h)).toFixed(1)}" fill="${color}"><title>${dateLabel(f.date)} ${k === "foreignAmt" ? "외국인" : k === "institutionAmt" ? "기관" : "개인"} ${eok(f[k])}</title></rect>`;
    });
    if (i % Math.ceil(flows.length / 7) === 0) {
      bars += `<text x="${pad.l + i * slot + slot / 2}" y="${H - 4}" font-size="10" text-anchor="middle" fill="var(--muted)">${dateLabel(f.date)}</text>`;
    }
  });
  const axis = [maxAbs, 0, -maxAbs]
    .map((v) => `<text x="${pad.l - 6}" y="${zero - y(v) + 3}" font-size="10" text-anchor="end" fill="var(--muted)">${v === 0 ? "0" : eok(v).replace("+", "")}</text>`)
    .join("");
  return `<svg class="flow-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="투자자별 순매수 금액">
    <line x1="${pad.l}" x2="${W - pad.r}" y1="${zero}" y2="${zero}" stroke="var(--border)"/>${axis}${bars}
  </svg>`;
}

// 그날 순매수 금액 + 매수/매도 구분과 추정 평균단가
function flowCell(f, k) {
  const v = f[`${k}Amt`];
  const side = f[k] > 0 ? "매수" : f[k] < 0 ? "매도" : "";
  return `<td class="num ${dir(v)}">${eok(v)}${side ? `<small class="side">${side} ${won(f.typical ?? f.close)}</small>` : ""}</td>`;
}

function flowTable(flows) {
  const rows = [...flows]
    .reverse()
    .map(
      (f) => `<tr><td>${f.date.slice(0, 4)}.${dateLabel(f.date)}</td>
        <td class="num">${won(f.close)}</td>
        ${flowCell(f, "foreign")}${flowCell(f, "institution")}${flowCell(f, "individual")}
        <td class="num">${f.foreignHoldRatio == null ? "-" : `${f.foreignHoldRatio.toFixed(2)}%`}</td></tr>`
    )
    .join("");
  return `<div class="table-wrap flow-scroll"><table class="flow-table"><thead><tr><th>날짜</th><th>종가</th><th>외국인</th><th>기관</th><th>개인</th><th>외국인 보유율</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// 선택한 기간의 외국인/기관/개인 누적 순매수
function flowTotals(flows) {
  const sum = (k) => flows.reduce((s, f) => s + f[k], 0);
  // 순매수한 날만 모아 (금액 합 ÷ 수량 합), 순매도한 날도 같은 방식 - 하루 대표가격 기준 추정치
  const avg = (k, sign) => {
    const days = flows.filter((f) => Math.sign(f[k]) === sign);
    const qty = days.reduce((s, f) => s + f[k], 0);
    return { price: qty ? days.reduce((s, f) => s + f[k] * (f.typical ?? f.close), 0) / qty : null, days: days.length };
  };
  const avgLine = (label, cls, a) =>
    `<small class="avg"><em>${label} 평단</em> <strong class="${a.price == null ? "" : cls}">${a.price == null ? "-" : `${won(a.price)}원`}</strong> <em>${a.days}일</em></small>`;
  const box = (label, color, v, k) =>
    `<div class="stat total"><span><i style="background:${color}"></i>${label} 누적</span><b class="${dir(v)}">${eok(v)}</b>${avgLine("순매수", "up", avg(k, 1))}${avgLine("순매도", "down", avg(k, -1))}</div>`;
  const first = flows[0]?.foreignHoldRatio;
  const last = flows.at(-1)?.foreignHoldRatio;
  const holdChange = first != null && last != null ? last - first : null;
  return `<div class="totals">
    ${box("외국인", "var(--foreign)", sum("foreignAmt"), "foreign")}
    ${box("기관", "var(--institution)", sum("institutionAmt"), "institution")}
    ${box("개인", "var(--individual)", sum("individualAmt"), "individual")}
    <div class="stat total"><span>외국인 보유율 변화</span><b class="${dir(holdChange)}">${holdChange == null ? "-" : `${holdChange > 0 ? "+" : ""}${holdChange.toFixed(2)}%p`}</b></div>
  </div>`;
}

const FLOW_PERIODS = [5, 10, 15, 20, 30];

function renderFlows(all, days) {
  const flows = all.slice(-days);
  const range = flows.length ? `${dateLabel(flows[0].date)} ~ ${dateLabel(flows.at(-1).date)}` : "";
  $("#flow-section").innerHTML = `
    <div class="section-title">
      <span>투자자별 순매수 (최근 ${flows.length}거래일, 금액)</span>
      <div class="chips" id="flow-chips">
        ${FLOW_PERIODS.map((d) => `<button class="chip" data-days="${d}" aria-selected="${d === days}">${d}일</button>`).join("")}
      </div>
    </div>
    <div class="legend" style="margin-bottom:6px"><span><i style="background:var(--foreign)"></i>외국인</span><span><i style="background:var(--institution)"></i>기관</span><span><i style="background:var(--individual)"></i>개인</span></div>
    ${flowChart(flows)}
    ${flows.length ? flowTable(flows) : ""}
    ${flows.length ? `<div class="section-title" style="margin-top:14px"><span>기간 누적 순매수</span><span class="sub">${range}</span></div>${flowTotals(flows)}<p class="sub avg-note">평단은 순매수(순매도)한 날의 수량에 그날 대표가격 (고가 + 저가 + 종가) ÷ 3을 곱해 낸 추정치예요. 투자자별 실제 체결가는 공개되지 않아 차이가 있을 수 있어요.</p>` : ""}`;
}

// 종목 상세 차트 종류: 이동평균은 봉 개수 기준, options는 분봉이면 묶는 단위(분), 나머지는 보이는 봉 개수
const CHART_PERIODS = {
  minute: { label: "분봉", note: "최근 5거래일 정규장", ma: [5, 20, 60], maUnit: "이평", options: [["1", "1분"], ["5", "5분"], ["15", "15분"], ["60", "60분"]], default: "5" },
  day: { label: "일봉", ma: [5, 20, 60], maUnit: "일선", options: [["22", "1개월"], ["66", "3개월"], ["90", "90일"], ["999", "전체"]], default: "90" },
  week: { label: "주봉", note: "약 10년", ma: [5, 20, 60], maUnit: "주선", options: [["52", "1년"], ["156", "3년"], ["999", "전체"]], default: "156" },
  month: { label: "월봉", note: "2000년부터", ma: [5, 20, 60], maUnit: "개월선", options: [["36", "3년"], ["120", "10년"], ["999", "전체"]], default: "120" },
};

// candles: [{ time, open, high, low, close, volume }] - time은 "YYYY-MM-DD" 또는 (분봉) 초
function drawCandles(el, candles, { ma: maList = [5, 20, 60], intraday = false, vwap = null } = {}) {
  if (chart) chart.remove();
  chart = null;
  if (!window.LightweightCharts) {
    el.innerHTML = `<div class="state">차트 라이브러리를 불러오지 못했어요.</div>`;
    return;
  }
  const L = window.LightweightCharts;
  chart = L.createChart(el, {
    autoSize: true,
    layout: { background: { color: css("--surface") }, textColor: css("--muted"), fontFamily: "Noto Sans KR" },
    grid: { vertLines: { color: css("--border") }, horzLines: { color: css("--border") } },
    rightPriceScale: { borderColor: css("--border") },
    timeScale: { borderColor: css("--border"), timeVisible: intraday, secondsVisible: false },
    // 휠은 상세 창 스크롤에 쓰고, 차트 이동/확대는 드래그·핀치로
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    localization: { priceFormatter: (p) => Math.round(p).toLocaleString("ko-KR") },
  });
  const up = css("--up");
  const down = css("--down");
  const series = chart.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
  series.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));

  const ma = (period, color) => {
    const s = chart.addLineSeries({ color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const data = [];
    for (let i = period - 1; i < candles.length; i++) {
      let sum = 0;
      for (let k = i - period + 1; k <= i; k++) sum += candles[k].close;
      data.push({ time: candles[i].time, value: sum / period });
    }
    s.setData(data);
  };
  const colors = ["#f2a01d", css("--institution"), css("--individual")];
  maList.forEach((n, i) => ma(n, colors[i]));

  if (vwap) {
    series.createPriceLine({ price: vwap, color: css("--muted"), lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: "VWAP20" });
  }

  const vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
  chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  vol.setData(
    candles.map((c, i) => ({
      time: c.time,
      value: c.volume,
      color: `${c.close >= (candles[i - 1]?.close ?? c.open) ? up : down}66`,
    }))
  );
}

function setRange(days, total) {
  if (!chart) return;
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, total - days), to: total + 2 });
}

async function openDetail(code) {
  const dlg = $("#detail");
  const body = $("#detail-body");
  body.innerHTML = `<div class="detail-head"><div class="skeleton" style="width:220px;height:56px"></div><button class="close-btn" data-close aria-label="닫기">×</button></div>
    <div class="skeleton" style="height:340px;margin-top:16px"></div>`;
  if (!dlg.open) dlg.showModal();

  let s;
  try {
    s = await getJson(`/api/stock?code=${encodeURIComponent(code)}`);
  } catch (e) {
    body.innerHTML = `<div class="detail-head"><h3 id="detail-title">${esc(code)}</h3><button class="close-btn" data-close aria-label="닫기">×</button></div>
      <div class="state">종목을 불러오지 못했어요.<br><small>${esc(e.message)}</small></div>`;
    return;
  }

  const pick = state.picks.find((p) => p.code === code);
  const st = s.stats;
  const d = dir(s.changePct);
  body.innerHTML = `
    <div class="detail-head">
      <div>
        <h3 id="detail-title">${esc(s.name)} ${ring(s.score.total, s.score.grade).replace('class="ring"', 'class="ring" style="display:inline-block;vertical-align:middle;margin-left:8px"')}</h3>
        <div class="card-meta">${esc(s.code)} · ${esc(s.market)}${pick ? ` · <span class="tag">${esc(pick.theme)}</span> 미국 테마 ${pct(pick.themeChange)}` : ""} · ${s.marketStatus === "OPEN" ? "장중" : "장 마감"}${st.days < 90 ? ` · <b>상장 후 ${st.days}거래일</b>` : ""}</div>
        <div class="detail-price"><span class="num">${won(s.price)}원</span><span class="num ${d}">${arrow(s.changePct)} ${won(Math.abs(s.change ?? 0))} (${pct(s.changePct)})</span></div>
      </div>
      <div class="head-actions">
        <button class="watch-btn" id="watch-btn" type="button" data-code="${esc(s.code)}" data-name="${esc(s.name)}" aria-pressed="false">☆ 관심</button>
        <button class="close-btn" data-close aria-label="닫기">×</button>
      </div>
    </div>

    <div class="stats">
      ${statBox("90일 수익률", pct(st.return90, 1), dir(st.return90))}
      ${statBox("90일 고가", won(st.high90))}
      ${statBox("90일 저가", won(st.low90))}
      ${statBox("5일 VWAP", won(st.vwap5))}
      ${statBox("20일 VWAP", won(st.vwap20))}
      ${statBox("20일선", won(st.ma20))}
    </div>

    <div class="section-title">
      <span id="chart-title">일봉 차트</span>
      <div class="chips" id="period-chips">
        ${Object.entries(CHART_PERIODS)
          .map(([k, p]) => `<button class="chip" data-period="${k}" aria-selected="${k === "day"}">${p.label}</button>`)
          .join("")}
      </div>
    </div>
    <div class="chart-sub">
      <div class="legend" id="chart-legend"></div>
      <div class="chips" id="range-chips"></div>
    </div>
    <div class="chart-box" id="candle-chart"></div>

    <div class="section-title"><span>관련 뉴스</span><span class="sub">네이버 뉴스 · 누르면 원문이 새 창으로 열려요</span></div>
    <div id="news-section"><div class="skeleton" style="height:120px"></div></div>

    <div class="section-title"><span>내 메모</span><span class="sub">로그인한 본인만 볼 수 있어요</span></div>
    <div id="memo-section" data-code="${esc(s.code)}" data-name="${esc(s.name)}"></div>

    <div class="section-title"><span>점수 근거 · ${s.score.total == null ? "종합 점수 없음" : `종합 ${s.score.total}점`}</span>${
      s.score.total == null
        ? `<span class="sub">계산할 수 있는 항목이 100점 중 ${s.score.available}점뿐이라 종합 점수를 내지 않았어요</span>`
        : s.score.complete
          ? ""
          : `<span class="sub">일부 항목은 데이터가 없어 제외하고 환산했어요</span>`
    }</div>
    <div class="score-grid">${scoreColumn("기술", s.score.technical)}${scoreColumn("수급", s.score.supply)}${scoreColumn("기본", s.score.basic)}</div>

    ${fundamentalsSection(s.fundamentals, s.price)}

    <div id="flow-section"></div>
    <p class="sub" style="margin-top:10px">순매수 금액 = 순매수 수량 × 그날 종가(추정치). ${timeLabel(new Date(s.updatedAt))} 기준.</p>
  `;

  loadNews(code);
  renderAccountTools();
  renderFlows(s.flows, 20);
  $("#flow-section").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-days]");
    if (btn) renderFlows(s.flows, Number(btn.dataset.days));
  });

  // 차트: 일봉은 이미 받은 것, 분봉·주봉·월봉은 처음 누를 때 받아 둠
  const view = {
    code,
    period: "day",
    option: CHART_PERIODS.day.default,
    data: { day: s.candles.map((c) => ({ ...c, time: `${c.date.slice(0, 4)}-${c.date.slice(4, 6)}-${c.date.slice(6, 8)}` })) },
    vwap: st.vwap20,
  };
  showChart(view);
  $("#period-chips").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-period]");
    if (!btn || btn.dataset.period === view.period) return;
    view.period = btn.dataset.period;
    view.option = CHART_PERIODS[view.period].default;
    showChart(view);
  });
  $("#range-chips").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-opt]");
    if (!btn) return;
    view.option = btn.dataset.opt;
    // 분봉은 묶는 단위가 바뀌어 다시 그리고, 나머지는 보이는 범위만 바꿈
    if (view.period === "minute") showChart(view);
    else {
      markChips(view);
      setRange(Number(view.option), view.data[view.period].length);
    }
  });
}

function markChips(view) {
  document.querySelectorAll("#period-chips .chip").forEach((c) => c.setAttribute("aria-selected", c.dataset.period === view.period));
  document.querySelectorAll("#range-chips .chip").forEach((c) => c.setAttribute("aria-selected", c.dataset.opt === view.option));
}

let chartSeq = 0;

async function showChart(view) {
  const p = CHART_PERIODS[view.period];
  const seq = ++chartSeq;
  $("#chart-title").textContent = `${p.label} 차트${p.note ? ` · ${p.note}` : ""}`;
  $("#range-chips").innerHTML = p.options.map(([v, l]) => `<button class="chip" data-opt="${v}">${l}</button>`).join("");
  const colors = ["#f2a01d", "var(--institution)", "var(--individual)"];
  $("#chart-legend").innerHTML =
    p.ma.map((n, i) => `<span><i style="background:${colors[i]}"></i>${n}${p.maUnit}</span>`).join("") +
    (view.period === "day" ? `<span><i style="background:var(--muted)"></i>20일 VWAP</span>` : "");
  markChips(view);
  const el = $("#candle-chart");
  if (!view.data[view.period]) {
    el.classList.add("loading");
    try {
      const r = await getJson(`/api/candles?code=${encodeURIComponent(view.code)}&period=${view.period}`);
      view.data[view.period] = r.candles;
    } catch (e) {
      if (seq !== chartSeq) return;
      el.classList.remove("loading");
      if (chart) chart.remove();
      chart = null;
      el.innerHTML = `<div class="state">차트를 불러오지 못했어요.<br><small>${esc(e.message)}</small></div>`;
      return;
    } finally {
      if (seq === chartSeq) el.classList.remove("loading");
    }
    if (seq !== chartSeq || !$("#detail").open) return; // 그사이 다른 봉을 눌렀거나 창을 닫음
  }
  let candles = view.data[view.period];
  if (view.period === "minute") candles = groupMinutes(candles, Number(view.option));
  if (!candles.length) {
    if (chart) chart.remove();
    chart = null;
    el.innerHTML = `<div class="state">표시할 봉이 없어요.</div>`;
    return;
  }
  if (!chart) el.innerHTML = ""; // 오류·빈 안내 문구 지우기
  drawCandles(el, candles, { ma: p.ma, intraday: view.period === "minute", vwap: view.period === "day" ? view.vwap : null });
  if (view.period === "minute") {
    // 분봉은 마지막 거래일 하루가 보이게 (이전 날은 드래그해서 보기)
    const lastDay = candles.at(-1).date;
    setRange(candles.length - candles.findIndex((c) => c.date === lastDay), candles.length);
  } else setRange(Number(view.option), candles.length);
}

// 1분봉을 n분봉으로 묶음 (날짜가 바뀌면 새 봉)
function groupMinutes(rows, n) {
  if (n <= 1) return rows;
  const out = [];
  for (const r of rows) {
    const minuteOfDay = Math.floor((r.time % 86400) / 60);
    const start = r.time - (r.time % 86400) + (minuteOfDay - (minuteOfDay % n)) * 60;
    const last = out.at(-1);
    if (last && last.time === start && last.date === r.date) {
      last.high = Math.max(last.high, r.high);
      last.low = Math.min(last.low, r.low);
      last.close = r.close;
      last.volume += r.volume;
    } else out.push({ ...r, time: start });
  }
  return out;
}

// ---------- 시장 지표 상세 차트 ----------

const MARKET_RANGES = [
  ["1d", "1일"],
  ["5d", "5일"],
  ["1mo", "1개월"],
  ["3mo", "3개월"],
  ["1y", "1년"],
  ["5y", "5년"],
];

function drawMarketChart(el, data) {
  if (chart) chart.remove();
  chart = null;
  if (!window.LightweightCharts) {
    el.innerHTML = `<div class="state">차트 라이브러리를 불러오지 못했어요.</div>`;
    return;
  }
  const up = css("--up");
  const down = css("--down");
  chart = window.LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: css("--surface") }, textColor: css("--muted"), fontFamily: "Noto Sans KR" },
    grid: { vertLines: { color: css("--border") }, horzLines: { color: css("--border") } },
    rightPriceScale: { borderColor: css("--border") },
    timeScale: { borderColor: css("--border"), timeVisible: data.intraday, secondsVisible: false },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    localization: { priceFormatter: (p) => num(p) },
  });
  const series = chart.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
  series.setData(data.candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  if (data.range === "1d" && data.prevClose) {
    series.createPriceLine({ price: data.prevClose, color: css("--muted"), lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: "전일 종가" });
  }
  if (data.candles.some((c) => c.volume > 0)) {
    const vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(data.candles.map((c) => ({ time: c.time, value: c.volume, color: `${c.close >= c.open ? up : down}66` })));
  }
  chart.timeScale().fitContent();
}

let marketSeq = 0;

async function openMarket(id, range = "1d") {
  const seq = ++marketSeq;
  const dlg = $("#detail");
  const body = $("#detail-body");
  if (!dlg.open) {
    body.innerHTML = `<div class="detail-head"><div class="skeleton" style="width:220px;height:56px"></div><button class="close-btn" data-close aria-label="닫기">×</button></div>
      <div class="skeleton" style="height:380px;margin-top:16px"></div>`;
    dlg.showModal();
  } else {
    $("#market-chart")?.classList.add("loading");
  }

  let m;
  try {
    m = await getJson(`/api/chart?id=${encodeURIComponent(id)}&range=${range}`);
    // 기다리는 사이 다른 기간을 눌렀거나 창을 닫았으면 이 응답은 버림
    if (seq !== marketSeq || !dlg.open) return;
  } catch (e) {
    if (seq !== marketSeq || !dlg.open) return;
    body.innerHTML = `<div class="detail-head"><h3 id="detail-title">시장 지표</h3><button class="close-btn" data-close aria-label="닫기">×</button></div>
      <div class="state">차트를 불러오지 못했어요.<br><small>${esc(e.message)}</small><br><button data-market-retry="${esc(id)}">다시 시도</button></div>`;
    return;
  }

  const c = m.candles;
  // 1일은 전일 종가 대비, 그 외는 기간 첫 봉 시가 대비
  const base = range === "1d" ? m.prevClose : c[0]?.open;
  const change = m.price != null && base ? m.price - base : null;
  const changePct = change != null ? (change / base) * 100 : null;
  const hi = c.length ? Math.max(...c.map((x) => x.high)) : null;
  const lo = c.length ? Math.min(...c.map((x) => x.low)) : null;
  const unit = m.unit ? ` ${m.unit}` : "";
  const label = MARKET_RANGES.find(([r]) => r === range)[1];

  body.innerHTML = `
    <div class="detail-head">
      <div>
        <h3 id="detail-title">${esc(m.name)}</h3>
        <div class="card-meta">${esc(m.symbol)}${m.exchange ? ` · ${esc(m.exchange)}` : ""} · 시각은 한국 시간</div>
        <div class="detail-price"><span class="num">${num(m.price)}${unit}</span><span class="num ${dir(changePct)}">${arrow(changePct)} ${num(Math.abs(change ?? 0))} (${pct(changePct)}) <small class="sub">${range === "1d" ? "전일 대비" : `${label} 동안`}</small></span></div>
      </div>
      <button class="close-btn" data-close aria-label="닫기">×</button>
    </div>
    <div class="section-title">
      <span>차트 · ${m.intraday ? `${m.interval.replace("m", "분")}봉` : m.interval === "1wk" ? "주봉" : "일봉"}</span>
      <div class="chips">${MARKET_RANGES.map(([r, l]) => `<button class="chip" data-market-range="${r}" data-market-id="${esc(id)}" aria-selected="${r === range}">${l}</button>`).join("")}</div>
    </div>
    <div class="chart-box market-chart" id="market-chart"></div>
    <div class="stats">
      ${statBox(range === "1d" ? "전일 종가" : "기간 시작", num(base))}
      ${statBox(`${label} 고가`, num(hi))}
      ${statBox(`${label} 저가`, num(lo))}
      ${statBox("52주 최고", num(m.high52))}
      ${statBox("52주 최저", num(m.low52))}
      ${statBox("봉 개수", `${c.length.toLocaleString()}개`)}
    </div>
    <p class="sub">데이터: ${esc(m.source || "Yahoo Finance")} · 지연될 수 있어요. 차트는 드래그로 이동, 두 손가락으로 확대할 수 있어요.</p>`;

  if (c.length) drawMarketChart($("#market-chart"), m);
  else $("#market-chart").innerHTML = `<div class="state">이 기간에는 데이터가 없어요.</div>`;
}

// ---------- 이벤트 ----------

document.addEventListener("click", (e) => {
  const card = e.target.closest(".card[data-code], .rank-list [data-code]");
  if (card) return openDetail(card.dataset.code);

  const ind = e.target.closest("[data-industry]");
  if (ind) return openIndustry(ind.dataset.industry);
  const ipoLink = e.target.closest("[data-ipo-url]");
  if (ipoLink) return window.open(ipoLink.dataset.ipoUrl, "_blank", "noopener");
  if (e.target.closest("[data-ipo-retry]")) {
    ipoLoaded = 0;
    return loadIpo();
  }
  const th = e.target.closest("[data-krtheme]");
  if (th) return openKrTheme(th.dataset.krtheme);
  if (e.target.closest("[data-krthemes-retry]")) {
    krThemesLoaded = 0;
    return loadKrThemes();
  }

  const mkt = e.target.closest(".mkt[data-market]");
  if (mkt) return openMarket(mkt.dataset.market);
  const range = e.target.closest("[data-market-range]");
  if (range) return openMarket(range.dataset.marketId, range.dataset.marketRange);
  const retry = e.target.closest("[data-market-retry]");
  if (retry) return openMarket(retry.dataset.marketRetry);

  const chip = e.target.closest("#theme-filter [data-theme]");
  if (chip) {
    state.filter = chip.dataset.theme;
    renderFilter();
    renderPicks();
    return;
  }

  if (e.target.closest("[data-limits-retry]")) {
    limitsLoaded = 0;
    return loadLimits();
  }
  if (e.target.closest("[data-kr-retry]")) {
    krLoaded = 0;
    return loadKrBriefing();
  }
  if (e.target.closest("[data-briefing-retry]")) {
    briefingLoaded = 0;
    return loadBriefing();
  }
  if (e.target.closest("#top30 [data-retry]")) {
    top30Loaded = 0;
    return loadTop30();
  }
  if (e.target.closest("[data-retry]")) return load();
  if (e.target.closest("[data-close]")) return $("#detail").close();
});

// 바깥 클릭으로 닫기
$("#detail").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});
$("#detail").addEventListener("close", () => {
  if (chart) chart.remove();
  chart = null;
});

$("#refresh-btn").addEventListener("click", () => load({ quiet: true }));

// ---------- 종목 검색 (이름 또는 코드) ----------

const isCode = (s) => /^[0-9A-Z]{6}$/i.test(s) && /\d/.test(s);
const search = { items: [], active: -1, timer: null, seq: 0 };

function closeSuggest() {
  $("#suggest").hidden = true;
  $("#search-input").setAttribute("aria-expanded", "false");
  search.active = -1;
}

function renderSuggest(message) {
  const list = $("#suggest");
  list.innerHTML = message
    ? `<li class="empty">${esc(message)}</li>`
    : search.items
        .map(
          (s, i) => `<li role="option" data-code="${esc(s.code)}" aria-selected="${i === search.active}">
            <b>${esc(s.name)}</b><span>${esc(s.code)} · ${esc(s.market)}</span></li>`
        )
        .join("");
  list.hidden = false;
  $("#search-input").setAttribute("aria-expanded", "true");
}

async function fetchSuggest(q) {
  const seq = ++search.seq;
  try {
    const { items } = await getJson(`/api/search?q=${encodeURIComponent(q)}`);
    if (seq !== search.seq) return null; // 더 최근 입력이 있으면 무시
    search.items = items;
    search.active = items.length ? 0 : -1;
    return items;
  } catch {
    if (seq === search.seq) search.items = [];
    return [];
  }
}

function pick(code) {
  closeSuggest();
  $("#search-input").value = "";
  $("#search-input").blur();
  openDetail(code.toUpperCase());
}

$("#search-input").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  clearTimeout(search.timer);
  if (!q) return closeSuggest();
  search.timer = setTimeout(async () => {
    const items = await fetchSuggest(q);
    if (items == null) return;
    if (items.length) renderSuggest();
    else renderSuggest(isCode(q) ? "Enter를 누르면 이 코드로 분석해요" : "검색 결과가 없어요");
  }, 200);
});

$("#search-input").addEventListener("keydown", (e) => {
  if ($("#suggest").hidden || !search.items.length) {
    if (e.key === "Escape") closeSuggest();
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = search.items.length;
    search.active = (search.active + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    renderSuggest();
  } else if (e.key === "Escape") {
    closeSuggest();
  }
});

$("#suggest").addEventListener("mousedown", (e) => {
  const li = e.target.closest("li[data-code]");
  if (li) {
    e.preventDefault(); // 입력창 blur보다 먼저 처리
    pick(li.dataset.code);
  }
});

$("#search-input").addEventListener("blur", () => setTimeout(closeSuggest, 100));

$("#search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#search-input").value.trim();
  if (!q) return;
  // 목록에서 고른 항목 → 정확한 코드 → 검색 첫 결과 순서
  if (!$("#suggest").hidden && search.items[search.active]) return pick(search.items[search.active].code);
  if (isCode(q)) return pick(q);
  clearTimeout(search.timer);
  const items = await fetchSuggest(q);
  if (items?.length) {
    const exact = items.find((s) => s.name === q);
    return pick((exact || items[0]).code);
  }
  renderSuggest("검색 결과가 없어요");
});

// 화면이 보일 때만 자동 새로고침
setInterval(() => {
  if (document.visibilityState === "visible" && !$("#detail").open) load({ quiet: true });
}, REFRESH_MS);

// ---------- 로그인 · 관심 종목 · 메모 ----------

const fmtTime = (iso) => {
  const t = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}.${p(t.getMonth() + 1)}.${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
};
const userLabel = (u) => (u?.email || "").split("@")[0];

function renderAccountBtn() {
  const u = account.currentUser();
  const btn = $("#account-btn");
  btn.textContent = u ? `${userLabel(u)} · 로그아웃` : "로그인";
  btn.title = u ? `${u.email}로 로그인됨` : "가족 계정으로 로그인";
}

function openLogin() {
  $("#login-error").hidden = true;
  $("#login-password").value = "";
  $("#login").showModal();
  $("#login-email").focus();
}

$("#account-btn").addEventListener("click", async () => {
  if (!account.currentUser()) return openLogin();
  if (!confirm("로그아웃할까요?")) return;
  await account.signOut();
});

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#login-submit");
  btn.disabled = true;
  btn.textContent = "로그인 중…";
  try {
    await account.signIn($("#login-email").value.trim(), $("#login-password").value);
    $("#login").close();
  } catch (err) {
    $("#login-error").textContent = err.message;
    $("#login-error").hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "로그인";
    $("#login-password").value = "";
  }
});
$("#login").addEventListener("click", (e) => {
  if (e.target === e.currentTarget || e.target.closest("[data-login-close]")) $("#login").close();
});

// 로그인 상태가 바뀌면 열려 있는 화면을 다시 그림
account.onUserChange(() => {
  renderAccountBtn();
  watchLoaded = false;
  if (!$("#view-watch").hidden) {
    loadWatch();
    loadBroker();
  }
  renderAccountTools();
});

// 종목 상세의 관심 버튼과 메모
async function renderAccountTools() {
  const box = $("#memo-section");
  const btn = $("#watch-btn");
  if (!box || !btn) return;
  const code = box.dataset.code;
  if (!account.currentUser()) {
    btn.textContent = "☆ 관심";
    btn.setAttribute("aria-pressed", "false");
    box.innerHTML = `<div class="memo-login">로그인하면 이 종목에 메모를 남기고 관심 종목으로 저장할 수 있어요. <button type="button" data-login-open>로그인</button></div>`;
    return;
  }
  box.innerHTML = `<div class="skeleton" style="height:80px"></div>`;
  try {
    const [watched, memos] = await Promise.all([account.isWatched(code), account.listMemos(code)]);
    if ($("#memo-section")?.dataset.code !== code) return; // 그사이 다른 종목을 열었으면 무시
    btn.textContent = watched ? "★ 관심" : "☆ 관심";
    btn.setAttribute("aria-pressed", String(watched));
    box.innerHTML = `
      <form class="memo-form" id="memo-form">
        <textarea id="memo-input" maxlength="2000" rows="2" placeholder="이 종목에 대한 메모 (예: 산 이유, 목표가, 확인할 일)"></textarea>
        <button class="primary-btn" type="submit">저장</button>
      </form>
      ${memos.length ? `<ul class="memos">${memos.map(memoItem).join("")}</ul>` : `<p class="sub">아직 메모가 없어요.</p>`}`;
  } catch (e) {
    box.innerHTML = `<div class="state">메모를 불러오지 못했어요.<br><small>${esc(e.message)}</small></div>`;
  }
}

function memoItem(m) {
  const edited = new Date(m.updated_at) - new Date(m.created_at) > 1000;
  return `<li data-memo-id="${esc(m.id)}">
    <p class="memo-body">${esc(m.body)}</p>
    <div class="memo-meta"><span>${fmtTime(m.created_at)}${edited ? ` · 수정 ${fmtTime(m.updated_at)}` : ""}</span>
      <span><button type="button" data-memo-edit>수정</button><button type="button" data-memo-del>삭제</button></span></div>
  </li>`;
}

$("#detail").addEventListener("submit", async (e) => {
  const form = e.target;
  e.preventDefault();
  const box = $("#memo-section");
  try {
    if (form.id === "memo-form") {
      const body = $("#memo-input").value.trim();
      if (!body) return;
      form.querySelector("button").disabled = true;
      await account.addMemo(box.dataset.code, box.dataset.name, body);
    } else if (form.matches("[data-memo-edit-form]")) {
      const body = form.querySelector("textarea").value.trim();
      if (!body) return;
      await account.updateMemo(form.closest("[data-memo-id]").dataset.memoId, body);
    } else return;
    watchLoaded = false;
    renderAccountTools();
  } catch (err) {
    alert(`저장하지 못했어요: ${err.message}`);
    form.querySelector("button").disabled = false;
  }
});

$("#detail").addEventListener("click", async (e) => {
  if (e.target.closest("[data-login-open]")) return openLogin();
  const li = e.target.closest("[data-memo-id]");
  if (li && e.target.closest("[data-memo-edit]")) {
    const text = li.querySelector(".memo-body").textContent;
    li.innerHTML = `<form class="memo-form" data-memo-edit-form><textarea maxlength="2000" rows="3">${esc(text)}</textarea>
      <span class="memo-edit-actions"><button class="primary-btn" type="submit">저장</button><button type="button" data-memo-cancel>취소</button></span></form>`;
    li.querySelector("textarea").focus();
    return;
  }
  if (e.target.closest("[data-memo-cancel]")) return renderAccountTools();
  if (li && e.target.closest("[data-memo-del]")) {
    if (!confirm("이 메모를 지울까요? 지우면 되돌릴 수 없어요.")) return;
    try {
      await account.deleteMemo(li.dataset.memoId);
      watchLoaded = false;
      renderAccountTools();
    } catch (err) {
      alert(`지우지 못했어요: ${err.message}`);
    }
    return;
  }
  const wb = e.target.closest("#watch-btn");
  if (wb) {
    if (!account.currentUser()) return openLogin();
    const on = wb.getAttribute("aria-pressed") === "true";
    wb.disabled = true;
    try {
      if (on) await account.removeWatch(wb.dataset.code);
      else await account.addWatch(wb.dataset.code, wb.dataset.name);
      wb.textContent = on ? "☆ 관심" : "★ 관심";
      wb.setAttribute("aria-pressed", String(!on));
      watchLoaded = false;
    } catch (err) {
      alert(`저장하지 못했어요: ${err.message}`);
    } finally {
      wb.disabled = false;
    }
  }
});

// 관심 종목 탭
let watchLoaded = false;

// 내 키움 계좌 (계좌 주인 계정에서만 보임, 조회 전용)
async function loadBroker() {
  const box = $("#broker");
  if (!account.currentUser() || !account.hasBroker()) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = `<div class="skeleton" style="height:120px"></div>`;
  let r;
  try {
    r = await account.getBrokerBalance();
  } catch (e) {
    r = { ok: false, status: 0, error: e.message };
  }
  if (!r.ok && r.status === 403) {
    box.hidden = true; // 계좌 주인이 아닌 가족 계정
    return;
  }
  if (!r.ok) {
    box.innerHTML = `<div class="broker-head"><h2>내 키움 계좌</h2></div><div class="state">계좌를 불러오지 못했어요.<br><small>${esc(r.error)}</small><br><button type="button" data-broker-retry>다시 시도</button></div>`;
    return;
  }
  renderBroker(r.data);
}

function renderBroker(b) {
  const sm = b.summary;
  const signWon = (v) => (v == null ? "-" : `${v > 0 ? "+" : ""}${won(v)}원`);
  const tag = b.fake ? `<span class="tbadge turn">시험용 가짜 잔고</span>` : b.mock ? `<span class="tbadge turn">모의투자</span>` : "";
  const rows = b.holdings
    .map(
      (h) => `<tr>
        <td class="nm-cell"><button type="button" class="story-link" data-code="${esc(h.code)}">${esc(h.name)}</button></td>
        <td class="num">${won(h.qty)}주</td>
        <td class="num">${won(h.avgPrice)}</td>
        <td class="num">${won(h.price)}</td>
        <td class="num">${won(h.evaluation)}</td>
        <td class="num ${dir(h.profit)}">${signWon(h.profit)}</td>
        <td class="num ${dir(h.profitRate)}">${pct(h.profitRate)}</td>
      </tr>`
    )
    .join("");
  $("#broker").innerHTML = `
    <div class="broker-head"><h2>내 키움 계좌 ${tag}</h2><span class="sub">조회 전용 · ${timeLabel(new Date(b.updatedAt))} 기준 · 본인 계정에서만 보여요</span></div>
    <div class="stats broker-stats">
      ${statBox("추정예탁자산", `${won(sm.estimatedAsset)}원`)}
      ${statBox("총평가금액", `${won(sm.evaluation)}원`)}
      ${statBox("총매입금액", `${won(sm.purchase)}원`)}
      ${statBox("총평가손익", signWon(sm.profit), dir(sm.profit))}
      ${statBox("총수익률", pct(sm.profitRate), dir(sm.profitRate))}
      ${statBox("보유 종목", `${b.holdings.length}개`)}
    </div>
    ${
      b.holdings.length
        ? `<div class="table-wrap"><table class="flow-table broker-table"><thead><tr><th>종목</th><th>보유</th><th>매입가</th><th>현재가</th><th>평가금액</th><th>평가손익</th><th>수익률</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="sub">보유 종목이 없어요.</p>`
    }`;
}

$("#broker").addEventListener("click", (e) => {
  if (e.target.closest("[data-broker-retry]")) return loadBroker();
  const c = e.target.closest("[data-code]");
  if (c) openDetail(c.dataset.code);
});

async function loadWatch() {
  if (watchLoaded) return;
  const box = $("#watch");
  if (!account.currentUser()) {
    box.innerHTML = `<div class="state">로그인하면 관심 종목을 저장하고 여기서 한 번에 볼 수 있어요.<br><button type="button" data-login-open>로그인</button></div>`;
    return;
  }
  box.innerHTML = Array.from({ length: 3 }, () => `<div class="skeleton" style="height:190px"></div>`).join("");
  try {
    const [list, memos] = await Promise.all([account.listWatch(), account.memoSummary()]);
    if (!list.length) {
      box.innerHTML = `<div class="state">아직 관심 종목이 없어요.<br><small>종목 상세 화면 위쪽의 ☆ 관심 버튼을 누르면 여기에 모여요.</small></div>`;
      watchLoaded = true;
      return;
    }
    const data = await getJson(`/api/watch?codes=${list.map((w) => w.code).join(",")}`);
    const byCode = new Map(data.items.map((p) => [p.code, p]));
    box.innerHTML = list
      .map((w) => {
        const p = byCode.get(w.code);
        const memo = memos[w.code];
        if (!p) return `<button class="card" data-code="${esc(w.code)}"><div class="card-name">${esc(w.name || w.code)}</div><div class="card-meta">${esc(w.code)} · 시세를 불러오지 못했어요</div></button>`;
        const note = memo
          ? `<p class="card-memo">📝 ${esc(memo.latest.body.slice(0, 60))}${memo.latest.body.length > 60 ? "…" : ""}</p></button>`
          : "</button>";
        return cardHtml(p, { extra: memo ? ` · 메모 ${memo.count}개` : "" }).replace(/<\/button>$/, note);
      })
      .join("");
    $("#watch-sub").textContent = `${list.length}개 종목 · 최근 추가한 순서 · 로그인한 본인만 볼 수 있어요 · 시세 ${timeLabel(new Date(data.updatedAt))}`;
    watchLoaded = true;
  } catch (e) {
    box.innerHTML = `<div class="state">불러오지 못했어요.<br><small>${esc(e.message)}</small><br><button type="button" data-watch-retry>다시 시도</button></div>`;
  }
}

$("#view-watch").addEventListener("click", (e) => {
  if (e.target.closest("[data-login-open]")) return openLogin();
  if (e.target.closest("[data-watch-retry]")) return loadWatch();
});

// 이 브라우저에 로그인 기록이 있으면 연결 (없으면 Supabase 라이브러리를 아예 불러오지 않음)
account
  .restore()
  .catch(() => null)
  .finally(() => {
    renderAccountBtn();
    if (!$("#view-watch").hidden) loadWatch();
  });

load();
showView(location.hash.slice(1) || "krlive");

// 홈 화면 앱(PWA): 설치와 오프라인 안내용 서비스 워커 (실패해도 사이트는 그대로 동작)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

