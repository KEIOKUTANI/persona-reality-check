// Minimal static + JSON server. No dependencies.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

export function serve({ dir, routes, port = Number(process.env.PORT || 3000), name }) {
  const pub = path.join(dir, "public");
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const handler = routes[`${req.method} ${url.pathname}`];
    if (handler) {
      let body = {};
      if (req.method === "POST") {
        let raw = "";
        for await (const c of req) { raw += c; if (raw.length > 1e5) break; }
        try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      }
      try {
        const out = await handler(body, url);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(out));
      } catch (err) {
        console.error(err);
        res.writeHead(err.status || 500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const full = path.join(pub, path.normalize(rel));
    if (!full.startsWith(pub) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    fs.createReadStream(full).pipe(res);
  });
  server.listen(port, () => console.log(`${name} on http://localhost:${port}`));
  return server;
}
