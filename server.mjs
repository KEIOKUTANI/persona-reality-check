// Persona Reality Check server. Zero dependencies: node server.mjs
import { serve } from "./lib/serve.mjs";
import { analyze, normalize, revise, competitors, agesLabel, jaAge } from "./lib/analyze.mjs";
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

// What to do with the corrected persona: concrete, Qloo-backed next moves.
function nextSteps(r) {
  const fits = r.assumed?.filter((a) => a.affinity !== null && a.affinity >= (r.thresholds?.assume ?? 0.5)).map((a) => a.name) || [];
  const partners = [...new Set([...fits, ...(r.realistic.alsoLike || []).map((x) => x.name)])].slice(0, 4);
  const p = r.persona;
  return [
    partners.length && { en: `Partner, sponsor or co-promote with: ${partners.join(", ")}. Their fans overlap with this persona.`, ja: `提携・スポンサー・共同企画の候補：${partners.join("、")}。この想定客とファンが重なります。` },
    { en: `Use ${p.interests.slice(0, 2).join(" and ")} in your copy, visuals and content: they are what these people share.`, ja: `宣伝文・画像・コンテンツでは ${p.interests.slice(0, 2).join(" と ")} を使う：この人たちの共通点です。` },
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
      // Two ways to fix it (move the age to the interests, or keep the age and swap the interests): check both, keep the better,
      // and only show it if it actually beats the user's persona.
      let revision = null;
      const fixes = [revise(result.persona, result), revise(result.persona, result, { keepAge: true })]
        .filter((f, i, all) => f.changes.length && all.findIndex((g) => JSON.stringify(g.persona) === JSON.stringify(f.persona)) === i);
      const checked = await Promise.all(fixes.map((f) => analyze(f.persona).then((again) => ({ fix: f, again })).catch(() => null)));
      const best = checked.filter(Boolean).sort((a, b) => b.again.score - a.again.score)[0];
      if (best && best.again.score > result.score) {
        const { fix, again } = best;
        revision = { persona: again.persona, changes: fix.changes, score: again.score, parts: again.parts, flags: again.flags, alsoLike: again.realistic.alsoLike, sentence: sentence(again.persona, again) };
        result.steps.push(`Built ${fixes.length} corrected persona${fixes.length > 1 ? "s" : ""}, re-checked with Qloo and kept the best: ${result.score} → ${again.score}`);
      } else if (fixes.length) result.steps.push(`Tried ${fixes.length} corrected personas; none scored higher than yours (${result.score}), so yours stays`);
      const next = nextSteps(revision ? { ...result, persona: revision.persona, realistic: { ...result.realistic, alsoLike: revision.alsoLike } } : result);
      // Agent loop, step 3: who already wins these people (models to copy) and who competes for them.
      const rivals = await competitors(revision ? revision.persona : result.persona).catch(() => null);
      if (rivals) result.steps.push(`${result.mode === "live" ? "Qloo insights: " : ""}${rivals.models.length + rivals.rivals.length} competitors this persona over-indexes on (${rivals.kind})`);
      return { extracted, result, memo, revision, next, competitors: rivals };
    },
  },
});
