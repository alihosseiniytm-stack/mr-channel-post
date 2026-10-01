// Vercel (Node runtime): all paths are rewritten here by vercel.json.
import { handle } from "../handler.mjs";
export default async function (req, res) {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = new Request("https://" + req.headers.host + req.url, { method: req.method, headers: req.headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks) });
  const out = await handle(r, process.env);
  res.statusCode = out.status; out.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await out.arrayBuffer()));
}
