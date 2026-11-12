// Renders a vertical 9:16 Reel (webm) from the same data JSON as render.mjs. One card per scene, rows pop in one by one.
// usage: node reel.mjs data.json out.webm   (CI converts to mp4 with ffmpeg)
import { chromium } from "playwright-core";
import fs from "node:fs";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const [, , dataFile = "data.json", outFile = "reel.webm"] = process.argv;
const d = JSON.parse(fs.readFileSync(dataFile, "utf8"));

const INTRO = 2.2, SCENE = 3.6, OUTRO = 2.4;
const cards = d.cards.slice(0, 5);
const total = INTRO + cards.length * SCENE + OUTRO;

const scenes = cards.map((c, i) => {
  const t0 = INTRO + i * SCENE;
  return `<section class="scene" style="animation-delay:${t0}s">
    <h2>${esc(c.title)}</h2>
    ${c.rows.slice(0, 5).map((r, j) => `<div class="row" style="animation-delay:${t0 + 0.5 + j * 0.35}s">
      <span class="nm">${esc(r.name)}</span>
      <span class="val">${esc(r.value || "")}</span>
      <span class="chg ${r.side || "up"}">${esc(r.change || "")}</span>
    </div>`).join("")}
  </section>`;
}).join("");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
html,body{width:1080px;height:1920px;overflow:hidden}
body{background:radial-gradient(circle at 50% 0%,#1d3550,#0e1621 70%);font-family:"Segoe UI","Noto Sans",Arial,sans-serif;color:#e8eef5;position:relative}
.intro,.outro{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;opacity:0;padding:0 80px}
.intro{animation:io ${INTRO}s ease both}
.outro{animation:oi ${OUTRO}s ease ${total - OUTRO}s both}
.intro h1{font-size:120px;font-weight:800;line-height:1.1}
.intro p,.outro p{font-size:46px;color:#8fa3b8;margin-top:28px}
.outro h1{font-size:84px;font-weight:800;color:#5eb5f7}
.scene{position:absolute;left:60px;right:60px;top:430px;opacity:0;animation:sc ${SCENE}s ease both}
.scene h2{font-size:64px;font-weight:800;margin-bottom:56px;text-align:center}
.row{display:flex;align-items:center;background:#1e2c3a;border:2px solid #2b3d4f;border-radius:22px;margin-bottom:26px;font-size:50px;opacity:0;animation:rw .5s ease both}
.row span{padding:34px 28px}
.nm{flex:1.3;color:#5eb5f7;font-weight:700}
.val{flex:1.7;text-align:center}
.chg{flex:1.1;text-align:right;font-weight:700}
.up{color:#4ade80}.dn{color:#f87171}
.url{position:absolute;bottom:90px;left:0;right:0;text-align:center;font-size:40px;color:#8fa3b8}
@keyframes io{0%{opacity:0;transform:scale(.9)}20%{opacity:1;transform:none}85%{opacity:1}100%{opacity:0}}
@keyframes oi{0%{opacity:0}25%{opacity:1}100%{opacity:1}}
@keyframes sc{0%{opacity:0;transform:translateY(40px)}8%{opacity:1;transform:none}90%{opacity:1}100%{opacity:0}}
@keyframes rw{from{opacity:0;transform:translateX(-30px)}to{opacity:1;transform:none}}
</style></head><body>
<div class="intro"><h1>${esc(d.title)}</h1><p>${esc(d.date)}</p></div>
${scenes}
<div class="outro"><h1>marketradarwhale.com</h1><p>${esc(d.footer || "")}</p></div>
<div class="url">marketradarwhale.com</div>
</body></html>`;

const exe = process.env.CHROME_PATH || undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, recordVideo: { dir: "reel_tmp", size: { width: 1080, height: 1920 } } });
const page = await ctx.newPage();
await page.setContent(html);
await page.waitForTimeout(Math.ceil(total * 1000) + 500);
const vid = page.video();
await ctx.close();
await vid.saveAs(outFile);
await browser.close();
fs.rmSync("reel_tmp", { recursive: true, force: true });
console.log("wrote", outFile, total.toFixed(1) + "s");
