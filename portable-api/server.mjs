// Node 18+ server for the portable API: `node server.mjs` (PORT env, default 8788). Works on any VPS, Fly.io, Render, Koyeb, Railway, etc.
import http from "node:http";
import { handle } from "./handler.mjs";
const port = Number(process.env.PORT) || 8788;
http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const proto = req.headers["x-forwarded-proto"] || "http";
    const r = new Request(proto + "://" + (req.headers.host || "localhost") + req.url, { method: req.method, headers: req.headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body });
    const out = await handle(r, process.env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch (e) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "failed" })); }
}).listen(port, () => console.log("portable api on :" + port));
