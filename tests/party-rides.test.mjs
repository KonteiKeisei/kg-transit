import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO, KM_PER_PX } from "../scripts/demo-network.mjs";
import { findTrip, normalize } from "../scripts/network.mjs";

globalThis.foundry = {
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (base) => base } },
  utils: { randomID: (() => { let n = 0; return () => `ride${++n}`; })() }
};
const { RideController, partyRides } = await import("../scripts/ride.mjs");
const { BoardDialog } = await import("../scripts/board-dialog.mjs");
const { planTrain, stationAt } = await import("../scripts/party-handoff.mjs");

test("the train for a trip: the stations nearest each end, on a line that joins them", () => {
  world();
  // 100 px a grid space of 0.2 km: the demo's scale (0.002 km a pixel).
  const scene = { grid: { size: 100, distance: 0.2, units: "km" }, getFlag: () => DEMO };
  // From beside Northgate (600, 400) to beside Riverside (2300, 1500): the Central line.
  const plan = planTrain(scene, { x: 560, y: 380 }, { x: 2350, y: 1540 });
  assert.equal(plan.originId, "a");
  assert.equal(plan.destinationId, "d");
  assert.equal(plan.originName, "Northgate");
  assert.ok(plan.seconds > 0 && plan.legs.length === 1);
  // A trip across the harbour line changes at Central.
  const change = planTrain(scene, { x: 600, y: 420 }, { x: 3000, y: 2780 });
  assert.equal(change.destinationId, "i");
  assert.equal(change.legs.length, 2);
  // Standing at a station, or nowhere near one.
  assert.equal(stationAt(scene, { x: 1120, y: 790 }), "b");
  assert.equal(stationAt(scene, { x: 5000, y: 300 }), null);
  // An arriving party offers the trains only when it is set down on the station, not near it.
  assert.equal(stationAt(scene, { x: 1300, y: 800 }), "b", "within four grid spaces");
  assert.equal(stationAt(scene, { x: 1300, y: 800 }, 50), null, "but not on it");
  assert.equal(stationAt(scene, { x: 1120, y: 790 }, 50), "b", "on it");
  // No network on a scene: no train.
  assert.equal(planTrain({ grid: scene.grid, getFlag: () => null }, { x: 0, y: 0 }, { x: 10, y: 10 }), null);
});

/** A world with KG Cities active, two party tokens on a scene, and stored settings. */
function world({ cities = true } = {}) {
  const store = { activeRide: {}, activeRides: {} };
  const updates = [];
  const tokens = new Map([
    ["crew", { id: "crew", actorId: "g1", actor: { type: "group" }, width: 1, height: 1 }],
    ["duo", { id: "duo", actorId: "g2", actor: { type: "group" }, width: 1, height: 1 }]
  ]);
  const scene = {
    id: "city", grid: { size: 100 }, tokens,
    dimensions: { sceneRect: { x: 0, y: 0, width: 8000, height: 4000 } },
    getFlag: () => DEMO,
    updateEmbeddedDocuments: async (type, data) => updates.push(data.map((d) => d._id))
  };
  let controller;
  globalThis.Hooks = { on() {}, callAll() {} };
  globalThis.ChatMessage = { create: async () => {} };
  globalThis.game = {
    modules: { get: (id) => (id === "kg-cities" && cities ? { active: true } : null) },
    user: { id: "gm", isGM: true }, users: Object.assign([], { activeGM: { isSelf: true } }),
    actors: { get: () => null },
    paused: false, scenes: { get: () => scene },
    time: { worldTime: 0, advance: async (s) => { game.time.worldTime += s; } },
    socket: { on() {}, emit() {} },
    togglePause() {},
    settings: {
      get: (m, k) => store[k],
      set: async (m, k, v) => { store[k] = v; controller.sync(k === "activeRide" ? { one: v } : { many: v }); }
    }
  };
  controller = new RideController();
  controller.camera = { start() {}, end() {} };
  controller.bounce = { start() {}, stop() {} };
  controller.overlay = { sync() {} };
  return { controller, store, updates, scene };
}

const trip = (from, to) => findTrip(normalize(DEMO), from, to, KM_PER_PX);
const board = (controller, partyTokenId, t) => controller.start({ trip: t, networkName: "Demo", riders: [{ id: partyTokenId, name: partyTokenId }], waived: [], charged: [], showToAll: false, sceneId: "city", tokenIds: [partyTokenId], partyTokenId, label: partyTokenId });

test("without KG Cities, there are no party rides", () => {
  world({ cities: false });
  assert.equal(partyRides(), false);
  world();
  assert.equal(partyRides(), true);
});

test("two parties ride at once, on one clock; one gets off, the other rides on", async () => {
  const originalSetInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval;
  let tick;
  globalThis.setInterval = (fn) => { tick = fn; return 1; };
  globalThis.clearInterval = () => {};
  try {
    const { controller, store } = world();
    controller.init();
    const short = trip("a", "b"), long = trip("a", "d");
    assert.ok(short.total < long.total);
    await board(controller, "crew", long);
    await board(controller, "duo", short);
    assert.equal(Object.keys(store.activeRides).length, 2, "both rides stored, one per party");
    assert.deepEqual(store.activeRide, {}, "the single ride stays empty");
    assert.ok(controller.partyRide("crew") && controller.partyRide("duo"));
    // Run the clock past the short ride's end: it gets off, the long one rides on.
    controller.lastTick = performance.now() - (short.total + 1) * 1000;
    await tick();
    assert.equal(controller.partyRide("duo"), null, "the short ride ended");
    assert.ok(controller.partyRide("crew"), "the long ride goes on");
    assert.ok(game.time.worldTime >= short.total, "the shared clock moved");
    assert.ok(controller.timer, "the clock keeps running for the ride still going");
    // An emergency stop ends only its own ride.
    await controller.emergencyStop(controller.partyRide("crew").id);
    assert.deepEqual(store.activeRides, {});
    assert.equal(controller.timer, null);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("the GM sees the ride of the party token they have selected, and none with none selected", async () => {
  const { controller } = world();
  globalThis.setInterval = () => 1;
  globalThis.canvas = { tokens: { controlled: [] } };
  controller.init();
  await board(controller, "crew", trip("a", "d"));
  await board(controller, "duo", trip("a", "b"));
  const crew = controller.partyRide("crew"), duo = controller.partyRide("duo");
  assert.equal(controller.ride, null, "nothing selected, no ride window");
  canvas.tokens.controlled = [{ document: { id: "duo" } }];
  controller.followSelection();
  assert.equal(controller.ride.id, duo.id, "the selected party's ride");
  canvas.tokens.controlled = [{ document: { id: "duo" } }, { document: { id: "crew" } }];
  controller.followSelection();
  assert.equal(controller.ride.id, crew.id, "the last selected first");
  canvas.tokens.controlled = [];
  controller.followSelection();
  assert.equal(controller.ride, null, "deselected: closed");
  assert.equal(controller.watchable().length, 2, "the GM may still watch every ride from the tabs");
});

test("a party boards as a party: its members ride, a party of one as that one, a vehicle stays", async () => {
  world();
  const person = (id, extra = {}) => ({ id, name: id, type: "character", hasPlayerOwner: true, system: { currency: {} }, getFlag: () => null, ...extra });
  const pierre = person("pierre"), dot = person("dot"), car = person("mustang", { type: "vehicle" });
  const crew = { id: "g1", type: "group", system: { members: [{ actor: pierre }, { actor: dot }, { actor: car }], currency: {} } };
  const solo = { id: "g2", type: "group", system: { members: [{ actor: dot }], currency: {} } };
  const at = (id, actor, x) => ({ id, name: id === "crew-token" ? "The Crew" : "Dot", actor, center: { x, y: 400 } });
  const tokens = [at("crew-token", crew, 600), at("solo-token", solo, 7000)];
  game.actors = [pierre, dot, car, crew, solo];
  globalThis.canvas = {
    scene: { grid: { size: 100 }, tokens: [], getFlag: () => DEMO },
    tokens: { placeables: tokens, controlled: [], get: (id) => tokens.find((t) => t.id === id) }
  };
  const ride = { partyRide: () => null };
  const near = new BoardDialog({ originId: "a", layer: {}, ride });
  assert.deepEqual([...near.selected].sort(), ["dot", "pierre"], "the party at the station rides, not its car");
  assert.deepEqual(near.tokenIds, ["crew-token"], "only the party token moves along the line");
  assert.equal(near.title.endsWith("The Crew"), true);
  // The selected party token boards, wherever it stands: a party of one.
  canvas.tokens.controlled = [tokens[1]];
  const one = new BoardDialog({ originId: "a", layer: {}, ride });
  assert.deepEqual([...one.selected], ["dot"]);
  assert.equal(one.party, solo, "its purse can pay");
  // A party already riding cannot board again.
  const busy = new BoardDialog({ originId: "a", layer: {}, ride: { partyRide: () => ({ id: "x" }) } });
  assert.equal(busy.alreadyRiding, true);
});
