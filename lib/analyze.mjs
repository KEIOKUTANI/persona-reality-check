// Persona Reality Check: does a business plan's target customer hang together as a real taste cluster?
// Two data sources share one scoring step:
//   live   - Qloo Taste AI (search, insights affinities, demographics, neighbors)
//   sample - hand-made demo data in sample-taste.mjs, clearly labelled, used when QLOO_API_KEY is not set
import * as qloo from "./qloo.mjs";
import { AGE_BUCKETS, AGE_LABEL, ENTITIES, entity, centroid, affinity } from "./sample-taste.mjs";

const pct = (x) => Math.round(x * 100);
const clean = (xs, n) => (xs || []).map((s) => String(s).trim()).filter(Boolean).slice(0, n);
// Below these, a link is flagged. Qloo affinities and the sample model both run 0..1.
const PAIR_MIN = Number(process.env.PAIR_MIN || 0.45);
const ASSUME_MIN = Number(process.env.ASSUME_MIN || 0.5);

export function normalize(input) {
  return {
    age: AGE_BUCKETS.includes(input.age) ? input.age : "25_to_29",
    gender: ["female", "male", "any"].includes(input.gender) ? input.gender : "any",
    location: String(input.location || "").trim().slice(0, 60),
    interests: clean(input.interests, 4),
    assumes: clean(input.assumes, 3),
  };
}

export async function analyze(input) {
  const p = normalize(input);
  if (p.interests.length < 2) throw Object.assign(new Error("Add at least two interests."), { status: 400 });
  const ev = qloo.qlooEnabled() ? await liveEvidence(p) : sampleEvidence(p);
  return score(p, ev);
}

// ---- evidence: sample -------------------------------------------------------
function sampleEvidence(p) {
  const steps = ["Sample mode: hand-made taste data, not Qloo"];
  const ints = p.interests.map((n) => entity(n));
  const unknown = [...p.interests.filter((n, i) => !ints[i]), ...p.assumes.filter((n) => !entity(n))];
  const known = ints.filter(Boolean);
  if (known.length < 2) throw Object.assign(new Error(`Sample mode only knows: ${Object.keys(ENTITIES).join(", ")}`), { status: 400 });
  steps.push(`Looked up ${known.length} interests${p.location ? ` (location "${p.location}" is ignored in sample mode)` : ""}`);
  const pairs = [];
  for (let i = 0; i < known.length; i++) for (let j = i + 1; j < known.length; j++) pairs.push({ a: known[i].name, b: known[j].name, affinity: affinity(known[i].v, known[j].v) });
  const c = centroid(known.map((e) => e.v));
  const assumed = p.assumes.filter((n) => entity(n)).map((n) => { const e = entity(n); return { name: e.name, affinity: affinity(c, e.v) }; });
  const inputs = new Set([...known.map((e) => e.name), ...assumed.map((a) => a.name)]);
  const alsoLike = Object.entries(ENTITIES).filter(([n, e]) => !inputs.has(n) && e.type === "brand")
    .map(([n, e]) => ({ name: n, affinity: affinity(c, e.v) })).sort((x, y) => y.affinity - x.affinity).slice(0, 5);
  return { mode: "sample", steps, unknown, pairs, assumed, alsoLike,
    audiences: known.map((e) => ({ name: e.name, age: e.age, female: e.female })) };
}

// ---- evidence: live Qloo ----------------------------------------------------
async function liveEvidence(p) {
  const steps = [];
  const look = async (n) => ({ input: n, e: await qloo.search(n).catch(() => null) });
  const resolved = await Promise.all([...p.interests, ...p.assumes].map(look));
  const ints = resolved.slice(0, p.interests.length).filter((r) => r.e).map((r) => r.e);
  const ass = resolved.slice(p.interests.length).filter((r) => r.e).map((r) => r.e);
  const unknown = resolved.filter((r) => !r.e).map((r) => r.input);
  steps.push(`Qloo /search resolved ${ints.length + ass.length} of ${resolved.length} names: ${[...ints, ...ass].map((e) => `${e.name} (${e.type})`).join(", ")}`);
  if (ints.length < 2) throw Object.assign(new Error(`Qloo couldn't find enough of these interests (${unknown.join(", ")}). Try more specific names.`), { status: 400 });

  // Who is each interest's audience?
  const demo = await Promise.all(ints.map((e) => qloo.demographics([e.entity_id]).then((d) => d[0]).catch(() => null)));
  const audiences = ints.map((e, i) => {
    const d = demo[i];
    if (!d) return { name: e.name, age: null, female: null };
    const g = d.gender || {};
    const female = g.female !== undefined || g.male !== undefined ? Math.min(1, Math.max(0, 0.5 + ((g.female || 0) - (g.male || 0)) / 2)) : null;
    return { name: e.name, age: AGE_BUCKETS.map((b) => Number(d.age?.[b] ?? 0)), female };
  });
  steps.push(`Qloo insights (urn:demographics): age and gender skew of ${audiences.filter((a) => a.age).length} interest audiences`);

  // Do fans of one interest also like the others?
  const pairs = [];
  for (let i = 0; i < ints.length; i++) {
    const others = ints.slice(i + 1);
    if (!others.length) continue;
    const byType = Object.groupBy(others, (o) => o.type || "brand");
    for (const [type, group] of Object.entries(byType)) {
      const aff = await qloo.affinities({ signalIds: [ints[i].entity_id], targetType: type, shortlistIds: group.map((o) => o.entity_id) }).catch(() => ({}));
      for (const o of group) pairs.push({ a: ints[i].name, b: o.name, affinity: aff[o.entity_id] ?? null });
    }
  }
  steps.push(`Qloo insights: cross-affinity for ${pairs.length} interest pairs`);

  // Does the plan's assumption hold for this persona?
  const signal = ints.map((e) => e.entity_id);
  const demoSignal = { age: p.age, gender: p.gender === "any" ? undefined : p.gender, location: p.location || undefined };
  let assumed = [];
  if (ass.length) {
    const byType = Object.groupBy(ass, (a) => a.type || "brand");
    const aff = {};
    for (const [type, group] of Object.entries(byType)) Object.assign(aff, await qloo.affinities({ signalIds: signal, targetType: type, shortlistIds: group.map((e) => e.entity_id), ...demoSignal }).catch(() => ({})));
    assumed = ass.map((e) => ({ name: e.name, affinity: aff[e.entity_id] ?? null }));
    steps.push(`Qloo insights: affinity of ${assumed.length} assumed brands for this persona${p.location ? ` in ${p.location}` : ""}`);
  }
  const alsoLike = await qloo.neighbors({ signalIds: signal, targetType: "brand", ...demoSignal, take: 5 }).catch(() => []);
  steps.push("Qloo insights: brands this exact taste mix over-indexes on");
  return { mode: "live", steps, unknown, pairs, assumed, alsoLike, audiences };
}

// ---- shared scoring -----------------------------------------------------------
function score(p, ev) {
  const b = AGE_BUCKETS.indexOf(p.age);
  const flags = [];
  const withAge = ev.audiences.filter((a) => a.age);

  for (const a of withAge) {
    if (a.age[b] < -0.1) {
      const best = AGE_BUCKETS[a.age.indexOf(Math.max(...a.age))];
      flags.push({ level: "bad", kind: "age", text: `${a.name} fans skew ${AGE_LABEL[best]}, not ${AGE_LABEL[p.age]}.` });
    }
  }
  const withGender = ev.audiences.filter((a) => a.female !== null && a.female !== undefined);
  let genderScore = 1;
  if (p.gender !== "any" && withGender.length) {
    const share = withGender.reduce((s, a) => s + (p.gender === "female" ? a.female : 1 - a.female), 0) / withGender.length;
    genderScore = Math.min(1, share / 0.5);
    if (share < 0.4) flags.push({ level: "warn", kind: "gender", text: `These interests lean ${p.gender === "female" ? "male" : "female"} (${pct(1 - share)}%).` });
  }
  for (const x of ev.pairs) if (x.affinity !== null && x.affinity < PAIR_MIN) flags.push({ level: "bad", kind: "pair", text: `People who like ${x.a} rarely also like ${x.b} (affinity ${pct(x.affinity)}).` });
  for (const a of ev.assumed) {
    if (a.affinity === null) continue;
    flags.push(a.affinity < ASSUME_MIN
      ? { level: "bad", kind: "assume", text: `The plan assumes they like ${a.name}, but this taste cluster's affinity is only ${pct(a.affinity)}.` }
      : { level: "ok", kind: "assume", text: `${a.name} fits this cluster (affinity ${pct(a.affinity)}).` });
  }

  const avg = (xs, d) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : d);
  const ageCurve = withAge.length ? AGE_BUCKETS.map((k, i) => ({ age: AGE_LABEL[k], skew: avg(withAge.map((a) => a.age[i]), 0) })) : null;
  const ageScore = withAge.length ? avg(withAge.map((a) => Math.min(1, Math.max(0, (a.age[b] + 1) / 2))), 0.5) : 0.5;
  const coherence = avg(ev.pairs.filter((x) => x.affinity !== null).map((x) => x.affinity), 0.5);
  const assumeScore = avg(ev.assumed.filter((x) => x.affinity !== null).map((x) => x.affinity), coherence);
  const total = Math.round(100 * (0.3 * ageScore + 0.15 * genderScore + 0.25 * coherence + 0.3 * assumeScore));

  const curve = ageCurve?.map((a) => a.skew);
  const realAge = curve ? AGE_BUCKETS[curve.indexOf(Math.max(...curve))] : null;
  const female = withGender.length ? pct(avg(withGender.map((a) => a.female), 0.5)) : undefined;
  return {
    mode: ev.mode, persona: p,
    steps: [...ev.steps, `Scored: age fit ${pct(ageScore)}, gender fit ${pct(genderScore)}, interest coherence ${pct(coherence)}, assumption fit ${pct(assumeScore)}`],
    score: total, parts: { age: pct(ageScore), gender: pct(genderScore), coherence: pct(coherence), assumptions: pct(assumeScore) },
    flags, pairs: ev.pairs, assumed: ev.assumed, unknown: ev.unknown, ageCurve, audiences: ev.audiences,
    realistic: { age: realAge ? AGE_LABEL[realAge] : null, female, alsoLike: ev.alsoLike },
  };
}
