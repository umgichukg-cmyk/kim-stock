// 외부 데이터 요청과 응답 공통 처리
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// JSON 요청: 타임아웃 + 1회 재시도
export async function fetchJson(url, { headers = {}, timeout = 8000, retries = 1 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json", ...headers },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

// "+1,234,567" / "46.15%" / "189.40배" / "283원" 같은 문자열을 숫자로 ("N/A"는 null)
export function toNumber(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[^0-9.\-]/g, "");
  if (!/\d/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function sendJson(res, status, body, cacheSeconds = 0) {
  if (cacheSeconds > 0) {
    res.setHeader("Cache-Control", `s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`);
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
  res.status(status).json(body);
}

export function sendError(res, e, extra = {}) {
  console.error(e);
  sendJson(res, 502, { error: e?.message || String(e), ...extra });
}

// 6자리 종목코드 검증
export function cleanCode(code) {
  const c = String(code ?? "").trim();
  return /^\d{6}$/.test(c) ? c : null;
}
