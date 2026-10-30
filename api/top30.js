// GET /api/top30 - 한국 시장 전체 종목 점수 상위 30
// 매일 장 마감 후 GitHub Actions(scripts/scan-market.js)가 계산해서 data 브랜치에 올린 결과를 읽습니다.
// 내 컴퓨터에서는 data/top30.json 파일이 있으면 그걸 먼저 씁니다.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, sendJson, sendError } from "./_lib/http.js";

const DATA_URL = "https://raw.githubusercontent.com/umgichukg-cmyk/kim-stock/data/top30.json";
const LOCAL = join(fileURLToPath(new URL("..", import.meta.url)), "data", "top30.json");

export default async function handler(req, res) {
  try {
    const local = await readFile(LOCAL, "utf8").then(JSON.parse).catch(() => null);
    const data = local ?? (await fetchJson(`${DATA_URL}?t=${Math.floor(Date.now() / 300000)}`));
    sendJson(res, 200, { ...data, source: local ? "local" : "github" }, 300);
  } catch (e) {
    if (/HTTP 404/.test(e.message)) {
      return sendJson(res, 404, { error: "아직 계산된 결과가 없어요. 장 마감 후 저녁 7시쯤 첫 결과가 생겨요." });
    }
    sendError(res, e);
  }
}
