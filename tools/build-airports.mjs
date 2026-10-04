// Each city's airports (tools/airports/airports.json) into data/airports.json, with the airfield's
// outline and its terminal buildings from OpenStreetMap (by IATA code):
//   node tools/build-airports.mjs [IATA]
// An airport marked hand: true (closed since, its code taken by another: Austin's Mueller) gets a
// drawn outline and terminal instead. Answers are cached in .cache/airports.json. On KG Cities
// scenes the airports are drawn with the city's landmarks (scripts/airports.mjs).

import { readFile, writeFile, mkdir } from "node:fs/promises";

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

const root = new URL("../", import.meta.url);
const source = JSON.parse(await readFile(new URL("tools/airports/airports.json", root), "utf8"));
const only = process.argv[2]?.toUpperCase();
await mkdir(new URL(".cache/", root), { recursive: true });
const cacheUrl = new URL(".cache/airports.json", root);
const cache = JSON.parse(await readFile(cacheUrl, "utf8").catch(() => "{}"));
const ENDPOINTS = [...OVERPASS, "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];

async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, { method: "POST", body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(120000),
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "kg-cities Foundry VTT module (airport build)" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (body.remark && /error|timed out|out of memory/i.test(body.remark)) throw new Error(body.remark);
        return body.elements;
      } catch (err) { lastErr = err; }
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw new Error(`Overpass: ${lastErr?.message}`);
}

const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a / 2); };
const inside = ([x, y], ring) => { let hit = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit; } return hit; };
const centre = (r) => [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
const round = (r) => r.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]);
const closed = (r) => r.length > 3 && Math.hypot(r[0][0] - r.at(-1)[0], r[0][1] - r.at(-1)[1]) < 1e-7;

/** Closed outer rings of ways and multipolygon relations, from `out geom`. */
function rings(e) {
  const out = [];
  if (e.type === "way" && e.geometry) out.push(e.geometry.map((p) => [p.lon, p.lat]));
  // Relation outers can come in pieces: join them end to end.
  const parts = (e.members ?? []).filter((m) => m.role === "outer" && m.geometry).map((m) => m.geometry.map((p) => [p.lon, p.lat]));
  while (parts.length) {
    let ring = parts.shift();
    for (let joined = true; joined && !closed(ring);) {
      joined = false;
      const end = ring.at(-1);
      const i = parts.findIndex((p) => Math.hypot(p[0][0] - end[0], p[0][1] - end[1]) < 1e-7 || Math.hypot(p.at(-1)[0] - end[0], p.at(-1)[1] - end[1]) < 1e-7);
      if (i >= 0) {
        const next = parts.splice(i, 1)[0];
        ring = ring.concat((Math.hypot(next[0][0] - end[0], next[0][1] - end[1]) < 1e-7 ? next : next.reverse()).slice(1));
        joined = true;
      }
    }
    out.push(ring);
  }
  return out.filter(closed);
}

/** A rectangle w by d metres around [lat, lon], turned clockwise by angle degrees. */
function rect([lat, lon], w, d, angle = 0) {
  const k = Math.cos((lat * Math.PI) / 180) * 111320, a = (angle * Math.PI) / 180;
  const r = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => {
    const rx = x * Math.cos(a) + y * Math.sin(a), ry = -x * Math.sin(a) + y * Math.cos(a);
    return [lon + rx / k, lat + ry / 111320];
  });
  return round([...r, r[0]]);
}

/** The airfield and its terminals from OpenStreetMap. */
async function fromOsm(a) {
  if (cache[a.iata]) return cache[a.iata];
  const fields = await overpass(`[out:json][timeout:90];(way["aeroway"="aerodrome"]["iata"="${a.iata}"];relation["aeroway"="aerodrome"]["iata"="${a.iata}"];);out geom;`);
  // The largest airfield with the code near where it should be (a code can be reused elsewhere).
  const near = (r) => { const [x, y] = centre(r); return Math.hypot((x - a.at[1]) * Math.cos((y * Math.PI) / 180), y - a.at[0]) < 0.08; };
  const outline = fields.flatMap(rings).filter(near).sort((p, q) => ringArea(q) - ringArea(p))[0];
  if (!outline) throw new Error(`${a.iata}: no airfield outline found`);
  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  const bbox = `${Math.min(...ys)},${Math.min(...xs)},${Math.max(...ys)},${Math.max(...xs)}`;
  await new Promise((r) => setTimeout(r, 1500));
  const els = await overpass(`[out:json][timeout:90];(way["aeroway"="terminal"](${bbox});relation["aeroway"="terminal"](${bbox});way["building"="terminal"](${bbox}););out geom tags;`);
  const terminals = [];
  const seen = new Set();
  for (const e of els) {
    if (seen.has(`${e.type}${e.id}`)) continue;
    seen.add(`${e.type}${e.id}`);
    const t = e.tags ?? {};
    const levels = Number(t["building:levels"]);
    const h = parseFloat(t.height) || (levels ? levels * 4.5 + 2 : 15);
    for (const r of rings(e)) {
      if (!inside(centre(r), outline) || ringArea(r) * 111320 * 111320 < 400) continue;
      terminals.push({ id: `airport-${a.iata}-${e.type[0]}${e.id}`, name: t.name ?? null, h: Math.min(40, Math.round(h)), base: 0, rings: [round(r)] });
    }
  }
  // Terminals not tagged as such (Miami): buildings named as terminals or concourses, else the
  // largest buildings near the airport's point.
  if (!terminals.length) {
    await new Promise((r) => setTimeout(r, 1500));
    // terminalAt: where the terminal is, when the airport's own point is out on the field.
    const [tLat, tLon] = a.terminalAt ?? a.at;
    const near = await overpass(`[out:json][timeout:90];(way["building"](around:700,${tLat},${tLon});relation["building"](around:700,${tLat},${tLon}););out geom tags;`);
    // Not the garages and car parks that sit in the middle of many terminals.
    const shapes = near.filter((e) => !/parking|garage/i.test(e.tags?.name ?? "") && e.tags?.building !== "parking")
      .flatMap((e) => rings(e).map((r) => ({ e, r, area: ringArea(r) * 111320 * 111320 })))
      .filter(({ r, area }) => inside(centre(r), outline) && area > 3000);
    const named = shapes.filter(({ e }) => /terminal|concourse/i.test(e.tags?.name ?? ""));
    for (const { e, r } of (named.length ? named : shapes.sort((p, q) => q.area - p.area).slice(0, 6))) {
      terminals.push({ id: `airport-${a.iata}-${e.type[0]}${e.id}`, name: e.tags?.name ?? null, h: 15, base: 0, rings: [round(r)] });
    }
  }
  cache[a.iata] = { outline: round(outline), terminals };
  await writeFile(cacheUrl, JSON.stringify(cache));
  await new Promise((r) => setTimeout(r, 1500));
  return cache[a.iata];
}

/** An airport that is gone: its field and terminal drawn by hand (approximate). */
function byHand(a) {
  if (a.iata === "AUS") {
    // Robert Mueller Municipal: the field between Airport Boulevard and Manor Road, the
    // terminal on its west side.
    return {
      outline: round([[-97.7155, 30.3085], [-97.6945, 30.3085], [-97.693, 30.2895], [-97.7145, 30.2895], [-97.7155, 30.3085]]),
      terminals: [{ id: "airport-AUS-terminal", name: "Mueller terminal", h: 12, base: 0, rings: [rect(a.at, 170, 55, 40)] }]
    };
  }
  throw new Error(`${a.iata}: no hand-drawn outline`);
}

const outPath = new URL("data/airports.json", root);
const previous = JSON.parse(await readFile(outPath, "utf8").catch(() => "[]"));
const out = [];
for (const a of source.airports) {
  if (only && a.iata !== only) { const kept = previous.find((p) => p.iata === a.iata); if (kept) out.push(kept); continue; }
  try {
    const shape = a.hand ? byHand(a) : await fromOsm(a);
    out.push({
      id: `airport:${a.iata}`, iata: a.iata, name: a.name, cities: a.cities, size: a.size,
      lat: a.at[0], lon: a.at[1], ...(a.opened ? { opened: a.opened } : {}), ...(a.closed ? { closed: a.closed } : {}),
      text: a.text, outline: shape.outline, terminals: shape.terminals
    });
    console.log(`${a.iata}  ${shape.terminals.length} terminal shapes, outline ${shape.outline.length} points  ${a.name}`);
  } catch (err) {
    console.log(`${a.iata}  FAILED: ${err.message}`);
    const kept = previous.find((p) => p.iata === a.iata);
    if (kept) out.push(kept);
  }
}
await writeFile(outPath, JSON.stringify(out) + "\n");
console.log(`${out.length} airports written to data/airports.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
