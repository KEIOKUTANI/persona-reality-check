// Screenshots, raw API responses and a demo video of a running server.
// Usage: start the server (live mode), then: node scripts/shoot.mjs [baseUrl]
// Needs Playwright (npm install --no-save playwright && npx playwright install chromium).
import { chromium } from "playwright";
import { mkdir, writeFile, rename, readdir } from "node:fs/promises";

const BASE = process.argv[2] || "http://localhost:5191";
const EXAMPLES = [
  ["Glamping café, Sapporo", "glamping-sapporo"],
  ["Gen Z café (Japanese plan)", "genz-japanese"],
  ["Outdoor gear shop", "outdoor-gear"],
];
const GENZ_TEXT = "ターゲットは24歳以下の若者。ゴルフと映画『ゴッドファーザー』、テイラー・スウィフトが好き。普段はドトールにも行くはずなので、価格はドトール並みにする。";

await mkdir("docs/screenshots", { recursive: true });
await mkdir("live-assets/video-tmp", { recursive: true });

const browser = await chromium.launch();
const config = await (await fetch(`${BASE}/api/config`)).json();
console.log("mode:", config.mode);

async function runExample(page, label) {
  const response = page.waitForResponse((r) => r.url().endsWith("/api/check"), { timeout: 90000 });
  await page.getByRole("button", { name: label, exact: true }).click();
  const data = await (await response).json();
  await page.waitForSelector(".ring", { timeout: 90000 });
  await page.waitForTimeout(2000);
  return data;
}

// a. desktop screenshots + JSON
const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await desk.goto(BASE);
for (const [label, slug] of EXAMPLES) {
  const data = await runExample(desk, label);
  await writeFile(`live-assets/${slug}.json`, JSON.stringify(data, null, 2) + "\n");
  await desk.screenshot({ path: `docs/screenshots/live-${slug}.png`, fullPage: true });
  console.log(`${slug}: score ${data.result?.score} mode ${data.result?.mode ?? config.mode}`);
}
await desk.close();

// b. mobile screenshot of the Gen Z result
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
await mobile.goto(BASE);
await runExample(mobile, "Gen Z café (Japanese plan)");
await mobile.screenshot({ path: "docs/screenshots/live-mobile.png", fullPage: true });
await mobile.close();

// c. demo video
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: "live-assets/video-tmp", size: { width: 1280, height: 800 } } });
const page = await ctx.newPage();
const scrollThrough = async () => {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 80) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), y);
    await page.waitForTimeout(750);
  }
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await page.waitForTimeout(1500);
};
await page.goto(BASE);
await page.waitForTimeout(3000);
await page.locator("#text").click();
await page.locator("#text").fill("");
await page.keyboard.type(GENZ_TEXT, { delay: 70 });
await page.waitForTimeout(800);
const genz = page.waitForResponse((r) => r.url().endsWith("/api/check"), { timeout: 90000 });
await page.getByRole("button", { name: "Check this persona" }).click();
await genz;
await page.waitForSelector(".ring", { timeout: 90000 });
await page.waitForTimeout(2500);
await scrollThrough();
await runExample(page, "Outdoor gear shop");
await page.waitForTimeout(500);
await scrollThrough();
const video = page.video();
await ctx.close();
await rename(await video.path(), "live-assets/demo.webm");
for (const f of await readdir("live-assets/video-tmp")) console.log("leftover video:", f);

await browser.close();
console.log("done");
