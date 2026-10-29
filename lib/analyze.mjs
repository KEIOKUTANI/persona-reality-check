// Persona Reality Check: does a business plan's target customer hang together as a real taste cluster?
// Two data sources share one scoring step:
//   live   - Qloo Taste AI (search, insights affinities, demographics, neighbors)
//   sample - hand-made demo data in sample-taste.mjs, clearly labelled, used when QLOO_API_KEY is not set
import * as qloo from "./qloo.mjs";
import { AGE_BUCKETS, AGE_LABEL, ENTITIES, entity, centroid, affinity } from "./sample-taste.mjs";

const pct = (x) => Math.round(x * 100);
const clean = (xs, n) => (xs || []).map((s) => String(s).trim()).filter(Boolean).slice(0, n);
// Calibration per data source. Live Qloo affinities sit in a narrow high band (0.6-0.96), so they are
// rescaled between lo and hi before scoring. Live values come from 6 known-good / known-bad personas
// (scripts/calibrate.mjs, 2026-10-29): good pairs 0.75-0.96, bad 0.63-0.76; good assumptions 0.80-0.95, bad 0.71-0.75.
const CAL = {
  sample: { pairMin: 0.45, assumeMin: 0.5, ageFlag: -0.1, lo: 0, hi: 1, ageFit: (s) => (s + 1) / 2 },
  live: { pairMin: Number(process.env.PAIR_MIN || 0.73), assumeMin: Number(process.env.ASSUME_MIN || 0.78), ageFlag: -0.15, lo: 0.6, hi: 0.95, ageFit: (s) => 0.5 + s },
};

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
const label = (x) => `${x.name} (${x.kind === "tag" ? "tag" : x.type})`;
const sig = (xs) => ({ signalIds: xs.filter((x) => x.kind === "entity").map((x) => x.entity_id), signalTags: xs.filter((x) => x.kind === "tag").map((x) => x.tag_id) });

async function liveEvidence(p) {
  const steps = [];
  const resolved = await Promise.all([
    ...p.interests.map(async (n) => ({ input: n, e: await qloo.resolve(n).catch(() => null) })),
    ...p.assumes.map(async (n) => ({ input: n, e: await qloo.resolve(n, { allowPlace: true }).catch(() => null) })),
  ]);
  const ints = resolved.slice(0, p.interests.length).filter((r) => r.e).map((r) => r.e);
  const ass = resolved.slice(p.interests.length).filter((r) => r.e?.kind === "entity").map((r) => r.e);
  const unknown = resolved.filter((r, i) => !r.e || (i >= p.interests.length && r.e.kind !== "entity")).map((r) => r.input);
  steps.push(`Qloo /search and /v2/tags resolved ${ints.length + ass.length} of ${resolved.length} names: ${[...ints, ...ass].map(label).join(", ")}`);
  if (ints.length < 2) throw Object.assign(new Error(`Qloo couldn't find enough of these interests (${unknown.join(", ")}). Try more specific names.`), { status: 400 });

  // Who is each interest's audience? (Qloo has demographics for entities, not for tags.)
  const audiences = await Promise.all(ints.map(async (e) => {
    const d = e.kind === "entity" ? await qloo.demographics([e.entity_id]).then((x) => x[0]).catch(() => null) : null;
    if (!d || !Object.keys(d.age || {}).length) return { name: e.name, age: null, female: null };
    const g = d.gender || {};
    const female = g.female !== undefined || g.male !== undefined ? Math.min(1, Math.max(0, 0.5 + ((g.female || 0) - (g.male || 0)) / 4)) : null;
    return { name: e.name, age: AGE_BUCKETS.map((b) => Number(d.age?.[b] ?? 0)), female };
  }));
  steps.push(`Qloo insights (urn:demographics): age and gender skew of ${audiences.filter((a) => a.age).length} interest audiences`);

  // Do fans of one interest also like the other? The target of an affinity call must be an entity.
  const pairs = [];
  for (let i = 0; i < ints.length; i++) for (let j = i + 1; j < ints.length; j++) {
    // A tag signal gives the same affinity for every target (seen live: 0.76), so only entity-to-entity pairs count.
    const [from, to] = [ints[i], ints[j]];
    let a = null;
    if (from.kind === "entity" && to.kind === "entity") a = (await qloo.affinities({ ...sig([from]), targetType: to.type, shortlistIds: [to.entity_id] }).catch(() => ({})))[to.entity_id] ?? null;
    pairs.push({ a: ints[i].name, b: ints[j].name, affinity: a });
  }
  steps.push(`Qloo insights: cross-affinity for ${pairs.filter((x) => x.affinity !== null).length} interest pairs`);

  // Does the plan's assumption hold for this persona?
  const demoSignal = { age: p.age, gender: p.gender === "any" ? undefined : p.gender, location: p.location || undefined };
  const assumed = [];
  for (const e of ass) {
    const aff = await qloo.affinities({ ...sig(ints), targetType: e.type, shortlistIds: [e.entity_id], ...demoSignal }).catch(() => ({}));
    assumed.push({ name: e.name, affinity: aff[e.entity_id] ?? null });
  }
  if (assumed.length) steps.push(`Qloo insights: affinity of ${assumed.length} assumed brands/places for ${AGE_LABEL[p.age]}${p.gender !== "any" ? " " + p.gender : ""}${p.location ? " in " + p.location : ""}`);
  const skip = new Set([...ints, ...ass].map((e) => e.name));
  const alsoLike = (await qloo.neighbors({ ...sig(ints), targetType: "brand", ...demoSignal, take: 8 }).catch(() => [])).filter((x) => !skip.has(x.name)).slice(0, 5);
  steps.push("Qloo insights: brands this exact taste mix over-indexes on");
  const tags = ints.filter((e) => e.kind === "tag").map((e) => e.name);
  return { mode: "live", steps, unknown, pairs, assumed, alsoLike, audiences, tags };
}

// ---- shared scoring -----------------------------------------------------------
export function score(p, ev) {
  const cal = CAL[ev.mode];
  const fit = (a) => Math.min(1, Math.max(0, (a - cal.lo) / (cal.hi - cal.lo)));
  const b = AGE_BUCKETS.indexOf(p.age);
  const flags = [];
  const withAge = ev.audiences.filter((a) => a.age);

  for (const a of withAge) {
    if (a.age[b] < cal.ageFlag) {
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
  for (const x of ev.pairs) if (x.affinity !== null && x.affinity < cal.pairMin) flags.push({ level: "bad", kind: "pair", text: `People who like ${x.a} rarely also like ${x.b} (affinity ${pct(x.affinity)}).` });
  for (const a of ev.assumed) {
    if (a.affinity === null) continue;
    flags.push(a.affinity < cal.assumeMin
      ? { level: "bad", kind: "assume", text: `The plan assumes they like ${a.name}, but this taste cluster's affinity is only ${pct(a.affinity)}.` }
      : { level: "ok", kind: "assume", text: `${a.name} fits this cluster (affinity ${pct(a.affinity)}).` });
  }

  for (const t of ev.tags || []) flags.push({ level: "warn", kind: "tag", text: `${t} is a general hobby in Qloo, not a brand, title or place, so it could not be checked. Name a specific brand, club or venue for a sharper check.` });

  const avg = (xs, d) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : d);
  const ageCurve = withAge.length ? AGE_BUCKETS.map((k, i) => ({ age: AGE_LABEL[k], skew: avg(withAge.map((a) => a.age[i]), 0) })) : null;
  const ageScore = withAge.length ? avg(withAge.map((a) => Math.min(1, Math.max(0, cal.ageFit(a.age[b])))), 0.5) : 0.5;
  const coherence = avg(ev.pairs.filter((x) => x.affinity !== null).map((x) => fit(x.affinity)), 0.5);
  const assumeScore = avg(ev.assumed.filter((x) => x.affinity !== null).map((x) => fit(x.affinity)), coherence);
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
