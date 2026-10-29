// Sample taste model used when no QLOO_API_KEY is set. Hand-made numbers, NOT Qloo data.
// Each entity: audience age skew over 6 buckets (-1..1), female share (0..1),
// and a taste vector [outdoor, luxury, value, tech, culture, family, sport].
export const AGE_BUCKETS = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"];
export const AGE_LABEL = { "24_and_younger": "≤24", "25_to_29": "25–29", "30_to_34": "30–34", "35_to_44": "35–44", "45_to_54": "45–54", "55_and_older": "55+" };

export const ENTITIES = {
  "Patagonia":        { type: "brand",  age: [-.2, .2, .4, .4, .1, -.3], female: .45, v: [1, .4, 0, .1, .3, .2, .4] },
  "The North Face":   { type: "brand",  age: [.4, .4, .2, 0, -.3, -.5], female: .45, v: [.8, .3, .1, .1, .1, .1, .4] },
  "Snow Peak":        { type: "brand",  age: [-.4, 0, .3, .5, .3, -.2], female: .35, v: [1, .7, 0, .1, .3, .5, .1] },
  "MUJI":             { type: "brand",  age: [.2, .4, .4, .2, 0, -.3], female: .62, v: [.2, .1, .8, .1, .5, .5, 0] },
  "Uniqlo":           { type: "brand",  age: [.3, .3, .3, .2, .1, 0], female: .55, v: [.1, 0, 1, .1, .2, .5, .1] },
  "Louis Vuitton":    { type: "brand",  age: [.3, .4, .2, 0, -.2, -.3], female: .6, v: [0, 1, -.6, .1, .3, 0, 0] },
  "Hermès":           { type: "brand",  age: [-.3, 0, .2, .3, .3, .1], female: .68, v: [0, 1, -.7, 0, .5, .1, 0] },
  "Apple":            { type: "brand",  age: [.4, .3, .2, .1, -.1, -.3], female: .5, v: [.1, .5, 0, 1, .3, .1, .1] },
  "Nintendo":         { type: "brand",  age: [.6, .3, .1, 0, -.4, -.6], female: .42, v: [0, 0, .4, .6, .3, .7, .1] },
  "Lululemon":        { type: "brand",  age: [.3, .5, .4, .1, -.2, -.5], female: .8, v: [.4, .5, 0, 0, .1, .1, .9] },
  "Starbucks":        { type: "brand",  age: [.5, .4, .2, 0, -.2, -.4], female: .62, v: [0, .2, .3, .2, .3, .2, 0] },
  "Blue Bottle Coffee": { type: "brand", age: [0, .5, .5, .2, -.1, -.4], female: .55, v: [.1, .5, 0, .3, .8, .1, 0] },
  "Doutor Coffee":    { type: "brand",  age: [-.4, -.2, 0, .2, .4, .5], female: .45, v: [0, -.2, .8, 0, .1, .2, 0] },
  "Komeda Coffee":    { type: "brand",  age: [-.3, -.1, .1, .4, .4, .3], female: .55, v: [0, 0, .5, 0, .2, .9, 0] },
  "Kissaten culture": { type: "tag",    age: [-.2, -.1, 0, .2, .5, .6], female: .45, v: [0, .1, .3, 0, 1, .2, 0] },
  "Studio Ghibli":    { type: "movie",  age: [.3, .4, .3, .2, 0, -.2], female: .58, v: [.3, 0, .2, 0, .9, .8, 0] },
  "Haruki Murakami":  { type: "book",   age: [-.1, .2, .3, .3, .2, 0], female: .55, v: [0, .2, 0, 0, 1, 0, 0] },
  "Fuji Rock Festival": { type: "event", age: [.1, .4, .4, .3, -.1, -.5], female: .45, v: [.8, .1, 0, 0, .8, 0, .2] },
  "Taylor Swift":     { type: "artist", age: [.8, .4, 0, -.2, -.4, -.6], female: .7, v: [0, .3, .2, 0, .5, .2, 0] },
  "Glamping":         { type: "tag",    age: [0, .5, .5, .2, -.2, -.5], female: .6, v: [.7, .8, -.2, 0, .3, .4, 0] },
  "Trail running":    { type: "tag",    age: [-.2, .3, .5, .4, 0, -.4], female: .4, v: [1, .1, 0, .2, 0, 0, 1] },
  "Golf":             { type: "tag",    age: [-.7, -.3, 0, .3, .6, .7], female: .25, v: [.4, .7, -.2, 0, 0, .1, .7] },
  "Starbucks Reserve": { type: "brand", age: [.1, .5, .4, .1, -.1, -.4], female: .58, v: [0, .6, -.1, .2, .5, .1, 0] },
  "Seven-Eleven":     { type: "brand",  age: [.4, .2, .1, .1, .1, .1], female: .45, v: [0, -.3, 1, .1, 0, .3, 0] },
  "Aeon Mall":        { type: "brand",  age: [.2, .1, .2, .4, .2, .2], female: .55, v: [0, -.2, .8, 0, 0, 1, 0] },
  "Tsutaya Books":    { type: "brand",  age: [.1, .4, .4, .3, .1, -.2], female: .5, v: [0, .3, .2, .2, .9, .3, 0] },
  "Coach":            { type: "brand",  age: [-.1, .1, .3, .3, .1, -.2], female: .7, v: [0, .7, 0, 0, .2, .2, 0] },
};

export function entity(name) {
  const key = Object.keys(ENTITIES).find((k) => k.toLowerCase() === String(name).trim().toLowerCase());
  return key ? { name: key, ...ENTITIES[key] } : null;
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = (a) => Math.sqrt(dot(a, a)) || 1;
export const centroid = (vs) => vs[0].map((_, i) => vs.reduce((s, v) => s + v[i], 0) / vs.length);
// Affinity 0..1 between two taste vectors.
export const affinity = (a, b) => Math.max(0, Math.min(1, (dot(a, b) / (norm(a) * norm(b)) + 0.2) / 1.2));
export const catalog = () => Object.entries(ENTITIES).map(([name, e]) => ({ name, type: e.type }));
