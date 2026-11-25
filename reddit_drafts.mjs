// REDDIT DRAFTS to the owner on Telegram (T40-24, owner D348 + D350 2026-11-25). NEVER calls the Reddit API and NEVER posts:
// it builds text from OUR data (wh /btf/free.json) and sends it to the owner's monitor chat; the owner copies it by hand.
// Warm-up (D350): days 1-5 after START = 2-3 helpful comment drafts for the Daily Discussion threads of r/CryptoCurrency,
// r/BitcoinMarkets, r/ethtrader, NO link (new account: links get removed / look like spam). From day 6 also ONE value-post draft
// (data first, our chart link last with ?src=reddit). Reddit's JSON is closed to scripts (checked 2026-11-25: rules.json + hot.json
// answer an HTML bot wall), so the drafts target the daily threads instead of picking threads.
// usage: node reddit_drafts.mjs [--send]   env: MONITOR_BOT_TOKEN, MONITOR_CHAT_ID (owner chat), REDDIT_START (YYYY-MM-DD, default below)
import { usd } from "./x_lib.mjs";
import { flowSum, STABLE, CHART_COIN } from "./x_bigtx.mjs";
export const START = "2026-11-25", WARMUP_DAYS = 5;
export const SUBS = ["r/CryptoCurrency (Daily Discussion)", "r/BitcoinMarkets (Daily Discussion)", "r/ethtrader (Daily Discussion)"];
export const dayN = (now, start = START) => Math.floor((Date.parse(new Date(now).toISOString().slice(0, 10)) - Date.parse(start)) / 864e5) + 1;
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const dir = (k) => (k === "exchange_in" ? "sent to an exchange" : k === "exchange_out" ? "taken off an exchange" : null);

// pure: free.json -> {comments:[{sub,text}], post:{title,body}|null}
export function buildDrafts(j, now, start = START) {
  const d = dayN(now, start), it = (j.items || []).filter((x) => CHART_COIN[String(x.coin).toUpperCase()] && dir(x.kind) && now - x.t <= 24 * 3600e3).sort((a, b) => b.usd - a.usd);
  const b = flowSum(j.netflow, "BTC"), e = flowSum(j.netflow, "ETH"), top = it[0], eth = it.find((x) => CHART_COIN[String(x.coin).toUpperCase()] === "ETH");
  const c = [];
  if (b) c.push({ sub: SUBS[1], text: `Interesting day on-chain: about ${usd(b.in)} of BTC moved onto exchanges in big transfers (over $5M each) in the last 24 h vs ${usd(b.out)} moving off. Net ${b.net >= 0 ? "inflow" : "outflow"} of ${usd(Math.abs(b.net))}. Inflows are often a sign someone is getting ready to sell, but one day alone says little; I'd watch if it repeats for a few days.` });
  if (top) c.push({ sub: SUBS[0], text: `Biggest single move I saw today: ${fmt(top.amount)} ${top.coin} (${usd(top.usd)}) ${dir(top.kind)}. ${top.kind === "exchange_in" ? "Coins going onto an exchange often get sold, but it can also be an exchange moving its own funds" : "Coins leaving an exchange are usually moved to cold storage, which is a quiet bullish sign"}. Anyone else tracking whale wallets? What do you use?` });
  if (e || eth) c.push({ sub: SUBS[2], text: eth ? `Whale watch for ETH: ${fmt(eth.amount)} ${eth.coin} (${usd(eth.usd)}) ${dir(eth.kind)} today.${e ? ` Overall big ETH transfers: ${usd(e.in)} onto exchanges vs ${usd(e.out)} off in 24 h.` : ""} Not advice, just the flow. Curious if price reacts in the next day.` : `Big ETH transfers in the last 24 h: ${usd(e.in)} onto exchanges vs ${usd(e.out)} off. Net ${e.net >= 0 ? "in" : "out"} ${usd(Math.abs(e.net))}. Not advice, just the flow.` });
  let post = null;
  if (d > WARMUP_DAYS && (b || top)) {
    post = { sub: "r/CryptoCurrency", title: `I tracked every $5M+ BTC/ETH exchange transfer for 24 h - here is the flow${b ? ` (BTC net ${b.net >= 0 ? "+" : "-"}${usd(Math.abs(b.net))})` : ""}`,
      body: [b && `BTC: ${usd(b.in)} onto exchanges, ${usd(b.out)} off (net ${b.net >= 0 ? "+" : "-"}${usd(Math.abs(b.net))}).`, e && `ETH: ${usd(e.in)} onto exchanges, ${usd(e.out)} off (net ${e.net >= 0 ? "+" : "-"}${usd(Math.abs(e.net))}).`,
        top && `Biggest single move: ${fmt(top.amount)} ${top.coin} (${usd(top.usd)}) ${dir(top.kind)}.`, "", "How to read it: coins moving onto exchanges are often sold soon; coins leaving are usually held. One day is noise, a streak of days is a signal.",
        "", "I put these transfers as markers on a free chart (no sign-up) if you want to see where they landed on the candles: https://marketradarwhale.com/en/chart/?m=BTC&tf=1h&src=reddit"].filter((x) => x != null).join("\n") };
  }
  return { day: d, comments: c.slice(0, 3), post };
}
export function message(dr) {
  const L = [`📝 Reddit drafts, day ${dr.day} ${dr.day <= WARMUP_DAYS ? "(warm-up: comments only, NO link)" : ""}`, "پیش‌نویس ردیت: فقط کپی کنید؛ خودِ ربات هیچ‌وقت پست نمی‌گذارد.", ""];
  dr.comments.forEach((c, i) => L.push(`💬 Comment ${i + 1} -> ${c.sub}:`, c.text, ""));
  if (dr.post) L.push(`📌 Value post -> ${dr.post.sub}`, "Title: " + dr.post.title, "", dr.post.body);
  return L.join("\n").slice(0, 4000);
}
if ((process.argv[1] || "").endsWith("reddit_drafts.mjs")) {
  const j = await fetch("https://wh.marketradarwhale.com/btf/free.json", { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
  const dr = buildDrafts(j, Date.now(), process.env.REDDIT_START || START), text = message(dr);
  console.log(text);
  if (process.argv.includes("--send")) {
    const E = process.env; if (!E.MONITOR_BOT_TOKEN || !E.MONITOR_CHAT_ID) { console.log("telegram: no MONITOR_BOT_TOKEN / MONITOR_CHAT_ID"); process.exit(1); }
    const r = await fetch("https://api.telegram.org/bot" + E.MONITOR_BOT_TOKEN + "/sendMessage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: E.MONITOR_CHAT_ID, text, disable_web_page_preview: true }) }).then((r) => r.json());
    console.log(r.ok ? "telegram message_id " + r.result.message_id : "telegram failed " + JSON.stringify(r).slice(0, 200)); if (!r.ok) process.exit(1);
  }
}
