import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { CITY_SOUND, boxAround, cityNetwork, dropDuplicateServices, makeProjection, readCityInfo } from "../scripts/cities.mjs";
import { SCENERY } from "../scripts/catalog.mjs";
import { findTrip, normalize } from "../scripts/network.mjs";

const dir = new URL("../data/cities/", import.meta.url);
const pack = (id) => JSON.parse(readFileSync(new URL(`${id}.json`, dir), "utf8"));
const RECT = { x: 0, y: 0, width: 20000, height: 14000 };
/** A scene covering the city's whole metro box. */
const metro = (p, era, year) => ({ city: p.id, era, year, bounds: boxAround(p.metro.center, p.metro.miles) });

test("KG Cities scene data: city, era and year", () => {
  assert.equal(readCityInfo(null), null);
  assert.equal(readCityInfo({}), null);
  const a = readCityInfo({ city: "Boston", era: "1980s" });
  assert.deepEqual([a.city, a.era, a.year], ["boston", "1980s", 1986]);
  const b = readCityInfo({ city: "chicago", era: "modern" }, 2026);
  assert.equal(b.year, 2026);
  const c = readCityInfo({ city: "miami", year: 1989 });
  assert.deepEqual([c.era, c.year], ["1980s", 1989]);
  assert.equal(readCityInfo({ city: "x", bounds: { north: 1, south: 0, west: 0 } }).bounds, null);
});

test("the projection stretches the lat/lon box over the scene", () => {
  const bounds = { north: 42.4, south: 42.3, west: -71.2, east: -71.0 };
  const p = makeProjection(bounds, { x: 100, y: 50, width: 2000, height: 1000 });
  const nw = p(42.4, -71.2);
  const se = p(42.3, -71.0);
  assert.ok(Math.abs(nw.x - 100) < 1e-6 && Math.abs(nw.y - 50) < 1e-6);
  assert.ok(Math.abs(se.x - 2100) < 1e-6 && Math.abs(se.y - 1050) < 1e-6);
});

test("every city pack is well formed", () => {
  const ids = JSON.parse(readFileSync(new URL("index.json", dir), "utf8"));
  assert.ok(ids.includes("boston"));
  for (const id of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").map((f) => f.slice(0, -5))) {
    const p = pack(id);
    const ids = new Set(p.stations.map((s) => s.id));
    assert.equal(ids.size, p.stations.length, `${id}: station ids are unique`);
    for (const line of [...p.lines, ...Object.values(p.snapshots ?? {}).flatMap((s) => s.lines)]) {
      assert.equal(line.segments.length, line.stops.length - 1, `${id} ${line.id}: a scenery per stretch`);
      // Routing finds a stop by its place on the line, so a line (even a loop) visits each station once.
      assert.equal(new Set(line.stops).size, line.stops.length, `${id} ${line.id}: no station twice`);
      for (const s of line.segments) assert.ok(SCENERY[s], `${id} ${line.id}: known scenery ${s}`);
    }
    for (const line of p.lines) for (const s of line.stops) assert.ok(ids.has(s), `${id} ${line.id}: stop ${s} exists`);
  }
});

test("Boston in 1986 is the hand-built MBTA, with the Washington Street Elevated", () => {
  const p = pack("boston");
  const { net, reason } = cityNetwork(p, metro(p, "1980s", 1986), RECT);
  assert.equal(reason, null);
  assert.equal(net.name, "MBTA");
  assert.deepEqual(net.fare, { amount: 3, coin: "gp" });
  assert.equal(net.cars.subway.sound, CITY_SOUND);
  const names = new Set(net.stations.map((s) => s.name));
  for (const old of ["Dudley", "Egleston", "Essex", "Heath Street"]) assert.ok(names.has(old), old);
  assert.ok(!names.has("Assembly"), "Assembly opened in 2014");
  assert.deepEqual(net.preset, { city: "boston", cityName: "Boston", era: "1980s", year: 1986, version: p.version });
  const trip = findTrip(normalize(net), "alewife", "wonderland", 0.01);
  assert.ok(trip, "Alewife to Wonderland");
});

test("modern Boston comes from the map data", () => {
  const p = pack("boston");
  const { net } = cityNetwork(p, metro(p, "modern", 2026), RECT);
  const names = new Set(net.stations.map((s) => s.name));
  assert.ok(names.has("Assembly"));
  assert.ok(net.lines.some((l) => l.name.startsWith("Green Line")));
  assert.deepEqual(net.fare, { amount: 24, coin: "ep" });
});

test("a year shows only what had opened", () => {
  const p = pack("washington");
  const lines = (year) => cityNetwork(p, metro(p, "1980s", year), RECT).net.lines.map((l) => l.name);
  assert.ok(!lines(1986).some((n) => /Green|Silver/.test(n)), "no Green or Silver line in 1986");
  assert.ok(lines(1995).some((n) => /Green/.test(n)), "Green line by 1995");
  const stations = new Set(cityNetwork(p, metro(p, "1980s", 1986), RECT).net.stations.map((s) => s.name));
  assert.ok(!stations.has("Glenmont"), "Glenmont opened in 1998");
  assert.ok(stations.has("National Airport"), "the airport station's 1986 name");
});

test("a scene smaller than the metro only gets the stations on it", () => {
  const p = pack("boston");
  const all = cityNetwork(p, metro(p, "modern", 2026), RECT).net;
  const core = cityNetwork(p, { city: "boston", era: "modern", year: 2026, extent: "core", bounds: null }, RECT).net;
  assert.ok(core.stations.length < all.stations.length);
  for (const s of core.stations) assert.ok(s.x >= -200 && s.y >= -200 && s.x <= RECT.width + 200 && s.y <= RECT.height + 200);
});

test("a city with no rail yet says so", () => {
  const p = pack("st-louis");
  const { net, reason } = cityNetwork(p, metro(p, "1980s", 1986), RECT);
  assert.equal(net.lines.length, 0);
  assert.match(reason, /no rail transit in 1986.*1993/);
});

test("services that became the same train are kept once", () => {
  const lines = [
    { id: "red", name: "North–South Line", stops: ["a", "b", "c"] },
    { id: "gold", name: "North–South Line", stops: ["c", "b", "a"] },
    { id: "blue", name: "East–West Line", stops: ["x", "b", "y"] }
  ];
  assert.deepEqual(dropDuplicateServices(lines).map((l) => l.id), ["red", "blue"]);
});
