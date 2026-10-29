// Optional LLM layer (OpenAI-compatible, default NVIDIA Nemotron on Nebius Token Factory).
// 1. extractPersona: business-plan text -> structured persona.
// 2. writeMemo: Qloo evidence -> a short "fix your persona" memo.
// Without LLM_API_KEY both fall back to simple rules, so the app always works.
import { AGE_BUCKETS, ENTITIES } from "./sample-taste.mjs";

const cfg = {
  baseUrl: (process.env.LLM_BASE_URL || "https://api.tokenfactory.nebius.com/v1").replace(/\/+$/, ""),
  apiKey: process.env.LLM_API_KEY || process.env.NEBIUS_API_KEY || "",
  model: process.env.LLM_MODEL || "nvidia/nemotron-3-super-120b-a12b",
};
export const llmEnabled = () => Boolean(cfg.apiKey);
export const llmModel = () => cfg.model;

async function chat(messages, maxTokens = 1200) {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const content = (await res.json()).choices?.[0]?.message?.content || "";
  return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function firstJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("LLM did not return JSON");
  return JSON.parse(m[0]);
}

const EXTRACT_PROMPT = `You read the "target customer" part of a business plan (any language) and return ONLY JSON:
{"age": one of ${JSON.stringify(AGE_BUCKETS)}, "gender": "female"|"male"|"any",
 "location": "city or region named in the plan, or empty",
 "interests": ["2-4 concrete things the plan says these customers are into: brands, artists, films, shows, places, hobbies"],
 "assumes": ["0-3 brands or places the plan expects them to also like, buy from, or compare us to"],
 "quote": "the sentence you based this on, verbatim"}
Use proper names in English spelling (e.g. 無印良品 -> MUJI, スノーピーク -> Snow Peak). Do not invent interests the plan doesn't state.`;

export async function extractPersona(text) {
  if (llmEnabled()) {
    const out = firstJson(await chat([{ role: "system", content: EXTRACT_PROMPT }, { role: "user", content: text.slice(0, 4000) }], 600));
    return { ...out, by: `LLM (${cfg.model})` };
  }
  return { ...ruleExtract(text), by: "keyword rules (no LLM key set)" };
}

// Offline fallback: finds known names, an age phrase and a gender word.
const JA_NAMES = { "無印": "MUJI", "ユニクロ": "Uniqlo", "スノーピーク": "Snow Peak", "パタゴニア": "Patagonia", "ノースフェイス": "The North Face", "エルメス": "Hermès",
  "ルイ・ヴィトン": "Louis Vuitton", "スタバ": "Starbucks", "スターバックス": "Starbucks", "ブルーボトル": "Blue Bottle Coffee", "ドトール": "Doutor Coffee", "コメダ": "Komeda Coffee",
  "喫茶店": "Kissaten culture", "ジブリ": "Studio Ghibli", "村上春樹": "Haruki Murakami", "フジロック": "Fuji Rock Festival", "テイラー・スウィフト": "Taylor Swift",
  "グランピング": "Glamping", "トレイルラン": "Trail running", "ゴルフ": "Golf", "セブン": "Seven-Eleven", "イオン": "Aeon Mall", "蔦屋": "Tsutaya Books", "ルルレモン": "Lululemon", "任天堂": "Nintendo", "アップル": "Apple",
  "ゴッドファーザー": "The Godfather", "ハーレー": "Harley-Davidson", "サンリオ": "Sanrio", "シュプリーム": "Supreme", "アークテリクス": "Arc'teryx", "イソップ": "Aesop", "グロッシアー": "Glossier" };
function ruleExtract(text) {
  const found = [];
  const add = (name, at) => { if (!found.some((f) => f.name.toLowerCase().includes(name.toLowerCase()))) found.push({ name, at }); };
  for (const name of Object.keys(ENTITIES)) { const i = text.toLowerCase().indexOf(name.toLowerCase()); if (i >= 0) add(name, i); }
  for (const [ja, name] of Object.entries(JA_NAMES)) { const i = text.indexOf(ja); if (i >= 0) add(name, i); }
  // Unknown names: anything in 「」『』"" quotes, and runs of Capitalized words (not at a sentence start).
  for (const m of text.matchAll(/[「『"“]([^」』"”]{2,40})[」』"”]/g)) if (!JA_NAMES[m[1].trim()]) add(m[1].trim(), m.index);
  const STOP = /^(Our|We|They|The|Their|Customers?|Women|Men|People|In|And|Also|So|Target|Gen|Z)$/;
  for (const m of text.matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][\w'’&-]*(?:\s+(?:&\s+)?[A-Z][\w'’&-]*)*)/g)) {
    const words = m[1].split(/\s+/).filter((w) => !STOP.test(w));
    if (words.length && !/^\d/.test(words[0])) add(words.join(" "), m.index);
  }
  const LOC = /^(Hokkaido|Sapporo|Tokyo|Kyoto|Osaka|Nagano|Fukuoka|Okinawa|Japan)$/i;
  for (let i = found.length - 1; i >= 0; i--) if (LOC.test(found[i].name)) found.splice(i, 1);
  found.sort((a, b) => a.at - b.at);
  // A sentence with "assume / expect / 想定 / はず" holds the plan's assumptions; the rest are interests.
  const cue = /assum|expect|will also|so they|想定|はず|だろう|見込/i;
  const sentences = text.split(/(?<=[.!?。！？\n])/);
  let pos = 0;
  const ranges = sentences.map((s) => { const r = { from: pos, to: pos + s.length, assume: cue.test(s) }; pos += s.length; return r; });
  const isAssume = (at) => ranges.find((r) => at >= r.from && at < r.to)?.assume;
  const interests = found.filter((f) => !isAssume(f.at)).map((f) => f.name);
  const assumes = found.filter((f) => isAssume(f.at)).map((f) => f.name);
  let age = "25_to_29";
  const under = text.match(/(\d{2})\s*(?:歳|years?)?\s*(?:以下|未満|and under|or younger)/i);
  const over = text.match(/(\d{2})\s*(?:歳|years?)?\s*(?:以上|and over|or older|\+)/i);
  const n = text.match(/(\d{2})\s*(?:-|–|~|〜|to)\s*(\d{2})/) || text.match(/(\d)0代(前半|後半)?/) || text.match(/(\d)0s/);
  if (under && Number(under[1]) <= 24) age = "24_and_younger";
  else if (over && Number(over[1]) >= 55) age = "55_and_older";
  else if (n) {
    const lo = n[0].includes("代") || n[0].endsWith("s") ? Number(n[1]) * 10 + (n[2] === "後半" ? 5 : 0) : Number(n[1]);
    age = lo < 25 ? "24_and_younger" : lo < 30 ? "25_to_29" : lo < 35 ? "30_to_34" : lo < 45 ? "35_to_44" : lo < 55 ? "45_to_54" : "55_and_older";
  } else if (/gen ?z|z世代|学生|student|若者|teen/i.test(text)) age = "24_and_younger";
  const gender = /女性|women|female|ママ|mothers/i.test(text) ? "female" : /男性|\bmen\b|male/i.test(text) ? "male" : "any";
  const loc = text.match(/(Hokkaido|Sapporo|Tokyo|Kyoto|Osaka|Nagano|Fukuoka|Okinawa|北海道|札幌|東京|京都|大阪|長野|福岡|沖縄)/i);
  return { age, gender, location: loc ? loc[1] : "", interests: interests.slice(0, 4), assumes: assumes.slice(0, 3), quote: "" };
}

export async function writeMemo(persona, result) {
  if (llmEnabled()) {
    try {
      return { by: `LLM (${cfg.model})`, text: await chat([
        { role: "system", content: "You are a blunt but kind business-plan reviewer at a Japanese chamber of commerce. Using ONLY the Qloo evidence given, write a short memo (max 120 words, plain English, no headings): what does not hold up in this target persona, what the evidence says the real audience looks like, and one concrete fix to the plan. Phrase findings as aggregate patterns, never claims about individuals. Do not invent numbers." },
        { role: "user", content: JSON.stringify({ persona, score: result.score, flags: result.flags, pairs: result.pairs, assumed: result.assumed, realistic: result.realistic }) },
      ], 500) };
    } catch (e) { /* fall through to the template */ }
  }
  const bad = result.flags.filter((f) => f.level === "bad");
  const r = result.realistic || {};
  const also = (r.alsoLike || []).slice(0, 3).map((x) => x.name).join(", ");
  const text = bad.length
    ? `${bad.length === 1 ? "1 part of this persona doesn't" : `${bad.length} parts of this persona don't`} hold up: ${bad.map((f) => f.text.replace(/\.$/, "")).join("; ")}. ` +
      `${r.age ? `The interests you listed mostly point to people aged ${r.age}${r.female !== undefined ? `, about ${r.female}% female` : ""}. ` : ""}` +
      `${also ? `That audience also leans toward ${also}. ` : ""}Fix: either change the target age to match the interests, or replace the interests that don't fit with ones this age group actually shares.`
    : `The interests and assumptions in this persona hang together. ${also ? `The same audience also leans toward ${also}, which could be useful for partners or marketing.` : ""}`;
  return { by: "template (no LLM key set)", text };
}
