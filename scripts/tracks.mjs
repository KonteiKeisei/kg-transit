// A city network's travel nodes, traced along the real track KG Cities draws. Pure: no Foundry.
//
// KG Cities' transit data is OpenStreetMap track: GeoJSON LineStrings ("lon lat" strings or
// [lon, lat] pairs) with properties { color, line, lines, mode }. Ways that meet share points,
// so the pieces join into one graph of the scene's rail. Each stretch between two stops follows
// the shortest way along it, track of the line's own colour preferred, simplified to a few
// travel nodes the GM can still drag about.

import { simplify } from "./route-path.mjs";

/** Track of another colour costs this much more to follow, so a line keeps to its own. */
const OTHER_TRACK = 3;
/** A traced stretch longer than this times the straight line is a wrong turn: left straight. */
const MAX_DETOUR = 3;

const key = (x, y) => `${Math.round(x * 2)},${Math.round(y * 2)}`;

function lonLat(c) {
  if (Array.isArray(c)) return [Number(c[0]), Number(c[1])];
  const [lon, lat] = String(c).trim().split(/\s+/).map(Number);
  return [lon, lat];
}

/**
 * The rail inside the scene as a graph. `project(lat, lon)` gives scene pixels; `rect` the scene
 * rectangle; `joinPx`: loose ends this close to other track are joined to it.
 */
export function trackGraph(transit, project, rect, joinPx) {
  const nodes = []; // { x, y, edges: [{ to, len, color }] }
  const index = new Map();
  const margin = Math.max(rect.width, rect.height) * 0.05;
  const inside = (p) => p.x >= rect.x - margin && p.y >= rect.y - margin && p.x <= rect.x + rect.width + margin && p.y <= rect.y + rect.height + margin;
  const nodeAt = (p) => {
    const k = key(p.x, p.y);
    let id = index.get(k);
    if (id === undefined) {
      id = nodes.length;
      nodes.push({ x: p.x, y: p.y, edges: [] });
      index.set(k, id);
    }
    return id;
  };
  const link = (a, b, color) => {
    if (a === b) return;
    const len = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
    nodes[a].edges.push({ to: b, len, color });
    nodes[b].edges.push({ to: a, len, color });
  };
  const ends = [];
  for (const f of transit?.features ?? []) {
    const g = f?.geometry;
    const runs = g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" ? g.coordinates : [];
    const color = String(f.properties?.color ?? "").toLowerCase();
    for (const run of runs) {
      let prev = null;
      let first = null;
      for (const c of run ?? []) {
        const [lon, lat] = lonLat(c);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        const p = project(lat, lon);
        if (!inside(p)) { if (prev !== null) ends.push(prev); prev = null; continue; }
        const id = nodeAt(p);
        if (prev !== null) link(prev, id, color);
        else first = id;
        prev = id;
      }
      if (first !== null) ends.push(first);
      if (prev !== null) ends.push(prev);
    }
  }
  // Ways that should meet but stop just short of each other (a platform's track, a junction
  // drawn a metre off) are joined, end to nearest point.
  const grid = new SpatialGrid(nodes, Math.max(joinPx, 1));
  for (const id of new Set(ends)) {
    if (nodes[id].edges.length > 1) continue;
    const near = grid.nearest(nodes[id], joinPx, (other) => other !== id && !nodes[id].edges.some((e) => e.to === other));
    if (near !== null) link(id, near, "");
  }
  return { nodes, grid };
}

/** Buckets of graph nodes for finding the nearest quickly. */
class SpatialGrid {
  constructor(nodes, size) {
    this.nodes = nodes;
    this.size = size;
    this.cells = new Map();
    nodes.forEach((n, id) => {
      const k = this.#cell(n.x, n.y);
      (this.cells.get(k) ?? this.cells.set(k, []).get(k)).push(id);
    });
  }

  #cell(x, y) {
    return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`;
  }

  /** Every node within `radius` of p, with its distance: [{ id, d }]. */
  within(p, radius) {
    const r = Math.ceil(radius / this.size);
    const cx = Math.floor(p.x / this.size), cy = Math.floor(p.y / this.size);
    const out = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (const id of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const n = this.nodes[id];
          const d = Math.hypot(n.x - p.x, n.y - p.y);
          if (d <= radius) out.push({ id, d });
        }
      }
    }
    return out;
  }
  /** The nearest node to p within `radius` that passes `ok`, or null. */
  nearest(p, radius, ok = () => true) {
    const r = Math.ceil(radius / this.size);
    const cx = Math.floor(p.x / this.size), cy = Math.floor(p.y / this.size);
    let best = null, bestD = radius;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (const id of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const n = this.nodes[id];
          const d = Math.hypot(n.x - p.x, n.y - p.y);
          if (d <= bestD && ok(id)) { best = id; bestD = d; }
        }
      }
    }
    return best;
  }
}

/** Stepping off the track to reach a stop costs this much more than riding it. */
const OFF_TRACK = 2;

/**
 * The cheapest way along the graph from stop a to stop b (A*), starting from any track near a
 * and ending on any near b (parallel tracks, one each way, often only meet at crossovers), as
 * points, or null. `starts` and `ends`: [{ id, d }] of nodes near each stop.
 */
function route(graph, a, b, starts, ends, color, limit) {
  const { nodes } = graph;
  const h = (id) => Math.hypot(nodes[id].x - b.x, nodes[id].y - b.y);
  const finish = new Map(ends.map((e) => [e.id, e.d * OFF_TRACK]));
  const cost = new Map();
  const prev = new Map();
  const open = new Heap();
  for (const s of starts) {
    const g = s.d * OFF_TRACK;
    if (g < (cost.get(s.id) ?? Infinity)) { cost.set(s.id, g); open.push(g + h(s.id), s.id); }
  }
  let best = null, bestCost = Infinity, steps = 0;
  while (open.size && steps++ < 200_000) {
    const [f, id] = open.popEntry();
    if (f >= bestCost) break;
    const here = cost.get(id);
    if (here > limit) break;
    if (finish.has(id) && here + finish.get(id) < bestCost) { best = id; bestCost = here + finish.get(id); }
    for (const e of nodes[id].edges) {
      const next = here + e.len * (!color || e.color === color ? 1 : OTHER_TRACK);
      if (next < (cost.get(e.to) ?? Infinity)) {
        cost.set(e.to, next);
        prev.set(e.to, id);
        open.push(next + h(e.to), e.to);
      }
    }
  }
  if (best === null) return null;
  const out = [];
  for (let id = best; id !== undefined; id = prev.get(id)) out.unshift({ x: nodes[id].x, y: nodes[id].y });
  return out;
}
class Heap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(priority, value) {
    const a = this.items;
    a.push([priority, value]);
    for (let i = a.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (a[up][0] <= a[i][0]) break;
      [a[up], a[i]] = [a[i], a[up]];
      i = up;
    }
  }
  pop() {
    return this.popEntry()[1];
  }
  popEntry() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Trace every stretch of every line along the track: sets each segment's path (travel nodes)
 * where the track joins its two stops, leaving the rest straight. Returns how many stretches
 * now follow the track. `pxPerMetre` scales the snapping and smoothing distances.
 */
export function traceTracks(net, transit, project, rect, pxPerMetre) {
  const graph = trackGraph(transit, project, rect, 30 * pxPerMetre);
  if (!graph.nodes.length) return 0;
  // A stop's own track is within a couple of city blocks of it (big stations are mapped at the
  // building, well off the platforms).
  const reach = 300 * pxPerMetre;
  const tolerance = Math.max(2, 6 * pxPerMetre);
  const at = new Map(net.stations.map((s) => [s.id, s]));
  let traced = 0;
  for (const line of net.lines) {
    const color = String(line.color ?? "").toLowerCase();
    line.segments.forEach((seg, i) => {
      const a = at.get(line.stops[i]), b = at.get(line.stops[i + 1]);
      if (!Number.isFinite(a?.x) || !Number.isFinite(b?.x)) return;
      const starts = graph.grid.within(a, reach), ends = graph.grid.within(b, reach);
      if (!starts.length || !ends.length) return;
      const straight = Math.hypot(b.x - a.x, b.y - a.y);
      const way = route(graph, a, b, starts, ends, color, (straight * MAX_DETOUR + reach) * OTHER_TRACK);
      if (!way) return;      const pts = [{ x: a.x, y: a.y }, ...way, { x: b.x, y: b.y }];
      let len = 0;
      for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
      if (len > Math.hypot(b.x - a.x, b.y - a.y) * MAX_DETOUR + reach) return;
      const nodes = simplify(pts, tolerance).slice(1, -1).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
      if (nodes.length) seg.path = { from: line.stops[i], to: line.stops[i + 1], nodes };
      else delete seg.path;
      traced++;
    });
  }
  return traced;
}
