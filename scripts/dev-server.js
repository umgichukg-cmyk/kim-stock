// 로컬 실행용 서버: npm run dev → http://localhost:3000
// Vercel 없이 정적 파일과 /api/* 함수를 그대로 돌립니다.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

// Vercel의 req.query / res.status().json() 흉내
function wrapResponse(res) {
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (body) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      // Vercel처럼 api/[route].js 하나가 모든 /api/* 요청을 받음
      const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, "");
      const mod = await import(pathToFileURL(join(ROOT, "api", "[route].js")).href);
      req.query = { ...Object.fromEntries(url.searchParams), route: name };
      const started = Date.now();
      await mod.default(req, wrapResponse(res));
      console.log(`${res.statusCode} ${url.pathname}${url.search} ${Date.now() - started}ms`);
      return;
    }
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(normalize(ROOT)) || file.includes(`${normalize("/api/")}`)) throw { code: "ENOENT" };
    const body = await readFile(file);
    // 고친 파일이 바로 보이도록 브라우저 캐시를 쓰지 않음
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
  } catch (e) {
    const notFound = e?.code === "ENOENT" || e?.code === "ERR_MODULE_NOT_FOUND";
    if (!notFound) console.error(e);
    res.writeHead(notFound ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(notFound ? "Not found" : String(e));
  }
});

server.listen(PORT, () => console.log(`김가네 주식 로컬 서버: http://localhost:${PORT}`));
