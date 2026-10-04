import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO, KM_PER_PX } from "../scripts/demo-network.mjs";
import { findTrip, normalize } from "../scripts/network.mjs";
import { DEFAULT_THEME, THEMES, pickTheme, segmentTheme, stationTheme, themeChoices } from "../scripts/themes.mjs";

const fresh = () => normalize(structuredClone(DEMO));
const line = (net, id) => net.lines.find((l) => l.id === id);
const station = (net, id) => net.stations.find((s) => s.id === id);

test("an unset theme at every level falls back to Modern", () => {
  assert.equal(pickTheme(null, undefined, "", "nonsense"), DEFAULT_THEME);
  assert.equal(DEFAULT_THEME, "modern");
});

test("the most specific theme wins: stop, then line, then scene, then world", () => {
  const net = fresh();
  const central = line(net, "central");
  const a = station(net, "a");
  assert.equal(stationTheme(net, central, a, "future"), "future");
  net.theme = "fantasy";
  assert.equal(stationTheme(net, central, a, "future"), "fantasy");
  central.theme = "industrial";
  assert.equal(stationTheme(net, central, a, "future"), "industrial");
  a.theme = "modern";
  assert.equal(stationTheme(net, central, a, "future"), "modern");
});

test("a stop's theme covers the track either side, the stop ahead winning", () => {
  const net = fresh();
  const central = line(net, "central");
  station(net, "b").theme = "fantasy";
  station(net, "c").theme = "future";
  assert.equal(segmentTheme(net, central, station(net, "a"), station(net, "b"), "modern"), "fantasy");
  assert.equal(segmentTheme(net, central, station(net, "b"), station(net, "c"), "modern"), "future");
  assert.equal(segmentTheme(net, central, station(net, "c"), station(net, "b"), "modern"), "fantasy");
  assert.equal(segmentTheme(net, central, station(net, "d"), station(net, "e"), "modern"), "modern");
});

test("trips carry each stretch's and platform's theme", () => {
  const net = fresh();
  net.theme = "future";
  // f to j crosses from the Central Line onto the Valley Railway, which is always Industrial.
  const trip = findTrip(net, "e", "j", KM_PER_PX, "modern");
  assert.deepEqual(trip.segments.map((s) => s.theme), ["future", "industrial"]);
  assert.equal(trip.platforms.e, "future");
  // At the transfer, the platform looks like the line being boarded.
  assert.equal(trip.platforms.f, "industrial");
});

test("platforms are underground where a tunnel reaches them, unless set", () => {
  const net = fresh();
  let trip = findTrip(net, "a", "d", KM_PER_PX);
  assert.equal(trip.platformKinds.a, "underground");
  assert.equal(trip.platformKinds.c, "underground");
  assert.equal(trip.platformKinds.d, "above");
  station(net, "a").platform = "above";
  station(net, "d").platform = "underground";
  trip = findTrip(net, "a", "d", KM_PER_PX);
  assert.equal(trip.platformKinds.a, "above");
  assert.equal(trip.platformKinds.d, "underground");
});

test("old networks without themes still load", () => {
  const net = normalize({ name: "Old", stationStyle: "tile", stations: [{ id: "x", name: "X" }], lines: [{ id: "l", stops: ["x"] }] });
  assert.equal(net.stations[0].theme, null);
  assert.equal(net.stations[0].platform, "auto");
  assert.equal(net.lines[0].theme, null);
});

test("the editor's picker names what an unset theme inherits", () => {
  const choices = themeChoices(null, "industrial");
  assert.equal(choices[0].label, "Inherit (Industrial)");
  assert.ok(choices[0].selected);
  assert.equal(choices.length, Object.keys(THEMES).length + 1);
  assert.ok(themeChoices("future", "modern").find((c) => c.key === "future").selected);
});