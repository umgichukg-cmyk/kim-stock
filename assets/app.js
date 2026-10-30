// 김가네 주식 - 화면
// 데이터는 모두 /api/* 에서 받아오고, 받아오지 못하면 지어내지 않고 오류를 그대로 보여줍니다.

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
        return `<div class="mkt"><div class="mkt-name">${esc(m.name)}</div><div class="mkt-price flat">-</div><div class="mkt-chg flat">불러오지 못함</div></div>`;
      }
      const d = dir(m.changePct);
      return `<div class="mkt">
        <div class="mkt-name">${esc(m.name)}</div>
        <div class="mkt-price num">${num(m.price)}${m.unit ? `<small> ${m.unit}</small>` : ""}</div>
        <div class="mkt-chg num ${d}">${arrow(m.changePct)} ${num(Math.abs(m.change ?? 0))} (${pct(m.changePct)})</div>
        ${sparkline(m.points, { base: m.prevClose })}
      </div>`;
    })
    .join("");
}

// ---------- 테마 ----------

function renderThemes(themes, topThemes, sessionDate) {
  $("#top-count").textContent = topThemes.length ? `상승한 테마 ${topThemes.length}개` : "상승한 테마";
  if (sessionDate) {
    const d = new Date(`${sessionDate}T12:00:00`);
    const week = "일월화수목금토"[d.getDay()];
    $("#session-date").textContent = `${d.getMonth() + 1}/${d.getDate()}(${week})`;
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
    $("#picks").innerHTML = `<div class="state">${msg}<br><small>위쪽 검색창에 종목코드를 넣으면 아무 종목이나 분석할 수 있어요.</small></div>`;
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

// ---------- 전체 상위 30 탭 ----------

let top30Loaded = 0;

async function loadTop30() {
  // 10분 안에 다시 열면 이전 결과 사용
  if (Date.now() - top30Loaded < 600_000) return;
  $("#top30").innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton" style="height:190px"></div>`).join("");
  try {
    const data = await getJson("/api/top30");
    top30Loaded = Date.now();
    const d = data.basisDate;
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

function showView(view) {
  const top = view === "top30";
  $("#view-top30").hidden = !top;
  $("#view-themes").hidden = top;
  $("#tab-top30").setAttribute("aria-selected", top);
  $("#tab-themes").setAttribute("aria-selected", !top);
  if (top) loadTop30();
  if (location.hash !== (top ? "#top30" : "")) history.replaceState(null, "", top ? "#top30" : location.pathname);
}

document.querySelector(".tabs").addEventListener("click", (e) => {
  const tab = e.target.closest("[data-view]");
  if (tab) showView(tab.dataset.view);
});

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

function flowTable(flows) {
  const rows = [...flows]
    .reverse()
    .map(
      (f) => `<tr><td>${f.date.slice(0, 4)}.${dateLabel(f.date)}</td>
        <td class="num">${won(f.close)}</td>
        <td class="num ${dir(f.foreignAmt)}">${eok(f.foreignAmt)}</td>
        <td class="num ${dir(f.institutionAmt)}">${eok(f.institutionAmt)}</td>
        <td class="num ${dir(f.individualAmt)}">${eok(f.individualAmt)}</td>
        <td class="num">${f.foreignHoldRatio == null ? "-" : `${f.foreignHoldRatio.toFixed(2)}%`}</td></tr>`
    )
    .join("");
  return `<div class="table-wrap flow-scroll"><table class="flow-table"><thead><tr><th>날짜</th><th>종가</th><th>외국인</th><th>기관</th><th>개인</th><th>외국인 보유율</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// 선택한 기간의 외국인/기관/개인 누적 순매수
function flowTotals(flows) {
  const sum = (k) => flows.reduce((s, f) => s + f[k], 0);
  const box = (label, color, v) =>
    `<div class="stat total"><span><i style="background:${color}"></i>${label} 누적</span><b class="${dir(v)}">${eok(v)}</b></div>`;
  const first = flows[0]?.foreignHoldRatio;
  const last = flows.at(-1)?.foreignHoldRatio;
  const holdChange = first != null && last != null ? last - first : null;
  return `<div class="totals">
    ${box("외국인", "var(--foreign)", sum("foreignAmt"))}
    ${box("기관", "var(--institution)", sum("institutionAmt"))}
    ${box("개인", "var(--individual)", sum("individualAmt"))}
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
    ${flows.length ? `<div class="section-title" style="margin-top:14px"><span>기간 누적 순매수</span><span class="sub">${range}</span></div>${flowTotals(flows)}` : ""}`;
}

function drawCandles(el, candles, stats) {
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
    timeScale: { borderColor: css("--border") },
    // 휠은 상세 창 스크롤에 쓰고, 차트 이동/확대는 드래그·핀치로
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    localization: { priceFormatter: (p) => Math.round(p).toLocaleString("ko-KR") },
  });
  const time = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const up = css("--up");
  const down = css("--down");
  const series = chart.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
  series.setData(candles.map((c) => ({ time: time(c.date), open: c.open, high: c.high, low: c.low, close: c.close })));

  const ma = (period, color) => {
    const s = chart.addLineSeries({ color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const data = [];
    for (let i = period - 1; i < candles.length; i++) {
      let sum = 0;
      for (let k = i - period + 1; k <= i; k++) sum += candles[k].close;
      data.push({ time: time(candles[i].date), value: sum / period });
    }
    s.setData(data);
  };
  ma(5, "#f2a01d");
  ma(20, css("--institution"));
  ma(60, css("--individual"));

  if (stats.vwap20) {
    series.createPriceLine({ price: stats.vwap20, color: css("--muted"), lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: "VWAP20" });
  }

  const vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
  chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  vol.setData(
    candles.map((c, i) => ({
      time: time(c.date),
      value: c.volume,
      color: `${c.close >= (candles[i - 1]?.close ?? c.open) ? up : down}66`,
    }))
  );
  setRange(90, candles.length);
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
        <div class="card-meta">${esc(s.code)} · ${esc(s.market)}${pick ? ` · <span class="tag">${esc(pick.theme)}</span> 미국 테마 ${pct(pick.themeChange)}` : ""} · ${s.marketStatus === "OPEN" ? "장중" : "장 마감"}</div>
        <div class="detail-price"><span class="num">${won(s.price)}원</span><span class="num ${d}">${arrow(s.changePct)} ${won(Math.abs(s.change ?? 0))} (${pct(s.changePct)})</span></div>
      </div>
      <button class="close-btn" data-close aria-label="닫기">×</button>
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
      <span>일봉 차트</span>
      <div class="chips" id="range-chips">
        <button class="chip" data-range="22" aria-selected="false">1개월</button>
        <button class="chip" data-range="66" aria-selected="false">3개월</button>
        <button class="chip" data-range="90" aria-selected="true">90일</button>
        <button class="chip" data-range="999" aria-selected="false">전체</button>
      </div>
    </div>
    <div class="legend" style="margin-bottom:6px"><span><i style="background:#f2a01d"></i>5일선</span><span><i style="background:var(--institution)"></i>20일선</span><span><i style="background:var(--individual)"></i>60일선</span><span><i style="background:var(--muted)"></i>20일 VWAP</span></div>
    <div class="chart-box" id="candle-chart"></div>

    <div class="section-title"><span>점수 근거 · 종합 ${s.score.total ?? "-"}점</span>${s.score.complete ? "" : `<span class="sub">일부 항목은 데이터가 없어 제외하고 환산했어요</span>`}</div>
    <div class="score-grid">${scoreColumn("기술", s.score.technical)}${scoreColumn("수급", s.score.supply)}${scoreColumn("기본", s.score.basic)}</div>

    ${fundamentalsSection(s.fundamentals, s.price)}

    <div id="flow-section"></div>
    <p class="sub" style="margin-top:10px">순매수 금액 = 순매수 수량 × 그날 종가(추정치). ${timeLabel(new Date(s.updatedAt))} 기준.</p>
  `;

  renderFlows(s.flows, 20);
  $("#flow-section").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-days]");
    if (btn) renderFlows(s.flows, Number(btn.dataset.days));
  });

  const candleEl = $("#candle-chart");
  const total = s.candles.length;
  drawCandles(candleEl, s.candles, st);
  $("#range-chips").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-range]");
    if (!btn) return;
    document.querySelectorAll("#range-chips .chip").forEach((c) => c.setAttribute("aria-selected", c === btn));
    setRange(Number(btn.dataset.range), total);
  });
}

// ---------- 이벤트 ----------

document.addEventListener("click", (e) => {
  const card = e.target.closest(".card[data-code]");
  if (card) return openDetail(card.dataset.code);

  const chip = e.target.closest("#theme-filter [data-theme]");
  if (chip) {
    state.filter = chip.dataset.theme;
    renderFilter();
    renderPicks();
    return;
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

load();
if (location.hash === "#top30") showView("top30");
