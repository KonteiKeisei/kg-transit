import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO, KM_PER_PX } from "../scripts/demo-network.mjs";
import { findTrip, normalize } from "../scripts/network.mjs";
import { segmentMotion, stateAt, trainPoint } from "../scripts/timeline.mjs";

const net = normalize(DEMO);
const trip = (a, b) => findTrip(net, a, b, KM_PER_PX);

test("a segment starts and ends at rest and covers it all", () => {
  const start = segmentMotion(120, 0);
  const end = segmentMotion(120, 120);
  assert.equal(start.fraction, 0);
  assert.equal(start.speed, 0);
  assert.ok(Math.abs(end.fraction - 1) < 1e-9);
  assert.equal(end.speed, 0);
  assert.equal(segmentMotion(120, 60).speed, 1);
});

test("distance never goes backwards", () => {
  const t = trip("a", "l");
  let last = -1;
  for (let s = 0; s <= t.total; s += 3) {
    const state = stateAt(t, s);
    assert.ok(state.distance >= last - 1e-6, `t=${s}`);
    last = state.distance;
  }
});

test("phases through a transfer", () => {
  const t = trip("a", "h");
  const tr = t.transfers[0];
  assert.equal(stateAt(t, 1).phase, "running");
  assert.equal(stateAt(t, tr.at + 10).phase, "transfer");
  assert.equal(stateAt(t, tr.at + 10).station, "c");
  assert.equal(stateAt(t, t.total).phase, "arrived");
  assert.equal(stateAt(t, t.total + 100).station, "h");
});

test("stopped at an intermediate stop", () => {
  const t = trip("a", "d");
  const second = t.segments[1];
  const s = stateAt(t, second.depart - 5);
  assert.equal(s.phase, "stopped");
  assert.equal(s.station, second.from);
  assert.equal(s.speed, 0);
});

test("the train's map position runs from station to station", () => {
  const t = trip("a", "c");
  const positions = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, c: { x: 100, y: 100 } };
  assert.deepEqual(trainPoint(t, 0, positions), { x: 0, y: 0 });
  const first = t.segments[0];
  const mid = trainPoint(t, (first.depart + first.arrive) / 2, positions);
  assert.ok(Math.abs(mid.x - 50) < 1 && mid.y === 0, JSON.stringify(mid));
  assert.deepEqual(trainPoint(t, first.arrive + 1, positions), { x: 100, y: 0 });
  assert.deepEqual(trainPoint(t, t.total + 30, positions), { x: 100, y: 100 });
  const early = trainPoint(t, first.depart + 10, positions);
  assert.ok(early.x < (10 / (first.arrive - first.depart)) * 100);
  assert.equal(trainPoint(t, 5, {}), null);
});

test("line follows the leg", () => {
  const t = trip("a", "h");
  assert.equal(stateAt(t, 5).line, "central");
  assert.equal(stateAt(t, t.total - 5).line, "harbour");
});
