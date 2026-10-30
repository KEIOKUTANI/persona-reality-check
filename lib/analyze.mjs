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

// "25–29" + "30–34" -> "25–34"
export const agesLabel = (ages) => {
  const first = AGE_LABEL[ages[0]], last = AGE_LABEL[ages[ages.length - 1]];
  if (ages.length === 1) return first;
  if (first.startsWith("≤")) return `≤${last.split("–").pop()}`;
  if (last.endsWith("+")) return `${first.split("–")[0]}+`;
  return `${first.split("–")[0]}–${last.split("–").pop()}`;
};

// "≤24" -> "24歳以下", "55+" -> "55歳以上", "25–34" -> "25〜34歳"
export const jaAge = (l) => (l.startsWith("≤") ? `${l.slice(1)}歳以下` : l.endsWith("+") ? `${l.slice(0, -1)}歳以上` : `${l.replace("–", "〜")}歳`);

// What the plan sells, so competitors come from the same Qloo category.
export const KINDS = ["brand", "podcast", "tv_show", "place"];

export function normalize(input) {
  const age = AGE_BUCKETS.includes(input.age) ? input.age : "25_to_29";
  const ages = Array.isArray(input.ages) && input.ages.every((a) => AGE_BUCKETS.includes(a)) && input.ages.length ? [...new Set(input.ages)].sort((a, b) => AGE_BUCKETS.indexOf(a) - AGE_BUCKETS.indexOf(b)) : [age];
  return {
    age: ages[0], ages,
    gender: ["female", "male", "any"].includes(input.gender) ? input.gender : "any",
    location: String(input.location || "").trim().slice(0, 60),
    interests: clean(input.interests, 4),
    assumes: clean(input.assumes, 3),
    kind: KINDS.includes(input.kind) ? input.kind : "brand",
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
  if (assumed.length) steps.push(`Qloo insights: affinity of ${assumed.length} assumed brands/places for ${agesLabel(p.ages)}${p.gender !== "any" ? " " + p.gender : ""}${p.location ? " in " + p.location : ""}`);
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
  const bs = p.ages.map((a) => AGE_BUCKETS.indexOf(a));
  const atPlan = (curve) => Math.max(...bs.map((b) => curve[b]));  // the plan's best-fitting age band
  const planAge = agesLabel(p.ages);
  const flags = [];
  const withAge = ev.audiences.filter((a) => a.age);

  for (const a of withAge) {
    if (atPlan(a.age) < cal.ageFlag) {
      const best = AGE_LABEL[AGE_BUCKETS[a.age.indexOf(Math.max(...a.age))]];
      flags.push({ level: "bad", kind: "age", text: `${a.name} fans skew ${best}, not ${planAge}.`, ja: `${a.name} のファンの中心は${jaAge(best)}で、${jaAge(planAge)}ではありません。` });
    }
  }
  const withGender = ev.audiences.filter((a) => a.female !== null && a.female !== undefined);
  let genderScore = 1;
  if (p.gender !== "any" && withGender.length) {
    const share = withGender.reduce((s, a) => s + (p.gender === "female" ? a.female : 1 - a.female), 0) / withGender.length;
    genderScore = Math.min(1, share / 0.5);
    if (share < 0.4) flags.push({ level: "warn", kind: "gender", text: `These interests lean ${p.gender === "female" ? "male" : "female"} (${pct(1 - share)}%).`, ja: `この好みの組み合わせは${p.gender === "female" ? "男性" : "女性"}寄りです（${pct(1 - share)}%）。` });
  }
  for (const x of ev.pairs) if (x.affinity !== null && x.affinity < cal.pairMin) flags.push({ level: "bad", kind: "pair", text: `${x.a} and ${x.b} fans overlap weakly (affinity ${pct(x.affinity)}; a matching pair scores ${pct(cal.pairMin)}+).`, ja: `${x.a} と ${x.b} のファンはあまり重なりません（相性 ${pct(x.affinity)}。重なる組み合わせは ${pct(cal.pairMin)} 以上）。` });
  for (const a of ev.assumed) {
    if (a.affinity === null) continue;
    flags.push(a.affinity < cal.assumeMin
      ? { level: "bad", kind: "assume", text: `The plan assumes they like ${a.name}, but this taste mix's affinity is only ${pct(a.affinity)} (a good fit scores ${pct(cal.assumeMin)}+).`, ja: `計画は ${a.name} も好きだと見込んでいますが、この好みの組み合わせとの相性は ${pct(a.affinity)} しかありません（合う場合は ${pct(cal.assumeMin)} 以上）。` }
      : { level: "ok", kind: "assume", text: `${a.name} fits this cluster (affinity ${pct(a.affinity)}).`, ja: `${a.name} はこの層に合っています（相性 ${pct(a.affinity)}）。` });
  }

  for (const t of ev.tags || []) flags.push({ level: "warn", kind: "tag", text: `${t} is a general hobby in Qloo, not a brand, title or place, so it could not be checked. Name a specific brand, club or venue for a sharper check.`, ja: `${t} は Qloo では一般的な趣味の扱いで、ブランド・作品・場所ではないため確かめられませんでした。具体的なブランドやクラブ、施設の名前にすると、より正確に確かめられます。` });

  const avg = (xs, d) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : d);
  const ageCurve = withAge.length ? AGE_BUCKETS.map((k, i) => ({ age: AGE_LABEL[k], skew: avg(withAge.map((a) => a.age[i]), 0) })) : null;
  const ageScore = withAge.length ? avg(withAge.map((a) => Math.min(1, Math.max(0, cal.ageFit(atPlan(a.age))))), 0.5) : 0.5;
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
    thresholds: { pair: cal.pairMin, assume: cal.assumeMin, ageFlag: cal.ageFlag },
    flags, pairs: ev.pairs, assumed: ev.assumed, unknown: ev.unknown, ageCurve, audiences: ev.audiences,
    realistic: { age: realAge ? AGE_LABEL[realAge] : null, ageKey: realAge, female, alsoLike: ev.alsoLike },
  };
}

// ---- revise: turn the evidence into a corrected persona, then re-check it ------------------------------
// The agent keeps what Qloo supports, swaps out what it contradicts, and checks the new persona again,
// so the user gets a better target customer instead of only a list of problems.
// keepAge: keep the plan's age and drop the interests that miss it, instead of moving the age to the interests.
// toAge: move the age to this band (e.g. the band of one interest's fans) instead of the whole mix's peak.
export function revise(p, r, { keepAge = false, toAge = null } = {}) {
  const th = r.thresholds || {};
  const changes = [];
  const out = { ...p, ages: [...p.ages], interests: [...p.interests], assumes: [...p.assumes] };
  const also = (r.realistic?.alsoLike || []).map((x) => x.name).filter((n) => !p.interests.includes(n) && !p.assumes.includes(n));

  // Names Qloo couldn't find (often the plan's own project name) only add noise.
  for (const n of r.unknown || []) if (out.interests.includes(n)) {
    out.interests = out.interests.filter((x) => x !== n);
    changes.push({ en: `Drop "${n}": Qloo doesn't know it, so it can't describe the customer.`, ja: `「${n}」を外す：Qloo のデータに無く、客層の手がかりになりません。` });
  }
  const target = toAge || r.realistic?.ageKey;
  if (!keepAge && r.flags.some((f) => f.kind === "age" && f.level === "bad") && target && !p.ages.includes(target)) {
    out.ages = [target]; out.age = target;
    const from = agesLabel(p.ages), to = AGE_LABEL[target];
    changes.push({ en: `Age ${from} → ${to}: the audience these interests really have.`, ja: `年齢 ${jaAge(from)} → ${jaAge(to)}：この好きなものを実際に好む層に合わせました。` });
  }
  if (r.flags.some((f) => f.kind === "gender")) {
    out.gender = "any";
    changes.push({ en: "Gender → any: these interests lean the other way.", ja: "性別 → 指定なし：この好みは逆の性別に寄っています。" });
  }
  // Interests whose audience misses the (new) target age go; then, while a pair overlaps weakly, the interest in the
  // most weak pairs goes. At least two always stay; the gap is filled from what this taste mix over-indexes on.
  const bs = out.ages.map((a) => AGE_BUCKETS.indexOf(a));
  const drop = (n, en, ja) => { out.interests = out.interests.filter((x) => x !== n); changes.push({ en: `Drop "${n}": ${en}`, ja: `「${n}」を外す：${ja}` }); };
  for (const a of r.audiences || []) {
    if (!a.age || out.interests.length <= 2 || !out.interests.includes(a.name)) continue;
    if (Math.max(...bs.map((b) => a.age[b])) < (th.ageFlag ?? -0.1)) drop(a.name, `its fans are a different age (mostly ${AGE_LABEL[AGE_BUCKETS[a.age.indexOf(Math.max(...a.age))]]}).`, `ファンの年齢層が違います（中心は${jaAge(AGE_LABEL[AGE_BUCKETS[a.age.indexOf(Math.max(...a.age))]])}）。`);
  }
  for (;;) {
    const weak = r.pairs.filter((x) => x.affinity !== null && x.affinity < (th.pair ?? 0.45) && out.interests.includes(x.a) && out.interests.includes(x.b));
    if (!weak.length || out.interests.length <= 2) break;
    const count = (n) => weak.filter((x) => x.a === n || x.b === n).length;
    const worst = [...out.interests].sort((x, y) => count(y) - count(x))[0];
    drop(worst, "its fans barely overlap with the other interests.", "ほかの好きなもののファンとあまり重なりません。");
  }
  while (out.interests.length < 3 && also.length) {
    const n = also.shift(); out.interests.push(n);
    changes.push({ en: `Add "${n}": this taste mix over-indexes on it.`, ja: `「${n}」を足す：この好みの層がよく好むものです。` });
  }
  const badAssume = r.assumed.filter((a) => a.affinity !== null && a.affinity < (th.assume ?? 0.5)).map((a) => a.name);
  if (badAssume.length) {
    out.assumes = p.assumes.filter((n) => !badAssume.includes(n));
    for (const n of badAssume) {
      const alt = also.shift();
      if (alt) out.assumes.push(alt);
      changes.push(alt ? { en: `Replace assumed "${n}" with "${alt}".`, ja: `見込み「${n}」を「${alt}」に置き換え。` } : { en: `Drop assumed "${n}".`, ja: `見込み「${n}」を外す。` });
    }
  }
  return { persona: out, changes };
}

// The ways to correct a persona, each with a label the user picks from:
// keep the plan's age and swap interests, move the age to one mismatched interest's fans, or to the whole mix's peak.
export function revisionOptions(p, r) {
  const opts = [{ ...revise(p, r, { keepAge: true }), en: "Keep your age, swap the interests", ja: "年齢はそのまま、好きなものを入れ替える" }];
  const peak = (a) => AGE_BUCKETS[a.age.indexOf(Math.max(...a.age))];
  for (const f of r.flags.filter((x) => x.kind === "age")) {
    const a = (r.audiences || []).find((x) => x.age && f.text.startsWith(`${x.name} `));
    if (a) opts.push({ ...revise(p, r, { toAge: peak(a) }), en: `Move the age to ${a.name} fans (${AGE_LABEL[peak(a)]})`, ja: `${a.name} のファン層（${jaAge(AGE_LABEL[peak(a)])}）に年齢を寄せる` });
  }
  if (r.realistic?.ageKey) opts.push({ ...revise(p, r), en: `Move the age to the whole mix (${AGE_LABEL[r.realistic.ageKey]})`, ja: `好きなもの全体のファン層（${jaAge(AGE_LABEL[r.realistic.ageKey])}）に年齢を寄せる` });
  const seen = new Set();
  return opts.filter((o) => { const k = JSON.stringify(o.persona); if (!o.changes.length || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
}

// ---- competitors ----------------------------------------------------------------
// Same-category picks this persona over-indexes on: the top ones are models to study and copy,
// the next ones (plus a neighbouring category) are rivals for the same people's time and money.
// A neighbouring category drifts off topic (seen live: anime titles as rivals of a tech channel), so rivals stay in the same one.
const RIVAL_KIND = { podcast: "podcast", tv_show: "tv_show", brand: "brand", place: "place" };
const KIND_JA = { brand: "ブランド", podcast: "番組・チャンネル", tv_show: "番組", place: "お店・場所" };

export async function competitors(p) {
  // Sample data has no shows or places, and Qloo place results need a location.
  const kind = !qloo.qlooEnabled() || (p.kind === "place" && !p.location) ? "brand" : p.kind;
  const skip = new Set([...p.interests, ...p.assumes].map((n) => n.toLowerCase()));
  const keep = (xs) => xs.filter((x) => x.name && !skip.has(x.name.toLowerCase()));
  let list, rivals;
  if (qloo.qlooEnabled()) {
    const ints = (await Promise.all(p.interests.map((n) => qloo.resolve(n).catch(() => null)))).filter(Boolean);
    if (!ints.length) return null;
    const demo = { age: p.age, gender: p.gender === "any" ? undefined : p.gender, location: p.location || undefined };
    const ask = (targetType) => qloo.neighbors({ ...sig(ints), targetType, ...demo, take: 10 }).then(keep).catch(() => []);
    list = await ask(kind);
    // Not every taste mix has podcast/show results: fall back to brands rather than show nothing.
    if (list.length < 2 && kind !== "brand") return competitors({ ...p, kind: "brand" });
    rivals = RIVAL_KIND[kind] === kind ? list.slice(3, 6) : (await ask(RIVAL_KIND[kind])).slice(0, 3);
  } else {
    const vs = p.interests.map(entity).filter(Boolean).map((e) => e.v);
    if (!vs.length) return null;
    const c = centroid(vs);
    list = keep(Object.entries(ENTITIES).filter(([, e]) => e.type !== "tag").map(([n, e]) => ({ name: n, affinity: affinity(c, e.v) }))).sort((a, b) => b.affinity - a.affinity);
    rivals = list.slice(3, 6);
  }
  const models = list.slice(0, 3);
  if (!models.length) return null;
  return {
    kind, kindJa: KIND_JA[kind],
    models: models.map((x) => ({ ...x,
      en: `Its fans are your persona. Study its themes, titles, look and pricing, and copy what works.`,
      ja: `ファンがこの想定客そのもの。テーマ・タイトル・見せ方・価格を研究して、うまくいっている所をまねる。` })),
    rivals: rivals.map((x) => ({ ...x,
      en: `Competes for the same people's time and money. Find what it doesn't offer and fill that gap.`,
      ja: `同じ人たちの時間とお金を取り合う相手。ここに無いものを探して、そこを埋める。` })),
  };
}
