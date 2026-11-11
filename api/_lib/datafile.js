// 매일 장 마감 후 GitHub Actions(scripts/scan-market.js)가 data 브랜치에 올린 결과 파일 읽기
// 내 컴퓨터에서는 data/ 폴더에 같은 이름의 파일이 있으면 그걸 먼저 씁니다.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson } from "./http.js";

const DATA_URL = "https://raw.githubusercontent.com/umgichukg-cmyk/kim-stock/data";
const LOCAL_DIR = join(fileURLToPath(new URL("../..", import.meta.url)), "data");

export class DataNotReady extends Error {}

export async function readDataFile(name) {
  const local = await readFile(join(LOCAL_DIR, name), "utf8").then(JSON.parse).catch(() => null);
  if (local) return { ...local, source: "local" };
  try {
    // 5분 단위로 주소를 바꿔 GitHub 캐시를 피함
    const data = await fetchJson(`${DATA_URL}/${name}?t=${Math.floor(Date.now() / 300000)}`);
    return { ...data, source: "github" };
  } catch (e) {
    if (/HTTP 404/.test(e.message)) throw new DataNotReady("아직 계산된 결과가 없어요. 장 마감 후 저녁 7시쯤 첫 결과가 생겨요.");
    throw e;
  }
}

// 전 종목 날짜별 종합 점수 기록 (scan-market.js가 만듦). 하루 한 번 바뀌고 크기가 커서 5분 동안 메모리에 둠
let scoreHistoryCache = { at: 0, data: null };
export async function readScoreHistory() {
  if (Date.now() - scoreHistoryCache.at > 300_000) {
    scoreHistoryCache = { at: Date.now(), data: await readDataFile("score-history.json").catch(() => null) };
  }
  return scoreHistoryCache.data;
}

// 같은 날짜의 세부 점수 [기술, 수급, 기본] 기록 (11/12부터). 상세 화면에서만 써서 따로 둠
let scorePartsCache = { at: 0, data: null };
export async function readScoreParts() {
  if (Date.now() - scorePartsCache.at > 300_000) {
    scorePartsCache = { at: Date.now(), data: await readDataFile("score-parts.json").catch(() => null) };
  }
  return scorePartsCache.data;
}

// 한 종목의 기록 [[날짜, 점수], ...] (점수가 없는 날은 뺌)
// parts를 주면 [[날짜, 점수, 기술, 수급, 기본], ...] (세부 점수가 없는 날은 null)
export function scoreHistoryOf(h, code, parts = null) {
  const arr = h?.scores?.[code];
  if (!arr) return [];
  const p = parts?.parts?.[code];
  const at = p ? new Map(parts.dates.map((d, i) => [d, p[i]])) : null;
  return h.dates
    .map((d, i) => (at ? [d, arr[i], ...(at.get(d) ?? [null, null, null])] : [d, arr[i]]))
    .filter(([, v]) => v != null);
}
