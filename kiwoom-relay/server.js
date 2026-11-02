// 김가네 주식 - 키움 REST API 중계 서버 (1단계: 계좌 잔고 조회만, 주문 기능 없음)
//
// 왜 필요한가: 키움 API는 키움에 등록한 고정 IP에서만 호출할 수 있어요.
// Vercel은 IP가 바뀌어서, 고정 IP가 있는 작은 서버에서 이 프로그램을 돌리고 앱은 여기에 물어봐요.
//
// 지키는 것
// - 키움 앱키·시크릿키는 이 서버의 환경변수에만 둡니다. 화면 코드나 기록(log)에 남기지 않아요.
// - 김가네 주식 앱의 로그인(Supabase) 토큰을 확인해서, OWNER_EMAIL 계정만 잔고를 볼 수 있어요.
// - 조회(kt00018)만 합니다. 주문 API는 이 파일에 없어요.
//
// 실행: node server.js (Node 18 이상, 설치할 라이브러리 없음). 설정은 README.md 참고.
import http from "node:http";
import { createHash } from "node:crypto";

const env = (k, d = "") => (process.env[k] ?? d).trim();
const CONFIG = {
  port: Number(env("PORT", "8080")),
  host: env("HOST", "127.0.0.1"), // 앞에 둔 Caddy(HTTPS)만 접속하게 기본은 내부 주소
  appkey: env("KIWOOM_APPKEY"),
  secretkey: env("KIWOOM_SECRETKEY"),
  mock: env("KIWOOM_MOCK", "false") === "true", // 모의투자 키면 true
  fake: env("KIWOOM_FAKE", "false") === "true", // 화면 시험용 가짜 잔고 (키움에 접속하지 않음)
  supabaseUrl: env("SUPABASE_URL"),
  supabaseKey: env("SUPABASE_KEY"), // 공개용(publishable) 키
  ownerEmail: env("OWNER_EMAIL").toLowerCase(),
  origins: env("ALLOWED_ORIGINS", "https://kim-stock-kimga.vercel.app,https://kim-stock-liart.vercel.app").split(",").map((s) => s.trim()).filter(Boolean),
};
const KIWOOM = CONFIG.mock ? "https://mockapi.kiwoom.com" : "https://api.kiwoom.com";

function checkConfig() {
  if (CONFIG.fake) return;
  const missing = ["appkey", "secretkey", "supabaseUrl", "supabaseKey", "ownerEmail"].filter((k) => !CONFIG[k]);
  if (missing.length) {
    console.error(`설정이 빠졌어요: ${missing.join(", ")} (README.md의 환경변수 참고)`);
    process.exit(1);
  }
}

// ---------- 키움 ----------

// 키움 숫자는 "000000017598258", "-00000000196888" 같은 문자열 → 숫자
const n = (s) => {
  if (s == null || s === "") return null;
  const v = Number(String(s).replace(/[^\d.-]/g, ""));
  return Number.isFinite(v) ? v : null;
};

let token = null; // { value, expiresAt }

// expires_dt "20241107083713" (한국 시각) → ms
function kstToMs(s) {
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6]) : Date.now() + 3600_000;
}

async function getToken(force = false) {
  if (!force && token && token.expiresAt - Date.now() > 5 * 60_000) return token.value;
  const res = await fetch(`${KIWOOM}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: CONFIG.appkey, secretkey: CONFIG.secretkey }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.return_code !== 0 || !j.token) throw new Error(`키움 토큰 발급 실패: ${j.return_msg || `HTTP ${res.status}`}`);
  token = { value: j.token, expiresAt: kstToMs(j.expires_dt) };
  return token.value;
}

// 키움 TR 호출 (연속 조회는 최대 maxPages까지)
async function kiwoom(apiId, path, body, { maxPages = 10 } = {}) {
  const pages = [];
  let contYn = "N";
  let nextKey = "";
  let retried = false;
  for (let page = 0; page < maxPages; page++) {
    const res = await fetch(`${KIWOOM}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "api-id": apiId,
        authorization: `Bearer ${await getToken()}`,
        "cont-yn": contYn,
        "next-key": nextKey,
      },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    // 토큰이 만료됐으면(8005) 한 번만 새로 받아서 다시 시도
    if (!retried && (j.return_code === 3 || /8005/.test(j.return_msg || ""))) {
      retried = true;
      await getToken(true);
      page--;
      continue;
    }
    if (!res.ok || j.return_code !== 0) throw new Error(`키움 조회 실패(${apiId}): ${j.return_msg || `HTTP ${res.status}`}`);
    pages.push(j);
    contYn = res.headers.get("cont-yn") || "N";
    nextKey = res.headers.get("next-key") || "";
    if (contYn !== "Y" || !nextKey) break;
    await new Promise((r) => setTimeout(r, 250)); // 키움 호출 횟수 제한 배려
  }
  return pages;
}

// 계좌평가잔고내역요청 (kt00018) → 화면용으로 정리
function shapeBalance(pages) {
  const first = pages[0] || {};
  const rows = pages.flatMap((p) => p.acnt_evlt_remn_indv_tot || []);
  return {
    summary: {
      purchase: n(first.tot_pur_amt), // 총매입금액
      evaluation: n(first.tot_evlt_amt), // 총평가금액
      profit: n(first.tot_evlt_pl), // 총평가손익
      profitRate: n(first.tot_prft_rt), // 총수익률(%)
      estimatedAsset: n(first.prsm_dpst_aset_amt), // 추정예탁자산
    },
    holdings: rows.map((r) => ({
      code: String(r.stk_cd || "").replace(/^A/, ""),
      name: r.stk_nm,
      qty: n(r.rmnd_qty), // 보유수량
      sellable: n(r.trde_able_qty), // 매매가능수량
      avgPrice: n(r.pur_pric), // 매입가
      price: Math.abs(n(r.cur_prc) ?? 0), // 현재가 (부호는 등락 표시라 뺌)
      prevClose: Math.abs(n(r.pred_close_pric) ?? 0),
      purchase: n(r.pur_amt), // 매입금액
      evaluation: n(r.evlt_amt), // 평가금액
      profit: n(r.evltv_prft), // 평가손익
      profitRate: n(r.prft_rt), // 수익률(%)
      weight: n(r.poss_rt), // 보유비중(%)
    })),
  };
}

// 키움 공식 문서의 예시 응답 (KIWOOM_FAKE=true 일 때 화면 시험용)
const FAKE = [
  {
    tot_pur_amt: "000000017598258", tot_evlt_amt: "000000025789890", tot_evlt_pl: "000000008138825", tot_prft_rt: "46.25", prsm_dpst_aset_amt: "000001012632507",
    acnt_evlt_remn_indv_tot: [
      { stk_cd: "A005930", stk_nm: "삼성전자", evltv_prft: "000000000196888", prft_rt: "12.71", pur_pric: "000000000204500", pred_close_pric: "000000220500", rmnd_qty: "000000000000010", trde_able_qty: "000000000000010", cur_prc: "000000229000", pur_amt: "000000002045000", evlt_amt: "000000002290000", poss_rt: "8.88" },
      { stk_cd: "A000660", stk_nm: "SK하이닉스", evltv_prft: "-00000000095004", prft_rt: "-3.46", pur_pric: "000000001370000", pred_close_pric: "000001420000", rmnd_qty: "000000000000002", trde_able_qty: "000000000000002", cur_prc: "000001322500", pur_amt: "000000002740000", evlt_amt: "000000002645000", poss_rt: "10.26" },
    ],
    return_code: 0,
  },
];

async function getBalance() {
  const pages = CONFIG.fake ? FAKE : await kiwoom("kt00018", "/api/dostk/acnt", { qry_tp: "1", dmst_stex_tp: "KRX" });
  return { mock: CONFIG.mock, fake: CONFIG.fake, updatedAt: new Date().toISOString(), ...shapeBalance(pages) };
}

// ---------- 앱 로그인 확인 ----------

const verified = new Map(); // 토큰 해시 → { email, until }

async function checkOwner(req) {
  if (CONFIG.fake) return true; // 가짜 잔고는 누구에게 보여도 괜찮음
  const m = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const key = createHash("sha256").update(m[1]).digest("hex");
  const hit = verified.get(key);
  if (hit && hit.until > Date.now()) return hit.email === CONFIG.ownerEmail;
  // Supabase에 이 로그인 토큰의 주인을 물어봄
  const res = await fetch(`${CONFIG.supabaseUrl}/auth/v1/user`, { headers: { apikey: CONFIG.supabaseKey, Authorization: `Bearer ${m[1]}` } });
  if (!res.ok) return false;
  const user = await res.json().catch(() => null);
  const email = String(user?.email || "").toLowerCase();
  verified.set(key, { email, until: Date.now() + 60_000 });
  if (verified.size > 100) verified.delete(verified.keys().next().value);
  return email === CONFIG.ownerEmail;
}

// ---------- HTTP ----------

const hits = []; // 1분에 30번까지
function tooMany() {
  const now = Date.now();
  while (hits.length && now - hits[0] > 60_000) hits.shift();
  hits.push(now);
  return hits.length > 30;
}

function send(res, origin, status, body) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Vary: "Origin" };
  if (CONFIG.origins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Authorization";
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
  }
  res.writeHead(status, headers);
  res.end(status === 204 ? "" : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  const path = new URL(req.url, "http://x").pathname;
  try {
    if (req.method === "OPTIONS") return send(res, origin, 204);
    if (req.method !== "GET") return send(res, origin, 405, { error: "조회만 할 수 있어요" });
    if (path === "/health") return send(res, origin, 200, { ok: true, mock: CONFIG.mock, fake: CONFIG.fake });
    if (path === "/balance") {
      if (tooMany()) return send(res, origin, 429, { error: "잠시 뒤에 다시 시도해 주세요" });
      if (!(await checkOwner(req))) return send(res, origin, 403, { error: "계좌를 볼 수 있는 계정이 아니에요" });
      return send(res, origin, 200, await getBalance());
    }
    send(res, origin, 404, { error: "없는 주소예요" });
  } catch (e) {
    console.error(new Date().toISOString(), path, e.message);
    send(res, origin, 502, { error: e.message });
  }
});

checkConfig();
server.listen(CONFIG.port, CONFIG.host, () =>
  console.log(`키움 중계 서버: http://${CONFIG.host}:${CONFIG.port} (${CONFIG.fake ? "가짜 잔고" : CONFIG.mock ? "모의투자" : "실전"} · 허용 사이트 ${CONFIG.origins.join(", ")})`)
);
