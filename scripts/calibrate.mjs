// Prints raw Qloo evidence for personas we expect to pass or fail, to tune PAIR_MIN / ASSUME_MIN.
//   node --env-file=.env scripts/calibrate.mjs
import { analyze } from "../lib/analyze.mjs";

const CASES = [
  ["expect real", { age: "35_to_44", interests: ["Snow Peak", "Patagonia", "The North Face"], assumes: ["Arc'teryx", "MUJI"] }],
  ["expect real", { age: "25_to_29", gender: "female", interests: ["Lululemon", "Blue Bottle Coffee", "Aesop"], assumes: ["Glossier", "Hermès"] }],
  ["expect mixed", { age: "25_to_29", gender: "female", location: "Sapporo", interests: ["Glamping", "Lululemon", "Blue Bottle Coffee"], assumes: ["Snow Peak", "Aeon Mall"] }],
  ["expect wish", { age: "24_and_younger", interests: ["Golf", "Taylor Swift", "The Godfather"], assumes: ["Doutor Coffee"] }],
  ["expect wish", { age: "55_and_older", interests: ["Nintendo Switch", "Supreme", "Komeda Coffee"], assumes: ["Hermès"] }],
  ["expect wish", { age: "45_to_54", gender: "male", interests: ["Harley-Davidson", "BTS", "Sanrio"], assumes: ["Glossier"] }],
];
const f = (x) => (x === null || x === undefined ? "n/a" : x.toFixed(2));
for (const [expect, p] of CASES) {
  try {
    const r = await analyze(p);
    console.log(`\n### ${expect}: ${p.interests.join(" + ")} | ${p.age} ${p.gender || ""} -> SCORE ${r.score}`, JSON.stringify(r.parts));
    console.log("resolved:", r.steps[0]);
    console.log("pairs:", r.pairs.map((x) => `${x.a}×${x.b}=${f(x.affinity)}`).join("  "));
    console.log("assumed:", r.assumed.map((x) => `${x.name}=${f(x.affinity)}`).join("  "), "| unknown:", r.unknown.join(", ") || "-");
    for (const a of r.audiences) console.log(`  age ${a.name}:`, a.age ? a.age.map((v) => v.toFixed(2)).join(" ") : "n/a", "female", f(a.female));
    console.log("flags:", r.flags.map((x) => `[${x.level}] ${x.text}`).join(" / "));
    console.log("also:", r.realistic.alsoLike.map((x) => `${x.name}=${f(x.affinity)}`).join(", "));
  } catch (e) { console.log(`\n### ${expect}: ${p.interests.join(" + ")} -> ERROR ${e.message}`); }
}
