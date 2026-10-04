import { test } from "node:test";
import assert from "node:assert/strict";
import { darkness } from "../scripts/plane-lights.mjs";

test("a plane's lights are off by day, full at night, and fade through dusk and dawn", () => {
  assert.equal(darkness(12), 0);
  assert.equal(darkness(16, 59), 0);
  assert.equal(darkness(22), 1);
  assert.equal(darkness(2), 1);
  const dusk = darkness(18);
  assert.ok(dusk > 0 && dusk < 1, "half lit at 6 PM");
  assert.ok(darkness(19) > dusk, "darker as dusk goes on");
  const dawn = darkness(6);
  assert.ok(dawn > 0 && dawn < 1, "fading at 6 AM");
  assert.ok(darkness(7) < dawn, "lighter as dawn goes on");
  assert.equal(darkness(8), 0);
});
