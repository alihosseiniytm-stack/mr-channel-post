// Renders the channel table image from a data JSON (same look as the owner's reference: dark cards, title bar, rows name | value | change).
// usage: node render.mjs data.json out.png
import { chromium } from "playwright-core";
import fs from "node:fs";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const [, , dataFile = "sample.json", outFile = "out.png"] = process.argv;
const d = JSON.parse(fs.readFileSync(dataFile, "utf8"));
const rtl = d.dir === "rtl";

const cards = d.cards.map((c) => `
  <div class="card">
    <div class="ct">${esc(c.title)}</div>
    ${c.rows.map((r) => `<div class="row">
      <span class="chg ${r.side || (r.change && r.change.trim().startsWith("-") ? "dn" : "up")}">${esc(r.change || "")}</span>
      <span class="val">${esc(r.value || "")}</span>
      <span class="nm">${esc(r.name)}</span>
    </div>`).join("")}
  </div>`).join("");

const html = `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1000px;background:#17212b;font-family:"Segoe UI",Tahoma,"Noto Sans","Noto Sans Arabic","Noto Sans Devanagari",Arial,sans-serif;color:#e8eef5;padding:36px 40px}
.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:26px}
.head h1{font-size:34px;font-weight:700}
.head .dt{font-size:24px;color:#8fa3b8}
.card{background:#1e2c3a;border:1px solid #2b3d4f;border-radius:10px;margin-bottom:28px;overflow:hidden}
.ct{background:#22364a;padding:18px 24px;font-size:24px;font-weight:700}
.row{display:flex;align-items:center;border-top:1px solid #2b3d4f;font-size:28px;direction:ltr}
.row span{padding:20px 24px}
.nm{flex:1.4;color:#5eb5f7;text-align:${rtl ? "right" : "left"};order:${rtl ? 3 : 1}}
.val{flex:1.6;text-align:center;border-left:1px solid #2b3d4f;border-right:1px solid #2b3d4f;order:2}
.chg{flex:1;text-align:center;order:${rtl ? 1 : 3}}
.up{color:#4ade80}.dn{color:#f87171}
.foot{display:flex;justify-content:space-between;color:#8fa3b8;font-size:22px;margin-top:6px}
</style></head><body>
<div class="head"><h1>${esc(d.title)}</h1><div class="dt">${esc(d.date)}</div></div>
${cards}
<div class="foot"><span>${esc(d.footer || "")}</span><span>marketradarwhale.com</span></div>
</body></html>`;

const exe = process.env.CHROME_PATH || undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1.5 });
await page.setContent(html);
await page.screenshot({ path: outFile, fullPage: true });
await browser.close();
console.log("wrote", outFile);
