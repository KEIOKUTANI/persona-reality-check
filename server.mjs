// Persona Reality Check server. Zero dependencies: node server.mjs
import { serve } from "./lib/serve.mjs";
import { analyze, normalize } from "./lib/analyze.mjs";
import { qlooEnabled, recentCalls } from "./lib/qloo.mjs";
import { catalog } from "./lib/sample-taste.mjs";
import { extractPersona, writeMemo, llmEnabled, llmModel } from "./lib/llm.mjs";

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
      return { extracted, result, memo };
    },
  },
});
