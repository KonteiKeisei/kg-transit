import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO, KM_PER_PX } from "../scripts/demo-network.mjs";
import { findTrip, normalize } from "../scripts/network.mjs";

// A scene holding the demo network, with a party token and one rider's token, recording
// token updates.
function mockWorld(network = DEMO) {
  const tokens = new Map([
    ["party", { id: "party", actorId: "group1", actor: { type: "group" }, width: 1, height: 1 }],
    ["hero", { id: "hero", actorId: "pc1", actor: { type: "character" }, width: 1, height: 1 }]
  ]);
  const updates = [];
  const scene = {
    id: "city",
    grid: { size: 100 },
    dimensions: { sceneRect: { x: 0, y: 0, width: 8000, height: 4000 } },
    tokens,
    getFlag: (module, key) => (module === "kg-transit" && key === "network" ? network : undefined),
    updateEmbeddedDocuments: async (type, data, options) => updates.push({ type, data, options })
  };
  globalThis.game = { scenes: { get: (id) => (id === "city" ? scene : null) } };
  return { scene, updates };
}

const net = normalize(DEMO);
const ride = (from, to) => ({ trip: findTrip(net, from, to, KM_PER_PX), sceneId: "city", tokenIds: ["party", "hero"], riders: [{ id: "pc1" }] });

test("tokens glide along the line single file, the party token in front", async () => {
  const { updates } = mockWorld();
  const { TokenTrain } = await import("../scripts/follow.mjs");
  const train = new TokenTrain();
  const r = ride("a", "d");
  await train.step(r, 0, 1000);
  await train.step(r, 60, 1000);
  assert.equal(updates.length, 2);
  const [first, second] = updates;
  assert.equal(first.options.animation.duration, 1000);
  const party = (u) => u.data.find((d) => d._id === "party");
  const hero = (u) => u.data.find((d) => d._id === "hero");
  // Starts on Northgate (600, 400), centred.
  assert.deepEqual([party(first).x, party(first).y], [550, 350]);
  assert.notDeepEqual([party(first).x, party(first).y], [party(second).x, party(second).y], "moved");
  // At the origin the hero waits on the stop; under way it follows 90 px behind on the track.
  assert.deepEqual([hero(first).x, hero(first).y], [550, 350]);
  const gap = (u) => Math.hypot(hero(u).x - party(u).x, hero(u).y - party(u).y);
  assert.ok(Math.abs(gap(second) - 90) < 2, `gap ${gap(second)}`);
});

test("no update while the train stands still", async () => {
  const { updates } = mockWorld();
  const { TokenTrain } = await import("../scripts/follow.mjs");
  const train = new TokenTrain();
  const r = ride("a", "d");
  const stop = r.trip.segments[1].depart - 10;
  await train.step(r, stop, 1000);
  await train.step(r, stop + 5, 1000);
  assert.equal(updates.length, 1);
});

test("a designated party token rides the line, whatever kind of actor it is", async () => {
  const { scene, updates } = mockWorld();
  scene.tokens.set("wagon", { id: "wagon", actorId: "npc1", actor: { type: "npc" }, width: 2, height: 2 });
  const { TokenTrain } = await import("../scripts/follow.mjs");
  const train = new TokenTrain();
  const r = { ...ride("a", "d"), tokenIds: ["hero", "wagon"], partyTokenId: "wagon" };
  await train.step(r, 0, 1000);
  const ids = updates[0].data.map((d) => d._id);
  assert.deepEqual(ids, ["wagon", "hero"]);
  // On Northgate (600, 400), centred for its 2 x 2 size.
  assert.deepEqual([updates[0].data[0].x, updates[0].data[0].y], [500, 300]);
});

test("a stop not placed on the map moves nothing", async () => {
  const unplaced = { ...DEMO, stations: DEMO.stations.map((s) => (s.id === "b" ? { ...s, x: null, y: null } : s)) };
  const { updates } = mockWorld(unplaced);
  const { TokenTrain } = await import("../scripts/follow.mjs");
  const train = new TokenTrain();
  const r = ride("a", "d");
  await train.step(r, r.trip.segments[1].depart - 5, 800);
  assert.equal(updates.length, 0);
});

test("tokens follow a curved stretch through its travel nodes", async () => {
  const curved = structuredClone(DEMO);
  const line = curved.lines.find((l) => l.stops[0] === "a" && l.stops[1] === "b") ?? curved.lines[0];
  const [from, to] = line.stops;
  const A = curved.stations.find((s) => s.id === from), B = curved.stations.find((s) => s.id === to);
  // 400 px to one side of the halfway point.
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  const bend = { x: (A.x + B.x) / 2 - ((B.y - A.y) / len) * 400, y: (A.y + B.y) / 2 + ((B.x - A.x) / len) * 400 };
  line.segments[0] = { ...line.segments[0], path: { from, to, nodes: [bend] } };
  const n = normalize(curved);
  const { updates } = mockWorld(n);
  const { TokenTrain } = await import("../scripts/follow.mjs");
  const { trainPoint } = await import("../scripts/timeline.mjs");
  const { routeShapes } = await import("../scripts/route-path.mjs");
  const trip = findTrip(n, from, to, KM_PER_PX);
  const mid = (trip.segments[0].depart + trip.segments[0].arrive) / 2;
  const p = trainPoint(trip, mid, Object.fromEntries(n.stations.map((s) => [s.id, s])), routeShapes(n));
  // Halfway in time is near the bend, well off the straight line between the stops.
  const off = Math.abs((B.x - A.x) * (A.y - p.y) - (A.x - p.x) * (B.y - A.y)) / Math.hypot(B.x - A.x, B.y - A.y);
  assert.ok(off > 150, `off the straight line by ${off}`);
  const train = new TokenTrain();
  await train.step({ trip, sceneId: "city", tokenIds: ["party", "hero"], riders: [{ id: "pc1" }] }, mid, 1000);
  const party = updates[0].data.find((d) => d._id === "party");
  assert.ok(Math.hypot(party.x + 50 - p.x, party.y + 50 - p.y) < 2);
});

test("off the train, tokens huddle below the stop with the party token in the middle", async () => {
  const { scene, updates } = mockWorld();
  for (const id of ["b1", "b2", "b3", "b4", "b5", "b6", "b7"]) scene.tokens.set(id, { id, actorId: id, actor: { type: "character" }, width: 1, height: 1 });
  const { TokenTrain, huddle } = await import("../scripts/follow.mjs");
  const ids = ["party", "hero", "b1", "b2", "b3", "b4", "b5", "b6", "b7"];
  const r = { ...ride("a", "d"), tokenIds: ids, riders: ids.map((id) => ({ id: scene.tokens.get(id).actorId })) };
  await new TokenTrain().settle(r, r.trip, 800);
  const data = updates[0].data;
  const centre = (d) => ({ x: d.x + 50, y: d.y + 50 });
  const party = centre(data.find((d) => d._id === "party"));
  const stop = DEMO.stations.find((s) => s.id === r.trip.to);
  assert.equal(party.x, stop.x);
  assert.ok(party.y > stop.y, "below the stop");
  // Six tight around the middle, the last two a ring further out; no two overlap.
  const dists = data.filter((d) => d._id !== "party").map((d) => Math.round(Math.hypot(centre(d).x - party.x, centre(d).y - party.y)));
  assert.equal(dists.filter((d) => d === 100).length, 6);
  assert.equal(dists.filter((d) => d === 200).length, 2);
  for (const a of data) for (const b of data) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 99, "no overlap");
  assert.equal(huddle(1).length, 1);
  assert.deepEqual(huddle(3).map((o) => o.ring), [0, 1, 1]);
});

test("an emergency stop leaves the tokens where the train stopped", async () => {
  const { updates } = mockWorld();
  const { TokenTrain } = await import("../scripts/follow.mjs");
  const r = ride("a", "d");
  await new TokenTrain().settle(r, r.trip, 800, { x: 2000, y: 1000 });
  const party = updates[0].data.find((d) => d._id === "party");
  assert.equal(party.x + 50, 2000);
  assert.ok(party.y + 50 > 1000);
});