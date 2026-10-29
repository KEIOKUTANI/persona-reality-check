// Offline checks: sample mode, the text extractor, and the live Qloo code path against a mock server.
import assert from "node:assert/strict";
import { startMock } from "./mock-qloo.mjs";

const mock = await startMock();
process.env.QLOO_BASE_URL = mock.url;

const { analyze } = await import("../lib/analyze.mjs");
const { extractPersona, writeMemo } = await import("../lib/llm.mjs");
const qloo = await import("../lib/qloo.mjs");

// 1. sample mode
assert.equal(qloo.qlooEnabled(), false);
const gz = await analyze({ age: "24_and_younger", interests: ["Kissaten culture", "Golf", "Taylor Swift"], assumes: ["Doutor Coffee"] });
assert.equal(gz.mode, "sample");
assert.ok(gz.score < 60, `Gen Z kissaten should score low, got ${gz.score}`);
assert.ok(gz.flags.some((f) => f.kind === "age"));
const trail = await analyze({ age: "35_to_44", interests: ["Snow Peak", "Patagonia", "Trail running"], assumes: ["The North Face"] });
assert.ok(trail.score > gz.score);
await assert.rejects(analyze({ interests: ["Nope"] }), /two interests/);

// 2. text extraction (rules, no LLM key)
const ex = await extractPersona("ターゲットはZ世代。喫茶店巡りとゴルフ、テイラー・スウィフトが好き。ドトールにも行くはず。");
assert.deepEqual([ex.age, ex.interests, ex.assumes], ["24_and_younger", ["Kissaten culture", "Golf", "Taylor Swift"], ["Doutor Coffee"]]);
const memo = await writeMemo(gz.persona, gz);
assert.match(memo.text, /don't hold up/);

// 3. live path against the mock
process.env.QLOO_API_KEY = "test-key";
const r = await analyze({ age: "25_to_29", gender: "female", location: "Sapporo", interests: ["Glamping", "Lululemon", "Blue Bottle Coffee"], assumes: ["Snow Peak", "Aeon Mall"] });
assert.equal(r.mode, "live");
assert.equal(r.unknown.length, 0);
assert.equal(r.audiences.filter((a) => a.age).length, 3);
assert.ok(r.flags.some((f) => f.kind === "assume" && /Aeon Mall/.test(f.text) && f.level === "bad"));
assert.ok(r.flags.some((f) => f.kind === "assume" && /Snow Peak/.test(f.text) && f.level === "ok"));
assert.equal(r.realistic.age, "25–29");
assert.ok(mock.calls.some((c) => c.params["signal.location.query"] === "Sapporo"), "location should reach Qloo");
assert.ok(mock.calls.every((c) => c.key === "test-key"));

mock.server.close();
console.log(`ok: sample (${gz.score} vs ${trail.score}), extractor, live path (${mock.calls.length} mock Qloo calls, score ${r.score})`);
