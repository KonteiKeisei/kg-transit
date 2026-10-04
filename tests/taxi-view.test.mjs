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

test("the cabin sounds: taxi loop, takeoff on the roll, jets after it, landing touchdown on the rollout", async () => {
  const { cabinSounds, TAKEOFF_SOUND_LEAD, TOUCHDOWN_AT } = await import("../scripts/taxi-view.mjs");
  assert.deepEqual(cabinSounds("taxiOut", 120, 30), { taxi: 1, jets: 0, takeoff: null, landing: null });
  // The roll begins 20 s before the end of taxiing out: the takeoff recording starts, past its spool-up lead.
  assert.equal(cabinSounds("taxiOut", 20, 300).takeoff, TAKEOFF_SOUND_LEAD);
  assert.equal(cabinSounds("taxiOut", 15, 300).takeoff, TAKEOFF_SOUND_LEAD + 5, "joined late, it catches up");
  assert.equal(cabinSounds("taxiOut", 15, 300, { takeoff: 7 }).takeoff, null, "started once");
  assert.equal(cabinSounds("taxiOut", 15, 300, { takeoff: 7 }).taxi, 0);
  // In the air the cruise jets wait for the takeoff recording to fade.
  assert.equal(cabinSounds("air", 3000, 10, { takeoff: 32 }).jets, 0);
  assert.equal(cabinSounds("air", 3000, 60, { takeoff: Infinity }).jets, 1);
  assert.equal(cabinSounds("air", 3000, 60).jets, 1, "skipped the takeoff: jets straight away");
  // The landing starts so its touchdown falls on the end of the flight.
  assert.equal(cabinSounds("air", TOUCHDOWN_AT, 9000).landing, 0);
  assert.equal(cabinSounds("air", 10, 9000, { takeoff: Infinity }).landing, TOUCHDOWN_AT - 10);
  assert.equal(cabinSounds("air", 10, 9000, { takeoff: Infinity, landing: 11 }).jets, 0);
  // Skipped to taxiing in: the landing from the rollout, then the taxi loop after it.
  assert.equal(cabinSounds("taxiIn", 600, 3).landing, TOUCHDOWN_AT + 3);
  assert.equal(cabinSounds("taxiIn", 600, 30, { landing: 50 }).taxi, 1);
  assert.equal(cabinSounds("taxiIn", 600, 5, { landing: 26 }).taxi, 0);
  assert.deepEqual(cabinSounds("deplane", 100, 10), { taxi: 0, jets: 0, takeoff: null, landing: null });
});
