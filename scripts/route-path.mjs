// Travel nodes: the shape of the track between two stops. Pure: no Foundry.
//
// A segment may carry path: { from, to, nodes: [{ x, y }] }, the points the track passes through
// from stops[i] (from) to stops[i + 1] (to), in that order. No nodes (the default) is a straight
// line. The track is a smooth curve through the stops and its nodes (a centripetal Catmull-Rom
// spline, which never loops or overshoots between close points). The from and to ids let a
// path survive stops being reordered: one that no longer fits its stretch is dropped.

/** The nodes of a segment running `from` to `to`, in that order ([] when straight or stale). */
export function segmentNodes(seg, from, to) {
  const p = seg?.path;
  if (!p || !Array.isArray(p.nodes) || !p.nodes.length) return [];
  if (p.from === from && p.to === to) return p.nodes;
  if (p.from === to && p.to === from) return [...p.nodes].reverse();
  return [];
}

/** A saved path made fit for its stretch (from to to), or null. */
export function cleanPath(path, from, to) {
  const nodes = segmentNodes({ path }, from, to)
    .filter((n) => Number.isFinite(n?.x) && Number.isFinite(n?.y))
    .map((n) => ({ x: Math.round(n.x), y: Math.round(n.y) }));
  return nodes.length ? { from, to, nodes } : null;
}

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** Points along one span of the spline, p1 to p2 (p1 left out), into `out`. */
function span(p0, p1, p2, p3, out) {
  const len = dist(p1, p2);
  const n = Math.max(1, Math.min(48, Math.ceil(len / 12)));
  if (n === 1) return out.push({ x: p2.x, y: p2.y });
  const knot = (a, b) => Math.max(1e-4, Math.sqrt(dist(a, b)));
  const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
  const mix = (a, b, ta, tb, t) => ({ x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta), y: ((tb - t) * a.y + (t - ta) * b.y) / (tb - ta) });
  for (let i = 1; i <= n; i++) {
    const t = t1 + ((t2 - t1) * i) / n;
    const a1 = mix(p0, p1, t0, t1, t), a2 = mix(p1, p2, t1, t2, t), a3 = mix(p2, p3, t2, t3, t);
    const b1 = mix(a1, a2, t0, t2, t), b2 = mix(a2, a3, t1, t3, t);
    out.push(mix(b1, b2, t1, t2, t));
  }
}

/**
 * The track from a through the nodes to b, one polyline per stretch (stop or node to the next),
 * each starting where the one before it ends.
 */
export function curveSpans(a, nodes, b) {
  const pts = [a, ...(nodes ?? []), b];
  if (pts.length === 2) return [[{ x: a.x, y: a.y }, { x: b.x, y: b.y }]];
  // The ends continue straight on, so the curve leaves and reaches each stop smoothly.
  const before = { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y };
  const after = { x: 2 * pts.at(-1).x - pts.at(-2).x, y: 2 * pts.at(-1).y - pts.at(-2).y };
  const spans = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const out = [{ x: pts[i].x, y: pts[i].y }];
    span(pts[i - 1] ?? before, pts[i], pts[i + 1], pts[i + 2] ?? after, out);
    spans.push(out);
  }
  return spans;
}

/** The track as one polyline from a through the nodes to b. */
export function curvePoints(a, nodes, b) {
  const spans = curveSpans(a, nodes, b);
  return [spans[0][0], ...spans.flatMap((s) => s.slice(1))];
}

/** A polyline with its running lengths: { points, cum, length }. */
export function shapeOf(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + dist(points[i - 1], points[i]));
  return { points, cum, length: cum.at(-1) ?? 0 };
}

/** The point `d` along a shape (clamped to its ends). */
export function pointAt(shape, d) {
  const { points, cum, length } = shape;
  if (points.length === 1 || d <= 0) return { ...points[0] };
  if (d >= length) return { ...points.at(-1) };
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const f = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
  return { x: points[lo].x + (points[hi].x - points[lo].x) * f, y: points[lo].y + (points[hi].y - points[lo].y) * f };
}

/** How long the track of a line's segment is, in map pixels (null when a stop isn't placed). */
export function segmentLength(a, b, nodes) {
  if (!Number.isFinite(a?.x) || !Number.isFinite(b?.x)) return null;
  return nodes?.length ? shapeOf(curvePoints(a, nodes, b)).length : dist(a, b);
}

/**
 * Every line's track shapes on a network, for the trains: get(lineId, from, to) gives the shape
 * running from one stop to the next in either direction, or null when a stop isn't placed.
 */
export function routeShapes(net) {
  const at = new Map(net.stations.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y)).map((s) => [s.id, s]));
  const cache = new Map();
  const get = (lineId, from, to) => {
    const key = `${lineId}|${from}|${to}`;
    if (cache.has(key)) return cache.get(key);
    const line = net.lines.find((l) => l.id === lineId);
    const a = at.get(from), b = at.get(to);
    let shape = null;
    if (line && a && b) {
      const i = line.stops.findIndex((id, k) => (id === from && line.stops[k + 1] === to) || (id === to && line.stops[k + 1] === from));
      shape = shapeOf(curvePoints(a, i >= 0 ? segmentNodes(line.segments[i], from, to) : [], b));
    }
    cache.set(key, shape);
    return shape;
  };
  return { get };
}

/** A trip's track: one shape per segment, in order (null where a stop isn't placed). */
export function tripTrack(trip, shapes) {
  return trip.segments.map((seg) => shapes.get(seg.line, seg.from, seg.to));
}

/** The point `d` pixels along a trip's track (segment shapes from tripTrack), or null. */
export function pointOnTrip(track, d) {
  let left = Math.max(0, d);
  for (let i = 0; i < track.length; i++) {
    const shape = track[i];
    if (!shape) return null;
    if (left <= shape.length || i === track.length - 1) return pointAt(shape, left);
    left -= shape.length;
  }
  return null;
}

/** Ramer-Douglas-Peucker: the fewest points that stay within `tolerance` of the polyline. */
export function simplify(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const a = points[s], b = points[e];
    const len = dist(a, b) || 1;
    let worst = -1, at = -1;
    for (let i = s + 1; i < e; i++) {
      const p = points[i];
      const off = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
      if (off > worst) { worst = off; at = i; }
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([s, at], [at, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** The nearest point on a polyline to p: { index (of the span's start), point, distance }. */
export function nearestOnPolyline(points, p) {
  let best = { index: 0, point: points[0], distance: Infinity };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = dist(p, q);
    if (d < best.distance) best = { index: i, point: q, distance: d };
  }
  return best;
}

/**
 * Where a new node clicked at p goes among a segment's nodes: the index to insert at, by which
 * stretch of the curve (stop or node to the next) is nearest.
 */
export function insertIndex(a, nodes, b, p) {
  let best = 0, bestD = Infinity;
  curveSpans(a, nodes, b).forEach((pts, i) => {
    const d = nearestOnPolyline(pts, p).distance;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
