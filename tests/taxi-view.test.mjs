import { test } from "node:test";
import assert from "node:assert/strict";
import { TAKEOFF_SECONDS, TAXI_SPEED, cabinFrame, takeoffState, taxiInState } from "../scripts/taxi-view.mjs";

test("the takeoff: taxiing, the roll speeding up, the nose up, then only sky", () => {
  assert.deepEqual(takeoffState(-5), { speed: TAXI_SPEED, pitch: 0, climb: 0, power: 0.25, runway: false });
  const speeds = [0, 4, 8, 12].map((t) => takeoffState(t).speed);
  assert.ok(speeds.every((v, i) => !i || v > speeds[i - 1]), "faster and faster");
  assert.equal(takeoffState(10).pitch, 0, "wheels down until rotation");
  assert.equal(takeoffState(10).climb, 0);
  assert.ok(takeoffState(16).pitch > 0.1, "nose up");
  assert.ok(takeoffState(16).climb > 0 && takeoffState(16).climb < 1, "climbing");
  assert.equal(takeoffState(TAKEOFF_SECONDS).climb, 1, "only sky at the end");
  assert.equal(takeoffState(12).power, 1, "full power on the roll");
});

test("taxiing in: the rollout slows to taxi speed, then a stop at the gate", () => {
  assert.ok(taxiInState(0).speed > 50 && taxiInState(0).runway);
  assert.ok(Math.abs(taxiInState(12).speed - TAXI_SPEED) < 0.5);
  assert.equal(taxiInState(60, 0).speed, 0, "stopped at the gate");
  assert.equal(taxiInState(60, 100).speed, TAXI_SPEED);
});

test("the view looks out of the cabin art's big window wherever the art is cropped", () => {
  const wide = cabinFrame(1600, 900), tall = cabinFrame(800, 900);
  assert.ok(wide.cx > 1600 * 0.75 && wide.cx < 1600 * 0.9);
  assert.ok(tall.cx > 800, "a narrow screen crops the window's middle off to the right");
});
