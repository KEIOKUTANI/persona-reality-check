// Persona Reality Check server. Zero dependencies: node server.mjs
import { serve } from "./lib/serve.mjs";
import { analyze, normalize, revisionOptions, competitors, agesLabel, jaAge } from "./lib/analyze.mjs";
import { qlooEnabled, recentCalls } from "./lib/qloo.mjs";
import { catalog } from "./lib/sample-taste.mjs";
import { extractPersona, writeMemo, llmEnabled, llmModel } from "./lib/llm.mjs";

// One line a planner can paste into the plan, in English and Japanese.
function sentence(p, r) {
  const g = { any: ["", ""], female: [" women", "女性"], male: [" men", "男性"] }[p.gender];
  const also = (r.realistic.alsoLike || []).slice(0, 3).map((x) => x.name);
  return {
    en: `Target customer:${g[0]} aged ${agesLabel(p.ages)}${p.location ? ` in ${p.location}` : ""} who are into ${p.interests.join(", ")}${p.assumes.length ? `, and also like ${p.assumes.join(", ")}` : ""}.${also.length ? ` The same people over-index on ${also.join(", ")}.` : ""}`,
    ja: `ターゲット：${p.location ? `${p.location}の` : ""}${jaAge(agesLabel(p.ages))}${g[1] ? `の${g[1]}` : ""}で、${p.interests.join("、")}が好きな人${p.assumes.length ? `。${p.assumes.join("、")}も好む` : ""}。${also.length ? `同じ層は ${also.join("、")} もよく好む。` : ""}`,
  };
}

// What to do with the corrected persona: only things Qloo found, never the user's own inputs played back.
function nextSteps(r, mine) {
  const own = new Set([...mine.interests, ...mine.assumes].map((n) => n.toLowerCase()));
  const found = [...new Set([...r.persona.interests, ...(r.realistic.alsoLike || []).map((x) => x.name)])].filter((n) => !own.has(n.toLowerCase()));
  const partners = found.slice(0, 4);
  const hooks = found.slice(0, 2);
  const p = r.persona;
  return [
    partners.length && { en: `Partner, sponsor or co-promote with: ${partners.join(", ")}. Qloo shows these people over-index on them, though your plan didn't name them.`, ja: `提携・広告・共同企画の候補：${partners.join("、")}。計画書には無かったが、この層がよく好むと Qloo が示したものです。` },
    hooks.length && { en: `Try ${hooks.join(" and ")} as topics, collabs or references in your content and ads, and see which gets more response.`, ja: `${hooks.join(" や ")} をコンテンツや広告のネタ・コラボ・例えに使ってみて、どちらが反応が良いか比べる。` },
    { en: `Target ads and outreach at ages ${agesLabel(p.ages)}${p.gender !== "any" ? `, ${p.gender}` : ""}.`, ja: `広告や声かけの対象は ${jaAge(agesLabel(p.ages))}${p.gender !== "any" ? `・${p.gender === "female" ? "女性" : "男性"}` : ""}に絞る。` },
    { en: "Paste the corrected persona into your plan, then test it with 5–10 real customers before you spend on it.", ja: "修正版の想定客を計画書に貼り、お金をかける前に実際のお客さん5〜10人で確かめる。" },
  ].filter(Boolean);
}

serve({
  name: "Persona Reality Check",
  dir: import.meta.dirname,
  routes: {
    "GET /api/health": async () => ({ ok: true }),
    // Last Qloo calls (no key) and the Node version, to compare a hosted run with a local one.
    "GET /api/debug": async () => ({ node: process.version, calls: recentCalls }),
    "GET /api/config": async () => ({
      mode: qlooEnabled() ? "live" : "sample",
      llm: llmEnabled() ? llmModel() : null,
      catalog: qlooEnabled() ? [] : catalog(),
    }),
    // Body: { text } (a business-plan excerpt) or { persona }. The agent extracts, checks and writes a memo.
    "POST /api/check": async (body) => {
      const steps = [];
      let persona = body.persona;
      let extracted = null;
      if (!persona) {
        const text = String(body.text || "").trim();
        if (text.length < 20) throw Object.assign(new Error("Paste a few sentences describing your target customer."), { status: 400 });
        extracted = await extractPersona(text);
        persona = extracted;
        steps.push(`Read the plan and extracted the persona (${extracted.by})`);
      }
      const result = await analyze(normalize(persona));
      const memo = await writeMemo(result.persona, result);
      result.steps = [...steps, ...result.steps, `Wrote the reviewer memo (${memo.by})`];
      // Agent loop, step 2: build a corrected persona from the evidence and check it again.
      // Several ways to fix it (keep the age and swap interests, or move the age to one interest's fans or the whole mix).
      // Each is re-checked with Qloo; the user picks one, and the best score is shown first.
      const fixes = revisionOptions(result.persona, result);
      const checked = (await Promise.all(fixes.map((f) => analyze(f.persona).then((again) => ({ f, again })).catch(() => null)))).filter(Boolean);
      const options = checked.map(({ f, again }) => ({ label: { en: f.en, ja: f.ja }, persona: again.persona, changes: f.changes, score: again.score, parts: again.parts, flags: again.flags, alsoLike: again.realistic.alsoLike, sentence: sentence(again.persona, again) }))
        .sort((a, b) => b.score - a.score);
      const revision = options[0] || null;
      if (options.length) result.steps.push(`Built ${options.length} corrected persona${options.length > 1 ? "s" : ""} and re-checked them with Qloo: ${options.map((o) => o.score).join(", ")} (yours: ${result.score})`);
      const nextFor = (o) => nextSteps(o ? { ...result, persona: o.persona, realistic: { ...result.realistic, alsoLike: o.alsoLike } } : result, result.persona);
      for (const o of options) o.next = nextFor(o);
      const next = nextFor(revision);
      // Agent loop, step 3: who already wins these people (models to copy) and who competes for them.
      const rivals = await competitors(revision ? revision.persona : result.persona).catch(() => null);
      if (rivals) result.steps.push(`${result.mode === "live" ? "Qloo insights: " : ""}${rivals.models.length + rivals.rivals.length} competitors this persona over-indexes on (${rivals.kind})`);
      return { extracted, result, memo, revision, options, next, competitors: rivals };
    },
  },
});
