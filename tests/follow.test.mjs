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

test("tokens glide along the line with the party token on it", async () => {
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
  const gap = (u) => Math.hypot(hero(u).x - party(u).x, hero(u).y - party(u).y);
  assert.ok(Math.abs(gap(first) - 60) < 2 && Math.abs(gap(second) - 60) < 2);
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
