// A tiny stand-in for the Qloo API, used only by the offline test to exercise the live code path.
// Response shapes follow the Qloo v2 docs; the numbers are made up.
import http from "node:http";

const DB = {
  glamping: { entity_id: "E-GLAMP", name: "Glamping", subtype: "urn:entity:brand" },
  lululemon: { entity_id: "E-LULU", name: "Lululemon", subtype: "urn:entity:brand" },
  "blue bottle coffee": { entity_id: "E-BBC", name: "Blue Bottle Coffee", subtype: "urn:entity:brand" },
  "snow peak": { entity_id: "E-SNOW", name: "Snow Peak", subtype: "urn:entity:brand" },
  "aeon mall": { entity_id: "E-AEON", name: "Aeon Mall", subtype: "urn:entity:place" },
};
const AFF = { "E-LULU": 0.71, "E-BBC": 0.66, "E-SNOW": 0.83, "E-AEON": 0.22 };

export function startMock(port = 0) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    calls.push({ path: url.pathname, params: Object.fromEntries(url.searchParams), key: req.headers["x-api-key"] });
    const send = (o) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(o));
    if (req.headers["x-api-key"] !== "test-key") return res.writeHead(401).end("{}");
    if (url.pathname === "/search") {
      const e = DB[(url.searchParams.get("query") || "").toLowerCase()];
      return send({ results: e ? [e] : [] });
    }
    if (url.pathname === "/v2/insights") {
      const type = url.searchParams.get("filter.type");
      if (type === "urn:demographics") {
        return send({ results: { demographics: [{ entity_id: url.searchParams.get("signal.interests.entities"),
          query: { age: { "24_and_younger": -0.2, "25_to_29": 0.3, "30_to_34": 0.25, "35_to_44": 0.05, "45_to_54": -0.2, "55_and_older": -0.4 }, gender: { male: -0.1, female: 0.12 } } }] } });
      }
      const ids = (url.searchParams.get("filter.results.entities") || "").split(",").filter(Boolean);
      if (ids.length) return send({ results: { entities: ids.map((id) => ({ entity_id: id, name: id, query: { affinity: AFF[id] ?? 0.5 } })) } });
      return send({ results: { entities: [{ name: "Patagonia", query: { affinity: 0.9 } }, { name: "Aesop", query: { affinity: 0.85 } }] } });
    }
    res.writeHead(404).end("{}");
  });
  return new Promise((r) => server.listen(port, () => r({ server, calls, url: `http://localhost:${server.address().port}` })));
}
