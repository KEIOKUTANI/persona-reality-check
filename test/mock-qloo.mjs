// A tiny stand-in for the Qloo API, used only by the offline test to exercise the live code path.
// Response shapes copy real hackathon API responses (2026-10-29); the numbers are made up.
import http from "node:http";

const E = (id, name, type) => ({ entity_id: id, name, types: [`urn:entity:${type}`], popularity: 0.9 });
const BRANDS = { lululemon: E("E-LULU", "Lululemon", "brand"), "blue bottle coffee": E("E-BBC", "Blue Bottle Coffee", "brand"),
  "snow peak": E("E-SNOW", "Snow Peak", "brand"), patagonia: E("E-PATA", "Patagonia", "brand") };
const ANY = { golf: [E("L-GOLF", "Golf", "locality")], patagonia: [E("L-PATA", "Patagonia", "locality"), BRANDS.patagonia],
  "aeon mall": [E("P-AEON", "Aeon Mall", "place")], "taylor swift": [E("P-TS", "Taylor Swift", "person")] };
const TAGS = { golf: [{ id: "urn:tag:category:place:golf", name: "Golf", type: "urn:tag:category:place" }] };
const AFF = { "E-LULU": 0.71, "E-BBC": 0.66, "E-SNOW": 0.83, "P-AEON": 0.22, "E-PATA": 0.87, "P-TS": 0.3 };

export function startMock(port = 0) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const q = Object.fromEntries(url.searchParams);
    calls.push({ path: url.pathname, params: q, key: req.headers["x-api-key"] });
    const send = (o) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(o));
    if (req.headers["x-api-key"] !== "test-key") return res.writeHead(401).end("{}");
    const name = (q.query || q["filter.query"] || "").toLowerCase();
    if (url.pathname === "/search") {
      if (q.types === "urn:entity:brand") return send({ results: BRANDS[name] ? [BRANDS[name]] : [] });
      if (q.types === "urn:entity:place") return send({ results: (ANY[name] || []).filter((e) => e.types[0] === "urn:entity:place") });
      return send({ results: ANY[name] || (BRANDS[name] ? [BRANDS[name]] : []) });
    }
    if (url.pathname === "/v2/tags") return send({ success: true, results: { tags: TAGS[name] || [] } });
    if (url.pathname === "/v2/insights") {
      if (q["filter.type"] === "urn:demographics") {
        if (!q["signal.interests.entities"]) return send({ success: true, results: { demographics: [] } });
        return send({ success: true, results: { demographics: [{ entity_id: q["signal.interests.entities"],
          query: { age: { "24_and_younger": 0.04, "25_to_29": 0.3, "30_to_34": 0.25, "35_to_44": 0.05, "45_to_54": -0.56, "55_and_older": -0.63 }, gender: { male: -0.58, female: 0.58 } } }] } });
      }
      const ids = (q["filter.results.entities"] || "").split(",").filter(Boolean);
      if (ids.length) return send({ success: true, results: { entities: ids.map((id) => ({ entity_id: id, name: id, type: "urn:entity", query: { affinity: AFF[id] ?? 0.5, measurements: { audience_growth: 0 } } })) } });
      return send({ success: true, results: { entities: [{ name: "Lululemon", query: { affinity: 0.95 } }, { name: "Pliability", query: { affinity: 0.9 } }, { name: "Aesop", query: { affinity: 0.85 } }] } });
    }
    res.writeHead(404).end("{}");
  });
  return new Promise((r) => server.listen(port, () => r({ server, calls, url: `http://localhost:${server.address().port}` })));
}
