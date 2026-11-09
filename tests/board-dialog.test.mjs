import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO } from "../scripts/demo-network.mjs";

globalThis.foundry = {
  applications: { api: {
    ApplicationV2: class {},
    HandlebarsApplicationMixin: (base) => base
  } }
};
const { BoardDialog } = await import("../scripts/board-dialog.mjs");

test("rail boarding lists only player-owned characters with tokens on the viewed scene", async () => {
  const actor = (id, type = "character", owned = true) => ({
    id, name: id, type, hasPlayerOwner: owned, system: { currency: {} }
  });
  const near = actor("near");
  const far = actor("far");
  const elsewhere = actor("elsewhere");
  const unowned = actor("unowned", "character", false);
  const npc = actor("npc", "npc");
  const group = actor("group", "group");
  group.system.members = [{ actor: elsewhere }, { actor: near }];
  const tokens = [
    { id: "near-token", actor: near, center: { x: 600, y: 400 } },
    { id: "near-copy", actor: near, center: { x: 600, y: 400 } },
    { id: "far-token", actor: far, center: { x: 7000, y: 3000 } },
    { id: "unowned-token", actor: unowned, center: { x: 600, y: 400 } },
    { id: "npc-token", actor: npc, center: { x: 600, y: 400 } },
    { id: "group-token", actor: group, center: { x: 600, y: 400 } }
  ];
  globalThis.game = {
    actors: [near, far, elsewhere, unowned, npc, group],
    settings: { get: () => false }
  };
  globalThis.canvas = {
    scene: {
      grid: { size: 100 },
      tokens: tokens.map((t) => ({ actorId: t.actor.id })),
      getFlag: () => DEMO
    },
    tokens: { placeables: tokens, get: (id) => tokens.find((t) => t.id === id) }
  };
  const dialog = new BoardDialog({ originId: "a", layer: {}, ride: {} });
  const context = await dialog._prepareContext();
  assert.deepEqual(context.riders.map((r) => r.id), ["near", "far"]);
  assert.equal(context.riders[0].checked, true, "nearby character remains selected");
  assert.equal(context.riders[1].checked, false, "distant scene character remains optional");

  canvas.scene.tokens = [];
  canvas.tokens.placeables = [];
  const empty = new BoardDialog({ originId: "a", layer: {}, ride: {} });
  assert.deepEqual((await empty._prepareContext()).riders, []);
});
