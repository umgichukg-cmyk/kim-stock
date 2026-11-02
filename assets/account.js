// 로그인, 관심 종목, 종목 메모 (Supabase)
// 공개용 키라서 화면 코드에 넣어도 괜찮아요. 누가 무엇을 볼 수 있는지는 데이터베이스 보안 규칙(RLS)이 정합니다.
// Supabase 라이브러리는 로그인 기록이 있거나 로그인 창을 열 때만 불러와서, 첫 화면 속도에는 영향이 없어요.
const SUPABASE_URL = "https://kxljcwporlfzmtfgyqmr.supabase.co";
const SUPABASE_KEY = "sb_publishable_pP-EhRkiQbLPned3NVRP9Q_Rpjut7ND";
const LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";
const TOKEN_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

let client = null;
let user = null;
const listeners = new Set();

// 이 브라우저에 로그인 기록이 남아 있는지 (라이브러리를 불러오지 않고 확인)
export function hasSavedLogin() {
  try {
    return !!localStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

async function getClient() {
  if (client) return client;
  const { createClient } = await import(LIB);
  client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data } = await client.auth.getSession();
  user = data.session?.user ?? null;
  client.auth.onAuthStateChange((_event, session) => {
    const changed = (session?.user?.id ?? null) !== (user?.id ?? null);
    user = session?.user ?? null;
    if (changed) listeners.forEach((fn) => fn(user));
  });
  return client;
}

// 로그인 기록이 있으면 연결해서 사용자 정보를 돌려줌, 없으면 null
export async function restore() {
  if (!hasSavedLogin()) return null;
  await getClient();
  return user;
}

export const currentUser = () => user;
export const onUserChange = (fn) => listeners.add(fn);

export async function signIn(email, password) {
  const sb = await getClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === "Invalid login credentials" ? "이메일이나 비밀번호가 맞지 않아요." : error.message);
  return user;
}

export async function signOut() {
  const sb = await getClient();
  await sb.auth.signOut();
}

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// ---------- 키움 계좌 (중계 서버) ----------
// 고정 IP 서버에서 돌아가는 kiwoom-relay 주소. 비어 있으면 계좌 칸을 아예 보여주지 않아요.
// 계좌 주인 확인은 중계 서버가 로그인 토큰으로 직접 하므로, 주소가 알려져도 다른 사람은 볼 수 없어요.
const KIWOOM_RELAY_URL = "";
const relayUrl = () => {
  try {
    return localStorage.getItem("kimga-relay-url") || KIWOOM_RELAY_URL; // 시험용으로 주소를 바꿀 때만
  } catch {
    return KIWOOM_RELAY_URL;
  }
};
export const hasBroker = () => !!relayUrl();

// 결과: { ok: true, data } / { ok: false, status, error } - 403은 "계좌 주인이 아님"
export async function getBrokerBalance() {
  const sb = await getClient();
  const { data } = await sb.auth.getSession();
  const res = await fetch(`${relayUrl()}/balance`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
  const body = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, data: body } : { ok: false, status: res.status, error: body.error || `HTTP ${res.status}` };
}

// ---------- 관심 종목 ----------

export async function listWatch() {
  const sb = await getClient();
  return check(await sb.from("watchlist").select("code, name, created_at").order("created_at", { ascending: false }));
}

export async function isWatched(code) {
  const sb = await getClient();
  const rows = check(await sb.from("watchlist").select("code").eq("code", code));
  return rows.length > 0;
}

export async function addWatch(code, name) {
  const sb = await getClient();
  check(await sb.from("watchlist").upsert({ code, name }, { onConflict: "user_id,code" }));
}

export async function removeWatch(code) {
  const sb = await getClient();
  check(await sb.from("watchlist").delete().eq("code", code));
}

// ---------- 종목 메모 ----------

export async function listMemos(code) {
  const sb = await getClient();
  return check(await sb.from("memos").select("id, body, created_at, updated_at").eq("code", code).order("created_at", { ascending: false }));
}

// 관심 종목 탭에 보여줄 종목별 메모 수와 최근 메모
export async function memoSummary() {
  const sb = await getClient();
  const rows = check(await sb.from("memos").select("code, body, created_at").order("created_at", { ascending: false }).limit(500));
  const byCode = {};
  for (const r of rows) {
    byCode[r.code] ??= { count: 0, latest: r };
    byCode[r.code].count++;
  }
  return byCode;
}

export async function addMemo(code, name, body) {
  const sb = await getClient();
  check(await sb.from("memos").insert({ code, name, body }));
}

export async function updateMemo(id, body) {
  const sb = await getClient();
  check(await sb.from("memos").update({ body }).eq("id", id));
}

export async function deleteMemo(id) {
  const sb = await getClient();
  check(await sb.from("memos").delete().eq("id", id));
}
