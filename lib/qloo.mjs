// Thin Qloo client (server-side only). Hackathon keys use https://hackathon.api.qloo.com.
// Read at call time so tests (and a restarted config) can change them.
const baseUrl = () => process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";
const apiKey = () => process.env.QLOO_API_KEY || "";

export const qlooEnabled = () => Boolean(apiKey());

export const TYPES = {
  brand: "urn:entity:brand", artist: "urn:entity:artist", movie: "urn:entity:movie",
  tv_show: "urn:entity:tv_show", place: "urn:entity:place", person: "urn:entity:person",
  book: "urn:entity:book", videogame: "urn:entity:videogame", destination: "urn:entity:destination",
};

async function request(path, params = {}) {
  const url = new URL(path, baseUrl());
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) { if (v.length) url.searchParams.set(k, v.join(",")); }
    else if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: { "X-Api-Key": apiKey(), Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Qloo ${path} ${res.status}: ${body.message || res.statusText}`);
  }
  return res.json();
}

const entitiesOf = (r) => (Array.isArray(r?.results) ? r.results : r?.results?.entities || []);

const typeOf = (e) => String((e.types && e.types[0]) || e.subtype || e.type || "").replace("urn:entity:", "");
const same = (a, b) => a.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() === b.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
// Untyped search often returns a town with the same name ("Golf", "Patagonia"), so localities are never used.
const SKIP = new Set(["locality", "destination", "neighborhood", "city", "state", "country"]);

export async function search(query, type) {
  const r = await request("/search", { query, types: type ? TYPES[type] || type : undefined, take: 5 });
  const e = entitiesOf(r).filter((x) => !SKIP.has(typeOf(x)))[0];
  return e ? { entity_id: e.entity_id, name: e.name, type: typeOf(e), kind: "entity" } : null;
}

// Resolve a free-text name the way a person means it: an exact brand, then an exact match of
// any other entity type (artist, film, person...), then a Qloo tag for hobbies ("Golf", "Glamping"),
// then a place (only when allowPlace, e.g. a mall the plan names), then the best brand guess.
export async function resolve(query, { allowPlace = false } = {}) {
  const brand = await search(query, "brand").catch(() => null);
  if (brand && same(brand.name, query)) return brand;
  const any = await request("/search", { query, take: 8 }).then(entitiesOf).catch(() => []);
  const exact = any.find((x) => same(x.name, query) && !SKIP.has(typeOf(x)) && typeOf(x) !== "place");
  if (exact) return { entity_id: exact.entity_id, name: exact.name, type: typeOf(exact), kind: "entity" };
  const tag = await findTag(query).catch(() => null);
  if (tag) return tag;
  if (allowPlace) {
    const place = await search(query, "place").catch(() => null);
    if (place) return place;
  }
  return brand;
}

export async function findTag(query) {
  const r = await request("/v2/tags", { "filter.query": query, take: 5 });
  const tags = r?.results?.tags || [];
  const t = tags.find((x) => same(x.name, query)) || null;
  return t ? { tag_id: t.id, name: t.name, type: "tag", kind: "tag" } : null;
}

// Affinity (0-1) of each shortlisted entity for people who like the signal entities and/or tags.
export async function affinities({ signalIds, signalTags, targetType, shortlistIds, age, gender, location }) {
  const r = await request("/v2/insights", {
    "filter.type": TYPES[targetType] || `urn:entity:${targetType}`,
    "filter.results.entities": shortlistIds,
    "signal.interests.entities": signalIds,
    "signal.interests.tags": signalTags,
    "signal.demographics.age": age,
    "signal.demographics.gender": gender,
    "signal.location.query": location,
    take: shortlistIds.length,
  });
  const out = {};
  for (const e of entitiesOf(r)) out[e.entity_id] = e.query?.affinity ?? e.affinity ?? null;
  return out;
}

// Open-ended "people with this taste also like..."
export async function neighbors({ signalIds, signalTags, targetType = "brand", age, gender, location, take = 6 }) {
  const r = await request("/v2/insights", {
    "filter.type": TYPES[targetType] || targetType,
    "signal.interests.entities": signalIds,
    "signal.interests.tags": signalTags,
    "signal.demographics.age": age,
    "signal.demographics.gender": gender,
    "signal.location.query": location,
    take,
  });
  return entitiesOf(r).map((e) => ({ name: e.name, affinity: e.query?.affinity ?? null }));
}

// Age/gender skew of the audience behind each entity: [{ age: {bucket: skew}, gender: {female, male} }].
// Skews are relative to the average Qloo audience (positive = over-indexes).
export async function demographics(signalIds) {
  const r = await request("/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": signalIds });
  const rows = r?.results?.demographics || [];
  return rows.map((d) => ({ entity_id: d.entity_id, age: d.query?.age || {}, gender: d.query?.gender || {} }));
}
