// Live check against the real Qloo API. Needs QLOO_API_KEY (from .env). Prints shapes and results, never the key.
//   node --env-file=.env scripts/smoke-live.mjs
import * as qloo from "../lib/qloo.mjs";
import { analyze } from "../lib/analyze.mjs";

if (!qloo.qlooEnabled()) { console.error("QLOO_API_KEY is not set. Add it to .env first."); process.exit(1); }
console.log("Qloo base:", process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com");

const e = await qloo.search("Patagonia");
console.log("search Patagonia ->", e);
if (!e) process.exit(1);
console.log("demographics ->", JSON.stringify(await qloo.demographics([e.entity_id])).slice(0, 400));

for (const p of [
  { age: "25_to_29", gender: "female", location: "Sapporo", interests: ["Lululemon", "Blue Bottle Coffee", "Snow Peak"], assumes: ["Hermès", "Aeon Mall"] },
  { age: "24_and_younger", gender: "any", interests: ["The Godfather", "Golf", "Taylor Swift"], assumes: ["Doutor Coffee"] },
]) {
  const r = await analyze(p);
  console.log(`\n${p.interests.join(" + ")} (${p.age}) -> score ${r.score}`, r.parts);
  for (const f of r.flags) console.log(`  [${f.level}] ${f.text}`);
  console.log("  pairs:", r.pairs.map((x) => `${x.a}×${x.b}=${x.affinity}`).join(", "));
  console.log("  also like:", r.realistic.alsoLike.map((x) => x.name).join(", "), "| unknown:", r.unknown.join(", ") || "none");
}
