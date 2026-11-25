// GrindGuard local server. Zero dependencies. Serves the static frontend
// and POST /api/verify. The same verification code runs on Vercel via
// api/verify.js.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeInput, runVerification } from "./lib/verify.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const rateLimit = new Map();
function clientIp(req) {
  const remote = req.socket.remoteAddress || "unknown";
  if (process.env.TRUSTED_PROXY) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  }
  return remote.replace(/^::ffff:/, "");
}
function tooManyRequests(ip) {
  const now = Date.now();
  const hits = (rateLimit.get(ip) || []).filter((t) => now - t < 60000);
  if (hits.length === 0) rateLimit.delete(ip);
  else rateLimit.set(ip, hits);
  if (rateLimit.size > 500) {
    for (const [key, times] of rateLimit) {
      if (times.every((t) => now - t >= 60000)) rateLimit.delete(key);
      if (rateLimit.size <= 500) break;
    }
  }
  hits.push(now);
  rateLimit.set(ip, hits);
  return hits.length > 10;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 65536) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, time: new Date().toISOString() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/verify") {
      const ip = clientIp(req);
      if (tooManyRequests(ip)) {
        sendJson(res, 429, { error: "Rate limit: at most 10 verifications per minute." });
        return;
      }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: "Request body must be valid JSON." });
        return;
      }
      let input;
      try {
        input = normalizeInput(body);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      const report = await runVerification(input);
      sendJson(res, 200, report);
      return;
    }
    if (req.method === "GET") {
      const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
      const file = normalize(join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      try {
        const data = await readFile(file);
        res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
        res.end(data);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
      }
      return;
    }
    res.writeHead(405);
    res.end("Method not allowed");
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: "Internal server error." });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`GrindGuard listening on http://127.0.0.1:${PORT}`);
});
