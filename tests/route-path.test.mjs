import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPath, curvePoints, insertIndex, pointAt, segmentLength, segmentNodes, shapeOf, simplify } from "../scripts/route-path.mjs";
import { normalize } from "../scripts/network.mjs";
import { traceTracks } from "../scripts/tracks.mjs";

test("no nodes is a straight line; nodes bend the track through them", () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
  assert.deepEqual(curvePoints(a, [], b), [a, b]);
  const pts = curvePoints(a, [{ x: 50, y: 40 }], b);
  assert.deepEqual(pts[0], a);
  assert.deepEqual(pts.at(-1), b);
  assert.ok(pts.some((p) => Math.abs(p.x - 50) < 1e-6 && Math.abs(p.y - 40) < 1e-6), "passes through the node");
  assert.ok(segmentLength(a, b, [{ x: 50, y: 40 }]) > 120);
  assert.equal(segmentLength(a, b, []), 100);
});

test("a shape gives points by distance along it", () => {
  const s = shapeOf([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  assert.equal(s.length, 200);
  assert.deepEqual(pointAt(s, 150), { x: 100, y: 50 });
  assert.deepEqual(pointAt(s, -5), { x: 0, y: 0 });
  assert.deepEqual(pointAt(s, 999), { x: 100, y: 100 });
});

test("a path is kept only for its own stretch, either way round", () => {
  const path = { from: "a", to: "b", nodes: [{ x: 1, y: 1 }, { x: 2, y: 2 }] };
  assert.deepEqual(segmentNodes({ path }, "b", "a"), [{ x: 2, y: 2 }, { x: 1, y: 1 }]);
  assert.deepEqual(segmentNodes({ path }, "a", "c"), []);
  assert.equal(cleanPath(path, "c", "d"), null);
  const net = normalize({
    stations: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 0 }, { id: "c", x: 20, y: 0 }],
    lines: [{ id: "l", stops: ["b", "a", "c"], segments: [{ path }, { path }] }]
  });
  assert.deepEqual(net.lines[0].segments[0].path, { from: "b", to: "a", nodes: [{ x: 2, y: 2 }, { x: 1, y: 1 }] });
  assert.equal(net.lines[0].segments[1].path, undefined, "stale path dropped");
});

test("a new node goes into the stretch of the curve it was clicked on", () => {
  const a = { x: 0, y: 0 }, b = { x: 300, y: 0 };
  const nodes = [{ x: 100, y: 50 }, { x: 200, y: 50 }];
  assert.equal(insertIndex(a, nodes, b, { x: 30, y: 20 }), 0);
  assert.equal(insertIndex(a, nodes, b, { x: 150, y: 52 }), 1);
  assert.equal(insertIndex(a, nodes, b, { x: 280, y: 10 }), 2);
});

test("simplify keeps the corners", () => {
  const pts = [{ x: 0, y: 0 }, { x: 50, y: 0.2 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 100 }];
  assert.deepEqual(simplify(pts, 1), [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
});

test("lines are traced along the track, preferring their own colour", () => {
  // An L of red track from A to B, and a shortcut of blue track straight across.
  const transit = { features: [
    { geometry: { type: "LineString", coordinates: [[0, 0], [0, 100], [100, 100]] }, properties: { color: "#ff0000" } },
    { geometry: { type: "LineString", coordinates: [[0, 0], [100, 100]] }, properties: { color: "#0000ff" } }
  ] };
  const project = (lat, lon) => ({ x: lon, y: lat });
  const net = normalize({
    stations: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 100, y: 100 }],
    lines: [{ id: "red", color: "#FF0000", stops: ["A", "B"] }, { id: "blue", color: "#0000ff", stops: ["A", "B"] }]
  });
  const traced = traceTracks(net, transit, project, { x: 0, y: 0, width: 100, height: 100 }, 0.1);
  assert.equal(traced, 2);
  assert.deepEqual(net.lines[0].segments[0].path.nodes, [{ x: 0, y: 100 }], "red keeps to its L");
  assert.equal(net.lines[1].segments[0].path, undefined, "blue runs straight");
});
