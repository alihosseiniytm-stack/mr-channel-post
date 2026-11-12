import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "C:/Users/aliho/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem("radar_lang", "en"); } catch (e) {} });
const p = await ctx.newPage();
await p.goto("https://marketradarwhale.com/trade?tab=whales&scope=futures", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await p.waitForTimeout(5000);
console.log(await p.evaluate(() => [...document.querySelectorAll("button,[role=tab],[data-sub],[data-view]")].filter(e => e.offsetParent && e.getBoundingClientRect().top < 400).slice(0, 20).map(e => e.tagName + "|" + e.id + "|" + e.className + "|" + (e.dataset.sub || e.dataset.view || e.dataset.tab || "") + "|" + e.textContent.trim().slice(0, 25)).join("\n")));
await b.close();
