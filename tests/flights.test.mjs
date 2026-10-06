import { test } from "node:test";
import assert from "node:assert/strict";
import { ENCOUNTER_POINTS, fareDollars, fareLevel, midFlight, miles, minutesUntil, nextSkip, planFlight } from "../scripts/flights.mjs";

const BOS = { iata: "BOS", size: "hub", lat: 42.3656, lon: -71.0096 };
const LAX = { iata: "LAX", size: "hub", lat: 33.9416, lon: -118.4085 };
const LGA = { iata: "LGA", size: "hub", lat: 40.7769, lon: -73.874 };
const MDW = { iata: "MDW", size: "small", lat: 41.7868, lon: -87.7522 };

test("great-circle miles are right", () => {
  assert.ok(Math.abs(miles(BOS, LAX) - 2611) < 10);
  assert.ok(Math.abs(miles(BOS, LGA) - 184) < 5);
});

test("1986 coach fares follow the fare level of the half year", () => {
  // Boston to Los Angeles, first half of 1986: about $322.
  assert.equal(fareDollars(2611, fareLevel(1986, 3)), 322);
  assert.ok(fareDollars(2611, fareLevel(1986, 9)) < 322);
  // The shuttle hop: under $55.
  assert.ok(fareDollars(184, fareLevel(1986, 3)) < 55);
});

test("door to door, east and west", () => {
  const west = planFlight(BOS, LAX, { year: 1986, month: 3 });
  const east = planFlight(LAX, BOS, { year: 1986, month: 3 });
  const air = (p) => p.steps.find((s) => s.key === "air").minutes;
  // About 6 h 20 west and 5 h 10 east in the air (1986 block times, taxi aside).
  assert.ok(air(west) > 330 && air(west) < 400, `west ${air(west)}`);
  assert.ok(air(east) > 270 && air(east) < 320, `east ${air(east)}`);
  assert.ok(air(west) > air(east));
  // Same route, same airline and plane both ways.
  assert.equal(west.airline, east.airline);
  assert.equal(west.aircraft, east.aircraft);
  // Carry-on only skips the counter and the carousel.
  assert.ok(planFlight(BOS, LAX, { bags: false }).minutes < west.minutes);
});

test("encounters come in the trip's order, all inside it", () => {
  const p = planFlight(BOS, LAX, { year: 1986, month: 3 });
  const times = ENCOUNTER_POINTS.map((e) => minutesUntil(p, e.key));
  assert.deepEqual([...times].sort((a, b) => a - b), times);
  assert.ok(times[0] > 0 && times.at(-1) < p.minutes);
  // Halfway through the air time.
  const before = p.steps.slice(0, 3).reduce((s, x) => s + x.minutes, 0);
  assert.equal(minutesUntil(p, "air"), before + Math.round(p.steps[3].minutes / 2));
});

test("a small airport is quicker to get through", () => {
  const p = planFlight(MDW, LGA);
  assert.ok(p.steps.find((s) => s.key === "curb").minutes < planFlight(LGA, MDW).steps.find((s) => s.key === "curb").minutes);
});

test("the skip goes to the next step, the encounter when it comes first, then the arrival", () => {
  const plan = planFlight(BOS, LAX);
  const starts = [];
  let t = 0;
  for (const s of plan.steps) { starts.push(t); t += s.minutes * 60; }
  const labels = [];
  for (let at = 0, i = 0; i < 20; i++) {
    const next = nextSkip(plan, at);
    labels.push(next.label);
    if (next.key === "arrival") break;
    at = next.at;
  }
  assert.deepEqual(labels, ["boarding", "taxi", "takeoff", "landing", "the gate", "baggage claim", "arrival"]);
  // Partway through a step, it is still the next one.
  assert.equal(nextSkip(plan, starts[1] + 60).label, "taxi");
  assert.equal(nextSkip(plan, starts[3] + 3600).label, "landing");
  // An encounter halfway through the flight comes before landing.
  const encounter = { at: "air", minutes: minutesUntil(plan, "air"), done: false };
  const air = nextSkip(plan, starts[3] + 60, encounter);
  assert.deepEqual([air.key, air.at], ["encounter", encounter.minutes * 60]);
  assert.equal(nextSkip(plan, starts[3] + 60, { ...encounter, done: true }).label, "landing");
  // Without bags there is no carousel: the gate is the last step before arrival.
  const light = planFlight(BOS, LAX, { bags: false });
  const atGate = light.steps.slice(0, -1).reduce((s, x) => s + x.minutes * 60, 0) + 1;
  assert.equal(nextSkip(light, atGate).key, "arrival");
});
test("the weather turns to the destination's halfway through the flight", () => {
  const plan = planFlight(BOS, LAX);
  let start = 0;
  for (const s of plan.steps) {
    if (s.key === "air") break;
    start += s.minutes * 60;
  }
  const air = plan.steps.find((s) => s.key === "air").minutes * 60;
  assert.equal(midFlight(plan), start + Math.round(air / 120) * 60);
  assert.ok(midFlight(plan) > start && midFlight(plan) < start + air);
});
test("takeoff and landing are skipped to just before they happen, scaled by the GM's speed", async () => {
  const { skipPoints, TAKEOFF_LEAD, LANDING_LEAD } = await import("../scripts/flights.mjs");
  const plan = planFlight(BOS, LAX);
  const ends = {};
  let t = 0;
  for (const s of plan.steps) { t += s.minutes * 60; ends[s.key] = t; }
  const at = (key, rate) => skipPoints(plan, rate).find((p) => p.key === key).at;
  // 10 s before the 20 s takeoff roll; 10 s before touchdown (the end of the flight).
  assert.equal(at("takeoff", 1), ends.taxiOut - TAKEOFF_LEAD);
  assert.equal(at("landing", 1), ends.air - LANDING_LEAD);
  assert.equal(at("takeoff", 10), ends.taxiOut - TAKEOFF_LEAD * 10);
  assert.ok(at("taxiOut", 1) < at("takeoff", 1), "taxi still its own skip");
  // Partway through the takeoff, the next skip is the landing.
  assert.equal(nextSkip(plan, ends.taxiOut - 5).key, "landing");
});
