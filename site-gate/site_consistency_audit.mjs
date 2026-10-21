// Site integrity gate (S0, 2026-10-21). Fetches EVERY URL of the live sitemap slowly (concurrency 3, backoff on HTTP 429),
// groups pages into families by URL pattern, records per page: HTTP status, CSS/JS asset set (hash stripped), shared header (<header>/<nav>),
// .mrw-lang language menu, charset position, viewport meta. Compares each page with tools/site_families.expected.json.
//
// Usage:
//   node tools/site_consistency_audit.mjs            check: exit 1 on any NEW deviation (not listed under knownDeviations), exit 0 otherwise
//   node tools/site_consistency_audit.mjs --init     (re)derive the expected set of each family = most common set; prints it, writes expected.json
//                                                    ONLY if the file does not exist (never overwrites; use --init --force and keep knownDeviations by hand)
//   --base=URL  --conc=N (default 3)  --limit=N (test on first N URLs)  --out=path (rows json, default tools/site_consistency_audit.json)
//   --report=path  write the human-readable summary (markdown) there
// Deviation signature = "<kind>:<detail>" strings per page; a page is OK when every signature is the expected one for its family or is
// listed in the family's knownDeviations (with a reason). Nothing here fixes the site.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : d; };
const flag = (n) => process.argv.includes("--" + n);
const BASE = arg("base", "https://marketradarwhale.com"), CONC = Number(arg("conc", 3)), LIMIT = Number(arg("limit", 0));
const OUT = arg("out", path.join(here, "site_consistency_audit.json")), REPORT = arg("report", "");
const EXPECTED = path.join(here, "site_families.expected.json");
const LANGS = new Set(["en", "fa", "ar", "ru", "hi", "id", "vi"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- family by URL pattern ------------------------------------------------------------------------------
// /<lang>/<slug>/ pages that are NOT articles (hubs, legacy static pages). Anything else under /<lang>/<slug> is an article.
const WHALE_HUB = /^(whale|whales|whales-solana|whales-futures|solana-whales|whale-buys-today|pumps|whale-stories-and-sacred-numbers)$/;
const LEGACY_LANG_SLUGS = new Set(["about", "markets", "signals", "terms", "privacy", "help", "status", "security", "changelog", "community", "refer", "convert", "embed", "leaderboard", "demo-account", "guides", "trade"]);
export function familyOf(p) {
  const s = p.split("/").filter(Boolean);
  if (s.length === 0) return "home";
  if (s.length === 1) return LANGS.has(s[0]) ? "home-lang" : WHALE_HUB.test(s[0]) ? "whales-hub" : "legacy-static";
  if (s[0] === "learn") return s.length === 2 ? "learn-index" : "learn/" + s[2];
  if (s[0] === "trade") return "trade";
  if (LANGS.has(s[0])) {
    const slug = s[1];
    if (s.length === 2) {
      if (WHALE_HUB.test(slug)) return "whales-hub";
      if (LEGACY_LANG_SLUGS.has(slug)) return "legacy-static";
      return "article";
    }
    if (slug === "whales") return "whales-coin"; // /<lang>/whales/<coin>
    if (slug === "guides") return "article-hub";
    return "other-lang-deep";
  }
  return "legacy-static";
}

// ---- fetch one page -------------------------------------------------------------------------------------
const strip = (s) => s.replace(/(\.[0-9a-f]{8,12})+\.(css|js)$/, ".*.$2"); // a.<hash>.<hash>.js (fam files) -> a.*.js
async function fetchPage(p) {
  let r, bytes;
  for (let a = 0; a < 8; a++) {
    try {
      r = await fetch(BASE + p, { signal: AbortSignal.timeout(30000), redirect: "manual", headers: { "user-agent": "mr-integrity-gate/1" } });
      if (r.status === 429) { await r.arrayBuffer().catch(() => {}); await sleep(3000 * (a + 1)); continue; }
      bytes = Buffer.from(await r.arrayBuffer());
      break;
    } catch (e) { if (a === 7) return { p, st: 0, err: String(e.message).slice(0, 60) }; await sleep(2000 * (a + 1)); }
  }
  if (!bytes) return { p, st: 429, err: "429 after retries" };
  const h = bytes.toString("utf8"), head = bytes.subarray(0, 1024).toString("latin1");
  const set = (re) => [...new Set([...h.matchAll(re)].map((m) => strip(m[1])))].sort();
  return {
    p, st: r.status, fam: familyOf(p),
    css: set(/href="\/assets\/([a-z0-9.\-]+\.css)"/g), js: set(/src="\/assets\/([a-z0-9.\-]+\.js)"/g).filter((x) => !/^fam\./.test(x)), // fam.*.js = per-page content data (coin/exchange tables), not shell: ignored
    header: /<header[\s>]/.test(h) || /<nav[\s>]/.test(h), lang: /class="[^"]*\bmrw-lang\b/.test(h),
    charset1k: /<meta[^>]+charset/i.test(head), vp: /name="viewport"/.test(h), size: h.length,
  };
}

// ---- deviations of one page vs its family ---------------------------------------------------------------
export function deviations(row, exp) {
  if (row.st !== 200) return ["status:" + row.st + (row.err ? "(" + row.err + ")" : "")];
  const e = exp && exp.families && exp.families[row.fam];
  if (!e) return ["family:no-expectation"];
  const d = [], css = row.css.join("+"), js = row.js.join("+");
  if (css !== e.css.join("+")) d.push("css:" + css);
  if (js !== e.js.join("+")) d.push("js:" + js);
  if (e.header && !row.header) d.push("header:missing");
  if (e.lang && !row.lang) d.push("lang-menu:missing");
  if (!row.charset1k) d.push("charset:after-1024");
  if (!row.vp) d.push("viewport:missing");
  return d;
}

// ---- main -----------------------------------------------------------------------------------------------
const FROM = arg("from", ""); // --from=rows.json: re-analyse a previous fetch without touching the site
let urls = [];
for (let a = 0; !FROM && a < 6 && !urls.length; a++) {
  try {
    const r = await fetch(BASE + "/sitemap.xml", { signal: AbortSignal.timeout(60000), headers: { "user-agent": "mr-integrity-gate/1" } });
    const xml = await r.text();
    urls = [...new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname))];
    if (!urls.length) console.error("sitemap attempt", a + 1, "HTTP", r.status, "no <loc>");
  } catch (e) { console.error("sitemap attempt", a + 1, e.message); }
  if (!urls.length) await sleep(4000 * (a + 1));
}
if (!FROM && !urls.length) { console.error("GATE ERROR: sitemap empty/unreadable"); process.exitCode = 2; throw new Error("sitemap"); }
if (LIMIT) urls = urls.slice(0, LIMIT);
let rows = []; let idx = 0;
if (FROM) rows = JSON.parse(fs.readFileSync(FROM, "utf8")).map((r) => ({ ...r, fam: familyOf(r.p), css: (r.css || []).map(strip), js: (r.js || []).map(strip).filter((x) => !/^fam\./.test(x)) }));
else await Promise.all(Array.from({ length: CONC }, async () => {
  while (idx < urls.length) {
    const p = urls[idx++]; rows.push(await fetchPage(p));
    if (idx % 250 === 0) console.error(`  ... ${idx}/${urls.length}`);
    await sleep(150);
  }
}));
if (!FROM) for (let k = 0; k < rows.length; k++) { // second pass, strictly sequential, for transient failures (429 / network / 5xx)
  if (rows[k].st === 0 || rows[k].st === 429 || rows[k].st >= 500) { await sleep(5000); rows[k] = await fetchPage(rows[k].p); }
}
rows.sort((a, b) => a.p.localeCompare(b.p));
if (!FROM) fs.writeFileSync(OUT, JSON.stringify(rows));

const byFam = {};
for (const r of rows) if (r.fam) (byFam[r.fam] = byFam[r.fam] || []).push(r);

if (flag("init")) {
  const exp = { generated: new Date().toISOString().slice(0, 10), note: "expected = most common asset set per family; deviations of a family are listed in knownDeviations with a reason, NEVER hidden by editing css/js", families: {} };
  for (const [f, rs] of Object.entries(byFam)) {
    const ok = rs.filter((r) => r.st === 200), cnt = {};
    for (const r of ok) { const k = JSON.stringify([r.css, r.js]); cnt[k] = (cnt[k] || 0) + 1; }
    const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    const [css, js] = best ? JSON.parse(best[0]) : [[], []];
    exp.families[f] = { pages: rs.length, css, js, header: ok.filter((r) => r.header).length > ok.length / 2, lang: ok.filter((r) => r.lang).length > ok.length / 2, example: rs[0].p, knownDeviations: {} };
  }
  if (!fs.existsSync(EXPECTED) || flag("force")) { fs.writeFileSync(EXPECTED, JSON.stringify(exp, null, 1)); console.log("wrote", EXPECTED); } else console.log("expected.json exists; not overwritten (use --force)");
  fs.writeFileSync(OUT.replace(/\.json$/, ".init.json"), JSON.stringify(exp, null, 1));
}

const exp = JSON.parse(fs.readFileSync(EXPECTED, "utf8"));
for (const f of Object.values(exp.families)) for (const k of Object.values(f.knownDeviations)) k.pages = 0; // recounted below
if (flag("accept-baseline")) { // one-off: record today's deviations as KNOWN (adds only; never edits css/js expectations). Re-run check afterwards.
  const why = (sig) => sig.startsWith("status:30") ? "sitemap lists a URL that redirects (not 200) - found by S0 audit 2026-10-21; fix sitemap or page" : sig.startsWith("status:404") ? "sitemap lists a URL that returns 404 - found by S0 audit 2026-10-21; fix sitemap or build the page" : sig.startsWith("css:") ? "family served with a different CSS stack than its majority (two generators/builds) - S0 baseline 2026-10-21; removed by S1 shell migration" : sig.startsWith("js:") ? "different JS set than family majority - S0 baseline 2026-10-21" : sig.startsWith("lang-menu") || sig.startsWith("header") ? "shared header/language menu absent - S0 baseline 2026-10-21" : "S0 baseline 2026-10-21";
  for (const r of rows) for (const sig of deviations(r, exp)) { if (/^status:(0|429|5)/.test(sig)) continue; const f = exp.families[r.fam]; if (!f) continue; const k = f.knownDeviations[sig] = f.knownDeviations[sig] || { reason: why(sig), pages: 0, example: r.p }; k.pages++; }
  fs.writeFileSync(EXPECTED, JSON.stringify(exp, null, 1)); console.log("baseline recorded in", EXPECTED);
}
const newDev = [], known = {}, sigCount = {};
for (const r of rows) {
  const ds = deviations(r, exp), fe = (exp.families[r.fam] || {}).knownDeviations || {};
  for (const sig of ds) {
    const k = r.fam + " | " + sig;
    sigCount[k] = sigCount[k] || { n: 0, ex: r.p, known: !!fe[sig] };
    sigCount[k].n++;
    if (fe[sig]) known[k] = (known[k] || 0) + 1; else newDev.push({ p: r.p, fam: r.fam, sig });
  }
}
// pages that vanished from a family entirely would show as a shrinking page count: report big drops (> 10 %) as deviations too
for (const [f, e] of Object.entries(exp.families)) { const n = (byFam[f] || []).length; if (!LIMIT && e.pages && n < e.pages * 0.9) newDev.push({ p: "(family)", fam: f, sig: `pages-dropped:${e.pages}->${n}` }); }

const lines = [`# Site consistency run ${new Date().toISOString()}`, `pages ${rows.length}; families ${Object.keys(byFam).length}; NEW deviations ${newDev.length}; known-deviation hits ${Object.values(known).reduce((a, b) => a + b, 0)}`, "", "| family | pages | expected css | expected js | deviating signatures |", "|---|---|---|---|---|"];
for (const [f, rs] of Object.entries(byFam).sort((a, b) => b[1].length - a[1].length)) {
  const e = exp.families[f] || { css: [], js: [] };
  const sigs = Object.entries(sigCount).filter(([k]) => k.startsWith(f + " | ")).map(([k, v]) => `${k.slice(f.length + 3)} ×${v.n}${v.known ? " (known)" : " **NEW**"} e.g. ${v.ex}`);
  lines.push(`| ${f} | ${rs.length} | ${e.css.join("+")} | ${e.js.join("+")} | ${sigs.join("<br>") || "—"} |`);
}
if (newDev.length) { lines.push("", "## NEW deviations (first 40)"); for (const d of newDev.slice(0, 40)) lines.push(`- ${d.fam} ${d.p} → ${d.sig}`); }
const text = lines.join("\n");
if (REPORT) fs.writeFileSync(REPORT, text);
console.log(text);
if (newDev.length) { console.error(`GATE FAILED: ${newDev.length} new deviation(s)`); process.exitCode = 1; } else
console.log("GATE OK");
