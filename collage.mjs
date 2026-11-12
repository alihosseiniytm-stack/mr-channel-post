import { chromium } from "playwright-core";
import fs from "node:fs";
const LAB = { en: ["Real track record", "Live moves", "Leaderboard"], fa: ["سابقهٔ واقعی", "حرکت‌های زنده", "جدول برترین‌ها"], ar: ["سجل حقيقي", "تحركات مباشرة", "المتصدرون"], hi: ["असली रिकॉर्ड", "लाइव मूव्स", "लीडरबोर्ड"], vi: ["Thành tích thật", "Diễn biến trực tiếp", "Bảng xếp hạng"], id: ["Rekam jejak nyata", "Gerakan langsung", "Papan peringkat"], ru: ["Реальная история", "Живые движения", "Рейтинг"] };
const TITLE = { en: "Futures Whales", fa: "نهنگ‌های فیوچرز", ar: "حيتان العقود الآجلة", hi: "फ्यूचर्स व्हेल", vi: "Cá voi Futures", id: "Paus Futures", ru: "Киты фьючерсов" };
const exe = "C:/Users/aliho/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
const b = await chromium.launch({ executablePath: exe });
for (const lang of process.argv.slice(2)) {
  const ctx = await b.newContext({ viewport: { width: 420, height: 1000 }, deviceScaleFactor: 1.5 });
  await ctx.addInitScript((l) => { try { localStorage.setItem("radar_lang", l); } catch (e) {} }, lang);
  const p = await ctx.newPage();
  await p.goto("https://marketradarwhale.com/trade?tab=whales&scope=futures", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(6000);
  const shots = [];
  for (let i = 0; i < 3; i++) {
    await p.evaluate((n) => { const t = document.querySelectorAll("[data-ftab]")[n]; if (t) t.click(); }, i);
    await p.waitForTimeout(4500);
    shots.push((await p.screenshot({ clip: { x: 0, y: 0, width: 420, height: 1000 } })).toString("base64"));
  }
  const rtl = lang === "fa" || lang === "ar";
  const order = rtl ? [2, 1, 0] : [0, 1, 2];
  const html = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#0b1620;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#e8eef5;width:1380px;padding:28px 30px 34px;box-sizing:border-box">
  <div style="font-size:44px;font-weight:700;margin-bottom:22px;text-align:center">🐋 MarketRadar · ${TITLE[lang]}</div>
  <div style="display:flex;gap:24px;direction:ltr">${order.map((i) => `<div style="flex:1"><div style="font-size:30px;font-weight:600;text-align:center;margin-bottom:12px;color:#5eead4">${LAB[lang][i]}</div><img src="data:image/png;base64,${shots[i]}" style="width:100%;border-radius:18px;border:2px solid #243746;display:block"></div>`).join("")}</div>
  <div style="text-align:center;font-size:26px;color:#8fa3b8;margin-top:22px">marketradarwhale.com</div></body>`;
  const pg = await ctx.newPage();
  await pg.setViewport?.call;
  await pg.setViewportSize({ width: 1380, height: 800 });
  await pg.setContent(html);
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `bc/${lang}.jpg`, type: "jpeg", quality: 82, fullPage: true });
  console.log("ok", lang, fs.statSync(`bc/${lang}.jpg`).size);
  await ctx.close();
}
await b.close();
