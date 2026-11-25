// T40-24 #x-chart (owner D349 + D351 + D347, 2026-11-25): coin ranking, after-post %, flow text, ?src in every link, rotating why line,
// one image look (site tokens), X length. Offline (no network).
import test from "node:test"; import assert from "node:assert/strict";
import { xPick, xText, tierOf, chartCoin, bigtxLink, afterText, flowText, flowSum, pctSince, xLen, STABLE_MINT_MIN } from "../x_bigtx.mjs";
import { makeText, whyChart, WHY_CHART, foreignLinks } from "../x_lib.mjs";
import { parseTokens, chartSvg, DEF_TOK } from "../x_chart_img.mjs";
import { cardHtml } from "../x_card.mjs";

const now = Date.parse("2026-11-25T15:00:00Z");
const it = (o) => ({ id: o.id, t: now - 600e3, chain: "eth", net: "Ethereum", tx: "0x" + o.id, from: "a" + o.id, to: "b" + o.id, src_n: 2, conf: "ok", internal: false, amount: o.usd, ...o });

test("coin ranking: native to/from exchange first, then native, then stablecoins; small stablecoin mints never", () => {
  const items = [it({ id: "s1", coin: "USDT", kind: "exchange_out", usd: 270e6 }), it({ id: "n1", coin: "ETH", kind: "exchange_in", usd: 42e6 }),
    it({ id: "n2", coin: "BTC", kind: "wallet", usd: 300e6 }), it({ id: "m1", coin: "USDC", kind: "mint", usd: 50e6 })];
  assert.equal(xPick(items, [], now, 20e6).id, "n1", "native exchange move beats a bigger stablecoin and a bigger native wallet move");
  assert.equal(xPick(items, ["n1"], now, 20e6).id, "n2", "then native other");
  assert.equal(xPick(items, ["n1", "n2"], now, 20e6).id, "s1", "then stablecoin");
  assert.equal(xPick(items, ["n1", "n2", "s1"], now, 20e6), null, "$50M stablecoin mint never");
  assert.equal(tierOf({ coin: "USDC", kind: "mint", usd: STABLE_MINT_MIN }), 2, "$100M mint allowed");
  assert.equal(tierOf({ coin: "WETH", kind: "exchange_out" }), 0); assert.equal(chartCoin({ coin: "WETH" }), "ETH"); assert.equal(chartCoin({ coin: "USDT" }), "BTC");
  assert.equal(xPick(items, ["d:2026-11-25", "d:2026-11-25"], now, 20e6), null, "PER_DAY 2 kept");
});

test("after-post: % since the move is right and the text is own-link + ?src", () => {
  assert.equal(pctSince(100, 97.9).toFixed(1), "-2.1"); assert.equal(pctSince(0, 5), null); assert.equal(pctSince(NaN, 5), null);
  const t = afterText({ cc: "BTC", p0: 60000, amt: "2,336 #BTC ($140M)", dir: "off an exchange" }, 61200, undefined, WHY_CHART[0]);
  assert.match(t, /\+2\.0%/); assert.match(t, /\$60,000 → \$61,200/); assert.match(t, /src=x_after/); assert.deepEqual(foreignLinks(t), []); assert.ok(xLen(t) <= 280, "len " + xLen(t));
});

test("flow text: sums the last 24 h, own link + ?src, fits X", () => {
  const nf = { h0: 0, step: 3600e3, coins: { BTC: { in: Array(48).fill(2e6), out: Array(48).fill(1e6) }, ETH: { in: Array(48).fill(1e6), out: Array(48).fill(3e6) } } };
  assert.deepEqual(flowSum(nf, "BTC"), { in: 48e6, out: 24e6, net: 24e6 });
  const t = flowText(nf, undefined, WHY_CHART[5]); assert.match(t, /#BTC in \$48\.0M, out \$24\.0M: net \+\$24\.0M/); assert.match(t, /#ETH .* net -\$48\.0M/);
  assert.match(t, /src=x_flow/); assert.deepEqual(foreignLinks(t), []); assert.ok(xLen(t) <= 280, "len " + xLen(t));
  assert.equal(flowText({ coins: {} }), null);
});

test("D347 ?src in EVERY post link; D351 why line rotates, never twice in a row, 1 line, fits X", () => {
  const st = {}; let prev = null;
  for (let i = 0; i < 20; i++) { const w = whyChart(st); assert.notEqual(w, prev); assert.ok(!w.includes("\n") && w.length <= 80); prev = w; }
  assert.ok(WHY_CHART.length >= 5 && WHY_CHART.length <= 7);
  for (const k of ["exchange_in", "exchange_out", "mint", "wallet", "dex_swap"]) for (const coin of ["BTC", "USDT", "WETH"]) {
    const t = xText(it({ id: "x", coin, kind: k, usd: 1.5e8, amount: 1.5e8, toType: "dex" }), undefined, WHY_CHART[1]);
    for (const u of t.match(/https?:\/\/\S+/g)) assert.match(u, /[?&]src=x_/, u);
    assert.ok(t.trim().endsWith(bigtxLink(it({ coin }))), "ends with the link"); assert.ok(xLen(t) <= 280, k + coin + " len " + xLen(t));
  }
  const m = { address: "0xabc0000000000000000000000000000000000001", coin: "BTC", side: "LONG", sizeCoin: 70.9, notional: 5.5e6, lev: 10, entry: 81151, label: "Whale · 60% win rate", rank: 5, pnl30: 1.5e6, win: 0.6, trades: 20 };
  const p = makeText(m, undefined, false, WHY_CHART[2]); assert.match(p.url, /\?src=x_whale$/); assert.ok(p.text.endsWith(WHY_CHART[2] + "\n" + p.url)); assert.ok(xLen(p.text) <= 280);
  const th = makeText(m, undefined, true, WHY_CHART[2]); assert.ok(th.reply.includes("?src=x_whale"));
});

test("one image look: site tokens parsed, whale card + chart use them, liq level drawn", () => {
  const tok = parseTokens(":root{--bg:#000001; --panel:#000002; --border:#000003; --accent:#000004; --ink:#000005; --ink-dim:#000006; --up:#00aa00; --down:#aa0000;}\n:root[data-theme=light]{--bg:#ffffff}");
  assert.equal(tok.src, "site"); assert.equal(tok.bg, "#000001"); assert.equal(tok.up, "#00aa00");
  assert.equal(parseTokens("nothing").src, "default");
  const c = Array.from({ length: 60 }, (_, i) => ({ t: now - (60 - i) * 900e3, o: 100 + i * 0.1, h: 101 + i * 0.1, l: 99 + i * 0.1, c: 100.5 + i * 0.1 }));
  const h = cardHtml({ side: "LONG", coin: "BTC", label: "Whale", notional: 5e6, entry: 104, lev: 10, pnl30: 1e6, fillT: now - 3 * 3600e3, now: 106, liq: 95 }, c, tok);
  assert.ok(h.includes("#000001") && h.includes("#00aa00"), "card uses the site tokens"); assert.match(h, /Liq 95/); assert.match(h, /Entry 104/); assert.match(h, /MarketRadar Whale/);
  const far = cardHtml({ side: "LONG", coin: "BTC", label: "W", notional: 5e6, entry: 104, lev: 2, fillT: now - 3600e3, now: 106, liq: 10 }, c, tok);
  assert.ok(!/Liq 10/.test(far), "liq far away (> 25%) is left out instead of flattening the chart");
  const s = chartSvg({ candles: c, tok: DEF_TOK, marks: [{ t: now - 3600e3, dir: "down", color: DEF_TOK.down, label: "2,336 BTC" }] });
  assert.match(s, /2,336 BTC/); assert.match(s, /<polygon/);
});

test("reddit drafts (D350): warm-up comments have NO link; value post only after day 5, link last with ?src=reddit; never a Reddit API call", async () => {
  const { buildDrafts, message } = await import("../reddit_drafts.mjs");
  const nf = { h0: 0, step: 3600e3, coins: { BTC: { in: Array(48).fill(2e6), out: Array(48).fill(1e6) }, ETH: { in: Array(48).fill(1e6), out: Array(48).fill(3e6) } } };
  const j = { netflow: nf, items: [it({ id: "b", coin: "BTC", kind: "exchange_in", usd: 60e6, t: Date.parse("2026-11-26T09:00:00Z") })] };
  const d1 = buildDrafts(j, Date.parse("2026-11-26T10:00:00Z"));
  assert.equal(d1.day, 2); assert.equal(d1.post, null); assert.ok(d1.comments.length >= 2 && d1.comments.length <= 3);
  for (const c of d1.comments) assert.ok(!/https?:\/\//.test(c.text), "no link in warm-up comment");
  const d7 = buildDrafts(j, Date.parse("2026-12-01T10:00:00Z"));
  assert.ok(d7.post && d7.post.body.trim().endsWith("src=reddit")); assert.ok(message(d7).length <= 4000);
  const src = (await import("node:fs")).readFileSync(new URL("../reddit_drafts.mjs", import.meta.url), "utf8");
  assert.ok(!/reddit\.com\/(api|r\/)|oauth\.reddit/i.test(src), "no Reddit API / post call in the code");
});
