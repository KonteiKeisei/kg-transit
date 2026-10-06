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

test("the cabin sounds follow the clock: taxi loop, takeoff into the climb, jets, landing through the rollout", async () => {
  const { cabinSounds, TAKEOFF_SECONDS, TAKEOFF_SOUND_LEAD, TOUCHDOWN_AT, LANDING_SOUND_LENGTH, ROLLOUT_SECONDS } = await import("../scripts/taxi-view.mjs");
  // The captain speaks from the start of taxiing out, the taxi loop lower under it; then the loop alone.
  assert.deepEqual(cabinSounds("taxiOut", 300, 0), { taxi: 0.6, jets: 0, briefing: 0, takeoff: null, landing: null, landingBriefing: null });
  assert.equal(cabinSounds("taxiOut", 300, 30).briefing, 30);
  assert.deepEqual(cabinSounds("taxiOut", 120, 60), { taxi: 1, jets: 0, briefing: null, takeoff: null, landing: null, landingBriefing: null });
  assert.equal(cabinSounds("taxiOut", 10, 30).briefing, null, "the takeoff cuts it short");
  // The roll begins 20 s before the end of taxiing out; the recording is where its wheels go up with the plane's.
  assert.equal(cabinSounds("taxiOut", TAKEOFF_SECONDS, 300).takeoff, TAKEOFF_SOUND_LEAD);
  assert.equal(cabinSounds("taxiOut", 7, 300).takeoff, TAKEOFF_SOUND_LEAD + 13, "wheels up at 55 s in the recording");
  assert.equal(TAKEOFF_SOUND_LEAD + 13, 55);
  assert.equal(cabinSounds("taxiOut", 15, 300).taxi, 0);
  // Into the flight the takeoff runs on to its end (62 s in by then, already fading), the cruise jets coming in under it.
  const climb = cabinSounds("air", 9000, 2);
  assert.equal(climb.takeoff, TAKEOFF_SOUND_LEAD + TAKEOFF_SECONDS + 2);
  assert.equal(climb.jets, 1);
  assert.equal(cabinSounds("air", 9000, 60).takeoff, null);
  assert.equal(cabinSounds("air", 9000, 60).jets, 1);
  // The landing: its touchdown (21 s in) on the end of the flight; nothing of the takeoff with it.
  const approach = cabinSounds("air", 10, 2);
  assert.deepEqual([approach.landing, approach.takeoff, approach.jets], [TOUCHDOWN_AT - 10, null, 0]);
  assert.equal(cabinSounds("air", 0.001, 9000).landing.toFixed(2), String(TOUCHDOWN_AT.toFixed(2)));
  // Through the rollout, then the taxi loop; the landing ends with its recording.
  assert.equal(cabinSounds("taxiIn", 600, 3).landing, TOUCHDOWN_AT + 3);
  assert.equal(cabinSounds("taxiIn", 600, ROLLOUT_SECONDS + 3).taxi, 1);
  assert.equal(cabinSounds("taxiIn", 600, LANDING_SOUND_LENGTH).landing, null);
  // The captain's landing word: from the start of the descent (as the cabin comes up), on into the rollout.
  const { LANDING_SECONDS, LANDING_BRIEFING_LENGTH } = await import("../scripts/taxi-view.mjs");
  assert.equal(cabinSounds("air", 60, 9000).landingBriefing, null);
  assert.equal(cabinSounds("air", LANDING_SECONDS + 1, 9000).landingBriefing, 0);
  assert.equal(cabinSounds("air", 5, 9000).landingBriefing, LANDING_SECONDS + 1 - 5);
  assert.equal(cabinSounds("taxiIn", 600, 10).landingBriefing, LANDING_SECONDS + 1 + 10);
  assert.equal(cabinSounds("taxiIn", 600, LANDING_BRIEFING_LENGTH).landingBriefing, null);
  // The GM's own clips run their own length.
  assert.equal(cabinSounds("taxiOut", 300, 70, { briefing: 90 }).briefing, 70);
  assert.equal(cabinSounds("taxiOut", 300, 20, { briefing: 15 }).briefing, null);
  assert.equal(cabinSounds("taxiIn", 600, 50, { landingBriefing: 120 }).landingBriefing, LANDING_SECONDS + 1 + 50);
  assert.deepEqual(cabinSounds("deplane", 100, 10), { taxi: 0, jets: 0, briefing: null, takeoff: null, landing: null, landingBriefing: null });
});

test("the landing: sky, the ground coming up, the flare, and touchdown at the rollout's speed", async () => {
  const { landingState, taxiInState, LANDING_SECONDS } = await import("../scripts/taxi-view.mjs");
  assert.equal(landingState(LANDING_SECONDS).climb, 1, "only sky as it begins");
  const climbs = [16, 12, 8, 4, 0].map((l) => landingState(l).climb);
  assert.ok(climbs.every((c, i) => !i || c < climbs[i - 1]), "coming down");
  assert.equal(landingState(0).climb, 0, "wheels on the runway");
  assert.ok(landingState(1).pitch > landingState(10).pitch, "the flare");
  assert.equal(landingState(0).speed, taxiInState(0).speed, "the rollout carries on at the same speed");
  assert.ok(Math.abs(landingState(0).pitch - taxiInState(0).pitch) < 1e-9, "and the same nose");
});