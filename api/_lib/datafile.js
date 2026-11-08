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

// 한 종목의 기록 [[날짜, 점수], ...] (점수가 없는 날은 뺌)
export function scoreHistoryOf(h, code) {
  const arr = h?.scores?.[code];
  return arr ? h.dates.map((d, i) => [d, arr[i]]).filter(([, v]) => v != null) : [];
}
