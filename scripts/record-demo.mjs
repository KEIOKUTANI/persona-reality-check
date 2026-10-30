// Records the judge-video screen capture of a running server: the Hackathon Hunter plan, the corrected-persona
// options, next steps and competitors. Writes live-assets/demo2.webm and demo2-marks.json (seconds of each scene,
// used by make-judge-video.py to place captions).
// Usage: start the server (live mode), then: node scripts/record-demo.mjs [baseUrl]
import { chromium } from "playwright";
import { mkdir, writeFile, rename, readdir, rm } from "node:fs/promises";

const BASE = process.argv[2] || "http://localhost:5191";
const TEXT = "「ハッカソンハンター」というYouTubeチャンネルの視聴者は、25〜34歳の男性エンジニアで、シリコンバレーやアップル、ニンテンドースイッチが好き。スターバックスやUdemyもよく使うはず。";
const TMP = "live-assets/video-tmp2";
await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });

// Warm Qloo's cache first so the recorded run doesn't sit on a spinner.
await fetch(`${BASE}/api/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: TEXT }) });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: TMP, size: { width: 1280, height: 800 } } });
const pg = await ctx.newPage();
const t0 = Date.now();
const marks = {};
const mark = (k) => (marks[k] = (Date.now() - t0) / 1000);
const wait = (ms) => pg.waitForTimeout(ms);
const show = async (sel, ms) => { await pg.$eval(sel, (e) => e.scrollIntoView({ behavior: "smooth", block: "start" })); await wait(ms); };

await pg.goto(`${BASE}/?lang=en`);
await wait(1500); mark("start");
await pg.click("#text");
await pg.keyboard.insertText(TEXT);
await wait(2500); mark("check");
await pg.click("textarea#text ~ div button");
await pg.waitForSelector(".fix", { timeout: 60000 }); mark("result");
await wait(5000); mark("score");
await show(".fix", 4500); mark("fix");
await pg.click('[data-pick="1"]'); await wait(4000); mark("opt2");
await pg.click('[data-pick="0"]'); await wait(3500); mark("opt1");
await show(".comp", 5500); mark("comp");
await show(".next", 5500); mark("next");
await show("ol.steps", 4500); mark("end");

await ctx.close(); await browser.close();
const [file] = await readdir(TMP);
await rename(`${TMP}/${file}`, "live-assets/demo2.webm");
await rm(TMP, { recursive: true, force: true });
await writeFile("live-assets/demo2-marks.json", JSON.stringify(marks, null, 2));
console.log(marks);
