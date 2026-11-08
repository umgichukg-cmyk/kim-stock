// GET /api/watch?codes=005930,000660 - 관심 종목들의 지금 시세와 점수 (카드 표시용, 최대 40개)
// &history=1 이면 저녁 자동 계산이 날마다 남긴 종합 점수 기록도 함께 [[날짜, 점수], ...]
// 어떤 종목이 관심 종목인지는 화면이 Supabase에서 읽어 와서 넘겨줍니다. 여기서는 개인 정보를 다루지 않아요.
import { analyzeStock } from "../_lib/analyze.js";
import { readDataFile } from "../_lib/datafile.js";
import { sendJson, sendError, cleanCode } from "../_lib/http.js";

const MAX = 40;

// 점수 기록 파일은 하루 한 번 바뀌고 크기가 커서 5분 동안 메모리에 둠
let historyCache = { at: 0, data: null };
async function scoreHistory() {
  if (Date.now() - historyCache.at > 300_000) {
    historyCache = { at: Date.now(), data: await readDataFile("score-history.json").catch(() => null) };
  }
  return historyCache.data;
}

function historyOf(h, code) {
  const arr = h?.scores?.[code];
  return arr ? h.dates.map((d, i) => [d, arr[i]]).filter(([, v]) => v != null) : [];
}

export default async function handler(req, res) {
  const codes = [...new Set(String(req.query.codes || "").split(",").map(cleanCode).filter(Boolean))].slice(0, MAX);
  if (!codes.length) return sendJson(res, 400, { error: "종목코드가 필요합니다 (예: codes=005930,000660)" });
  try {
    const [results, h] = await Promise.all([
      Promise.allSettled(codes.map((c) => analyzeStock(c))),
      req.query.history ? scoreHistory() : null,
    ]);
    const items = [];
    const failed = [];
    results.forEach((r, i) => (r.status === "fulfilled" ? items.push(r.value) : failed.push(codes[i])));
    if (h) for (const p of items) p.history = historyOf(h, p.code);
    sendJson(res, 200, { updatedAt: new Date().toISOString(), items, failed }, 60);
  } catch (e) {
    sendError(res, e);
  }
}
