// T50-21 (owner D334 2026-11-24): every X post text links ONLY to our own site; fails if any builder puts an outside link (explorer etc.).
import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs";
import { makeText, foreignLinks } from "../x_lib.mjs";
import { xText, whyLine, bigtxLink, xLen } from "../x_bigtx.mjs";

const KINDS = ["exchange_in", "exchange_out", "exchange_move", "treasury", "wallet", "mint", "burn", "dex_swap"];
const tx = (k, coin = "USDT") => ({ id: "t" + k, tx: "0xabc", kind: k, coin, amount: 25e6, usd: 25e6, chain: "eth", net: "Ethereum", fromType: "wallet", toType: k === "dex_swap" ? "dex" : "exchange", url: "https://etherscan.io/tx/0xabc", t: Date.now() });

test("foreignLinks finds outside links and accepts ours", () => {
  assert.deepEqual(foreignLinks("a https://marketradarwhale.com/go/x/bigtx/en/big-transactions/ b"), []);
  assert.deepEqual(foreignLinks("https://www.marketradarwhale.com/"), []);
  assert.equal(foreignLinks("Tx: https://etherscan.io/tx/0x1").length, 1);
  assert.equal(foreignLinks("https://marketradarwhale.com.evil.io/x").length, 1, "look-alike host is outside");
  assert.equal(foreignLinks("http://marketradarwhale.com/").length, 1, "plain http is not our canonical link");
});

test("big transfer texts: no explorer / outside link, exactly one own link, <= 280 chars", () => {
  for (const k of KINDS) for (const c of ["USDT", "ETH"]) {
    const t = xText(tx(k, c));
    assert.deepEqual(foreignLinks(t), [], k + " " + c + ": " + t);
    assert.ok(!/Tx:|etherscan|tronscan|bscscan|solscan|explorer/i.test(t), k + ": " + t);
    assert.equal((t.match(/https?:\/\/\S+/g) || []).length, 1, k + " one link");
    assert.ok(t.includes(bigtxLink(tx(k, c))), k + " our chart link (T40-24: chart of that coin + ?src)");
    assert.ok(xLen(t) <= 280, k + " X length " + xLen(t)); // T40-24: X counts a URL as 23
  }
});

test("why line: exchange in/out + stablecoin mint only, hedged", () => {
  assert.match(whyLine(tx("exchange_in", "ETH")), /sell pressure/);
  assert.match(whyLine(tx("exchange_in", "USDT")), /buying power/);
  assert.match(whyLine(tx("exchange_out", "BTC")), /accumulation/);
  assert.match(whyLine(tx("mint", "USDC")), /supply/);
  assert.equal(whyLine(tx("wallet")), "");
});

test("whale post texts (plain + thread reply) link only our site", () => {
  const m = { address: "0xabc0000000000000000000000000000000000001", coin: "BTC", side: "LONG", sizeCoin: 70.9, notional: 5.5e6, lev: 10, entry: 81151, label: "Whale", rank: 5, pnl30: 1.5e6, win: 0.6, trades: 20 };
  for (const th of [false, true]) { const p = makeText(m, undefined, th); assert.deepEqual(foreignLinks(p.text + "\n" + (p.reply || "")), []); }
});

test("source scan: every post builder file has no hard-coded outside link inside post text templates", () => {
  // the only outside URLs allowed in these files are API endpoints (Hyperliquid, Buffer, GitHub raw image host, our feeds), never in a text template
  for (const f of ["x_bigtx.mjs", "x_lib.mjs", "x_post.mjs", "x_extra.mjs"]) {
    const src = fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
    assert.ok(!/Tx:\s*\$\{/.test(src), f + " has a Tx: link template");
    assert.ok(!/(etherscan|tronscan|bscscan|solscan|arbiscan|basescan|tonviewer|xrpscan|mempool\.space)/i.test(src), f + " names an explorer");
  }
});
