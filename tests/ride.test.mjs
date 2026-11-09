import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO, KM_PER_PX } from "../scripts/demo-network.mjs";
import { findTrip, normalize } from "../scripts/network.mjs";
import { RideController } from "../scripts/ride.mjs";

test("emergency stop cannot be undone by an in-flight fast-travel tick", async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let tick;
  globalThis.setInterval = (fn) => { tick = fn; return 1; };
  globalThis.clearInterval = () => {};
  let releaseAdvance;
  let advanceStarted;
  const started = new Promise((resolve) => { advanceStarted = resolve; });
  const advancing = new Promise((resolve) => { releaseAdvance = resolve; });
  const writes = [];
  const settled = [];
  const hooks = [];
  const scene = { id: "city", getFlag: () => DEMO };
  const controller = new RideController();
  controller.camera = { start() {}, end() {} };
  controller.bounce = { start() {}, stop() {} };
  controller.overlay = { sync() {} };
  controller.tokens = { settle: async (...args) => settled.push(args), reset() {} };
  globalThis.Hooks = { callAll: (...args) => hooks.push(args) };
  globalThis.ChatMessage = { create: async () => {} };
  globalThis.game = {
    user: { isGM: true }, users: { activeGM: { isSelf: true } },
    paused: false, scenes: { get: () => scene },
    time: {
      worldTime: 0,
      advance: async (seconds) => {
        advanceStarted();
        await advancing;
        game.time.worldTime += seconds;
      }
    },
    settings: { set: async (module, key, value) => {
      writes.push(value);
      controller.onRideChanged(value);
    } }
  };
  const trip = findTrip(normalize(DEMO), "a", "d", KM_PER_PX);
  const ride = {
    id: "ride", sceneId: "city", start: 0, trip, riders: [],
    tokenIds: [], ff: { from: 0, to: 0.5, ms: 1, then: "ride" }
  };
  try {
    controller.onRideChanged(ride);
    controller.ffSeenAt = performance.now() - 100;
    const ticking = tick();
    await started;
    const stopping = controller.emergencyStop();
    releaseAdvance();
    await ticking;
    await stopping;
    assert.deepEqual(writes.at(-1), {}, "active ride must remain cleared");
    assert.equal(controller.ride, null);
    assert.equal(controller.timer, null);
    assert.equal(settled.length, 1);
    assert.ok(settled[0][3], "riders get off at the emergency position");
    assert.equal(hooks.at(-1)[2].emergency, true);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("a second GM's emergency stop reaches the active GM, closes both clients and deposits tokens", async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
  const driver = { id: "driver", isGM: true, get isSelf() { return game.user.id === this.id; } };
  const requester = { id: "requester", isGM: true };
  const player = { id: "player", isGM: false };
  const users = [driver, requester, player];
  const listeners = [];
  const packets = [];
  const updates = [];
  const views = [];
  const trip = findTrip(normalize(DEMO), "a", "d", KM_PER_PX);
  const ride = {
    id: "ride", sceneId: "city", start: 0, trip,
    riders: [{ id: "pc1" }], tokenIds: ["party", "hero"], partyTokenId: "party", ff: null
  };
  const tokens = new Map([
    ["party", { id: "party", actorId: "group", actor: { type: "group" }, width: 1, height: 1 }],
    ["hero", { id: "hero", actorId: "pc1", actor: { type: "character" }, width: 1, height: 1 }]
  ]);
  const scene = {
    id: "city", grid: { size: 100 }, tokens,
    dimensions: { sceneRect: { x: 0, y: 0, width: 8000, height: 4000 } },
    getFlag: () => DEMO,
    updateEmbeddedDocuments: async (type, data) => updates.push({ type, data })
  };
  let savedRide = ride;
  const controllers = users.map(() => {
    const controller = new RideController();
    controller.camera = { start() {}, end() {} };
    controller.bounce = { start() {}, stop() {} };
    controller.overlay = { sync: (value) => views.push(value) };
    return controller;
  });
  globalThis.Hooks = { on() {}, callAll() {} };
  globalThis.ChatMessage = { create: async () => {} };
  globalThis.game = {
    user: driver, users: { activeGM: driver, get: (id) => users.find((u) => u.id === id) },
    paused: false, scenes: { get: () => scene },
    time: { worldTime: 60, advance: async () => { throw new Error("Emergency stop must not wait on the clock"); } },
    socket: {
      on: (channel, handler) => listeners.push(handler),
      emit: (channel, packet) => packets.push(packet)
    },
    settings: {
      get: () => savedRide,
      set: async (module, key, value) => {
        savedRide = value;
        const previous = game.user;
        controllers.forEach((controller, i) => {
          game.user = users[i];
          controller.onRideChanged(value);
        });
        game.user = previous;
      }
    }
  };
  try {
    controllers.forEach((controller, i) => {
      game.user = users[i];
      controller.init();
    });
    game.user = requester;
    await controllers[1].emergencyStop();
    assert.equal(packets.length, 1, "second GM sends a stop request");
    game.user = driver;
    await listeners[0](packets[0]);
    assert.deepEqual(savedRide, {});
    assert.ok(controllers.every((controller) => controller.ride === null && controller.timer === null));
    assert.equal(views.filter((value) => value === null).length, 3, "every client closes its overlay");
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].data.map((t) => t._id), ["party", "hero"]);

    savedRide = { ...ride, id: "new-ride" };
    controllers[0].onRideChanged(savedRide);
    await listeners[0](packets[0]);
    assert.equal(savedRide.id, "new-ride", "an old stop request cannot end a different ride");
    await listeners[0]({ ...packets[0], rideId: "new-ride", userId: player.id });
    assert.equal(savedRide.id, "new-ride", "players cannot send GM stop requests");
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
