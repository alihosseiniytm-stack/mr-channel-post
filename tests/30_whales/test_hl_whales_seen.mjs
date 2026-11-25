// T30-40 (2026-11-25) PLANT TEST for collectors/hl-whales.mjs (6-hourly full scan): runs the REAL script against local stubs
// (wh-api /sql, Hyperliquid /info, leaderboard) and checks the seen rule:
//  1) a feed-size change (positionValue >= $100k) gets seen = now;
//  2) a small / market-maker change keeps its OLD seen; a new small row gets seen = 0 (never pushes whales out of the feed window);
//  3) szi/entry are still written for every real change (warehouse stays complete); unchanged rows are not written;
//  4) summary has changed + feed_changed counts.
// Run: node tests/30_whales/test_hl_whales_seen.mjs   (exit 1 = RED)
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, "../../collectors/hl-whales.mjs");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS " + m); } else { fail++; console.log("FAIL " + m); } };
const OLD = 1_700_000_000_000;
const W = "0x" + "a".repeat(40), M = "0x" + "b".repeat(40);

const writes = [];
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url === "/sql") {
      const results = JSON.parse(b).queries.map(({ query, params }) => {
        if (query.startsWith("SELECT COALESCE(MAX(updated)")) return { rows: [[String(Date.now())]] }; // wallet table fresh -> skip
        if (query.startsWith("SELECT wallet, coin, szi, entry, seen FROM hl_positions")) return { rows: [[W, "BTC", "1", "90000", String(OLD)], [M, "DOGE", "100", "0.1", String(OLD)], [M, "ETH", "2", "3000", String(OLD)]] };
        if (query.startsWith("INSERT INTO hl_positions")) writes.push(params);
        return { rows: [] };
      });
      return send({ results });
    }
    if (req.url === "/lb") {
      const rows = [{ ethAddress: W, accountValue: "5000000" }, { ethAddress: M, accountValue: "900000" }];
      for (let i = 0; i < 1000; i++) rows.push({ ethAddress: "0x" + i.toString(16).padStart(40, "0"), accountValue: "10" });
      return send({ leaderboardRows: rows });
    }
    if (req.url === "/info") {
      const u = JSON.parse(b).user;
      if (u === W) return send({ assetPositions: [{ position: { coin: "BTC", szi: "2", entryPx: "91000", positionValue: "182000", leverage: { type: "cross", value: 5 } } }] });
      if (u === M) return send({ assetPositions: [
        { position: { coin: "DOGE", szi: "120", entryPx: "0.11", positionValue: "13", leverage: { type: "cross", value: 3 } } }, // small change
        { position: { coin: "ETH", szi: "2", entryPx: "3000", positionValue: "6000", leverage: { type: "cross", value: 3 } } },  // unchanged
        { position: { coin: "SOL", szi: "5", entryPx: "150", positionValue: "750", leverage: { type: "isolated", value: 2 } } }, // new small
      ] });
      return send({ assetPositions: [] });
    }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + srv.address().port;
const t0 = Date.now();
const out = await new Promise((resolve) => {
  const p = spawn(process.execPath, [SCRIPT], { env: { ...process.env, WH_URL: base, WH_TOKEN: "x", NEON_URL: "", TURSO_URL: "", HL_INFO_URL: base + "/info", HL_LB_URL: base + "/lb", MIN_ACCT: "100000", RPS: "200" } });
  let o = ""; p.stdout.on("data", (c) => (o += c)); p.stderr.on("data", (c) => (o += c));
  p.on("close", (code) => resolve({ code, o }));
});
srv.close();
const byCoin = Object.fromEntries(writes.map((w) => [w[1], w]));
ok(out.code === 0, "script exit 0 (" + out.code + ") " + (out.code ? out.o.slice(-300) : ""));
ok(byCoin.BTC && Number(byCoin.BTC[7]) >= t0, "feed-size change ($182k BTC) -> seen = now");
ok(byCoin.DOGE && Number(byCoin.DOGE[7]) === OLD && Number(byCoin.DOGE[2]) === 120, "small change (DOGE $13) -> szi written, OLD seen kept");
ok(byCoin.SOL && Number(byCoin.SOL[7]) === 0, "new small row (SOL $750) -> seen 0");
ok(!byCoin.ETH, "unchanged row (ETH) not written");
const sum = JSON.parse((out.o.trim().split("\n").find((l) => l.startsWith('{"at"'))) || "{}");
ok(sum.changed === 3 && sum.feed_changed === 1, "summary changed 3 / feed_changed 1 (" + sum.changed + "/" + sum.feed_changed + ")");
console.log((fail ? "RED" : "GREEN") + " " + pass + "/" + (pass + fail));
process.exit(fail ? 1 : 0);
