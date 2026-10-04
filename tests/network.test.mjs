import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO, KM_PER_PX, starterNetwork } from "../scripts/demo-network.mjs";
import { findTrip, lighten, linesAt, normalize, runSeconds, truncateTrip, tripStops } from "../scripts/network.mjs";

const net = normalize(DEMO);
const trip = (a, b) => findTrip(net, a, b, KM_PER_PX);

test("normalize fills gaps and keeps segments in step with stops", () => {
  const n = normalize({ lines: [{ id: "x", stops: ["s1", "s2", "ghost", "s3"] }], stations: [{ id: "s1" }, { id: "s2" }, { id: "s3" }] });
  assert.deepEqual(n.lines[0].stops, ["s1", "s2", "s3"]);
  assert.equal(n.lines[0].segments.length, 2);
  assert.equal(n.lines[0].segments[0].scenery, "tunnel-concrete");
  assert.equal(n.fare.coin, "sp");
  assert.deepEqual(normalize(undefined).lines, []);
});

test("transfer stations are the ones on more than one line", () => {
  assert.deepEqual(linesAt(net, "c").map((l) => l.id), ["central", "harbour"]);
  assert.deepEqual(linesAt(net, "b").map((l) => l.id), ["central", "oldtown"]);
  assert.deepEqual(linesAt(net, "d").map((l) => l.id), ["central"]);
});

test("running time comes from map distance and line speed, or the GM's minutes", () => {
  const central = net.lines[0];
  // Northgate to Market Square: 640 px = 1.28 km at 36 km/h, about 128 s.
  assert.ok(Math.abs(runSeconds(net, central, 0, KM_PER_PX) - 128) <= 2);
  const valley = net.lines[2];
  assert.equal(runSeconds(net, valley, 2, KM_PER_PX), 12 * 60);
  // Unplaced stops fall back on a default.
  const unplaced = normalize({ lines: [{ id: "x", stops: ["p", "q"] }], stations: [{ id: "p" }, { id: "q" }] });
  assert.equal(runSeconds(unplaced, unplaced.lines[0], 0, KM_PER_PX), 120);
});

test("a ride on one line", () => {
  const t = trip("a", "d");
  assert.equal(t.legs.length, 1);
  assert.equal(t.legs[0].label, "Central Line toward Valley Junction");
  assert.deepEqual(tripStops(t), ["a", "b", "c", "d"]);
  assert.equal(t.names.d, "Riverside");
  assert.equal(t.lines.central.color, "#d6312b");
  assert.equal(t.lines.central.car, "subway");
});

test("riding backwards names the other end", () => {
  assert.equal(trip("d", "a").legs[0].label, "Central Line toward Northgate");
});

test("changing trains at a transfer", () => {
  const t = trip("a", "h");
  assert.deepEqual(t.legs.map((l) => l.line), ["central", "harbour"]);
  assert.equal(t.transfers[0].station, "c");
  assert.equal(t.transfers[0].seconds, 4 * 60);
});

test("steam lines ride in the steam coach", () => {
  const t = trip("e", "k");
  assert.equal(t.lines.valley.car, "steam");
  assert.equal(t.segments.at(-1).env, "forest");
});

test("the timeline is continuous and scenery follows the segments", () => {
  const t = trip("a", "i");
  let last = 0;
  for (const s of t.segments) {
    assert.ok(s.depart >= last);
    assert.ok(s.arrive > s.depart);
    last = s.arrive;
  }
  assert.equal(t.total, last);
  assert.deepEqual(t.segments.map((s) => s.env), ["tunnel-concrete", "tunnel-concrete", "tunnel-brick", "dockside", "coast"]);
});

test("unconnected or identical stops have no trip", () => {
  const island = normalize({ ...DEMO, stations: [...DEMO.stations, { id: "z", name: "Island", x: 0, y: 0 }] });
  assert.equal(findTrip(island, "a", "z", KM_PER_PX), null);
  assert.equal(trip("a", "a"), null);
});

test("getting off early ends at the next stop", () => {
  const t = trip("a", "f");
  const cut = truncateTrip(t, t.segments[2].depart + 5);
  assert.equal(cut.to, t.segments[2].to);
  assert.equal(cut.total, t.segments[2].arrive);
  assert.deepEqual(cut.legs[0].stops, ["a", "b", "c", "d"]);
});

test("a new scene starts with the sample network, every stop waiting to be placed", () => {
  const n = normalize(starterNetwork());
  assert.equal(n.lines.length, 4);
  assert.ok(n.stations.every((s) => s.x === null && s.y === null));
  assert.equal(n.partyTokenId, null);
  // Without positions it still routes, on default times.
  assert.ok(findTrip(n, "a", "l", KM_PER_PX));
  // And it is a copy: the sample keeps its positions.
  assert.equal(DEMO.stations[0].x, 600);
});

test("lighten makes a paler shade", () => {
  assert.equal(lighten("#000000", 0.5), "#808080");
});

test("the next stop and the stop the train stands at", async () => {
  const { nextStop, standingAt, endAfterSegment } = await import("../scripts/network.mjs");
  const trip = { from: "a", to: "c", legs: [{ lineId: "l", stops: ["a", "b", "c"] }], transfers: [], names: {}, total: 230,
    segments: [{ legIndex: 0, from: "a", to: "b", depart: 0, arrive: 100 }, { legIndex: 0, from: "b", to: "c", depart: 130, arrive: 230 }] };
  assert.deepEqual(nextStop(trip, 10), { index: 0, arrive: 100 });
  assert.deepEqual(nextStop(trip, 110), { index: 1, arrive: 230 });
  assert.equal(nextStop(trip, 230), null);
  assert.equal(standingAt(trip, 50), -1);
  assert.equal(standingAt(trip, 115), 0);
  assert.equal(standingAt(trip, 150), -1);
  const off = endAfterSegment(trip, 0);
  assert.equal(off.to, "b");
  assert.equal(off.total, 100);
});