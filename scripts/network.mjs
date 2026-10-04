// A scene's transit network, and trips across it. Pure: no Foundry.
//
// A network is what the editor saves on the scene:
//   { name, badge, theme, fare: { amount, coin }, transferMinutes, partyTokenId,
//     cars: { <car>: { sound, interior } },    this network's own ride sound and car art (CARS keys)
//     preset: { city, cityName, era, year, version } | null,   set when made from a city pack
//     lines: [{ id, name, color, kind, theme, stops: [stationId], segments: [{ scenery, minutes }] }],
//     stations: [{ id, name, x, y, theme, platform }] }    platform: auto | underground | above
// segments[i] runs from stops[i] to stops[i + 1]. A station on more than one line is a transfer.
// theme is null wherever it inherits (see themes.mjs).

import { DEFAULT_SCENERY, KINDS, isTunnel } from "./catalog.mjs";
import { DEFAULT_THEME, segmentTheme, stationTheme } from "./themes.mjs";

const MIN_RUN = 45;
const DEFAULT_RUN = 120;

export function emptyNetwork(name = "Metro") {
  return { name, badge: "M", theme: null, fare: { amount: 0, coin: "sp" }, transferMinutes: 4, partyTokenId: null, cars: {}, preset: null, lines: [], stations: [] };
}

/** Short random id for new lines and stations. */
export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Fill gaps in a saved network so the rest of the code can rely on its shape. */
export function normalize(net) {
  const n = { ...emptyNetwork(), ...(net ?? {}) };
  n.fare = { amount: 0, coin: "sp", ...(n.fare ?? {}) };
  n.cars = n.cars && typeof n.cars === "object" ? n.cars : {};
  n.stations = (n.stations ?? []).map((s) => ({ name: "Stop", x: null, y: null, theme: null, platform: "auto", ...s }));
  const known = new Set(n.stations.map((s) => s.id));
  n.lines = (n.lines ?? []).map((line) => {
    const stops = (line.stops ?? []).filter((id) => known.has(id));
    const segments = [];
    for (let i = 0; i < stops.length - 1; i++) segments.push({ scenery: DEFAULT_SCENERY, minutes: null, ...(line.segments?.[i] ?? {}) });
    return { name: "Line", color: "#d6312b", kind: "metro", theme: null, ...line, stops, segments };
  });
  return n;
}

export function stationOf(net, id) {
  return net.stations.find((s) => s.id === id) ?? null;
}

export function lineOf(net, id) {
  return net.lines.find((l) => l.id === id) ?? null;
}

/** Lines serving a station, in the network's order. */
export function linesAt(net, stationId) {
  return net.lines.filter((l) => l.stops.includes(stationId));
}

export function isPlaced(station) {
  return Number.isFinite(station?.x) && Number.isFinite(station?.y);
}

/** A lighter shade of a line colour, for overhead strip maps and bright accents. */
export function lighten(hex, amount = 0.18) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  if (!Number.isFinite(n)) return hex;
  const f = (v) => Math.round(v + (255 - v) * amount).toString(16).padStart(2, "0");
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

/**
 * Running time between two adjacent stops on a line, in seconds, not counting the dwell:
 * the GM's minutes if set, otherwise the straight-line distance on the map at the line's
 * speed. `kmPerPx` converts map pixels to kilometres.
 */
export function runSeconds(net, line, index, kmPerPx) {
  const seg = line.segments[index];
  if (Number.isFinite(seg?.minutes) && seg.minutes > 0) return Math.round(seg.minutes * 60);
  const a = stationOf(net, line.stops[index]);
  const b = stationOf(net, line.stops[index + 1]);
  if (!isPlaced(a) || !isPlaced(b) || !kmPerPx) return DEFAULT_RUN;
  const km = Math.hypot(a.x - b.x, a.y - b.y) * kmPerPx;
  return Math.max(MIN_RUN, Math.round((km / (KINDS[line.kind] ?? KINDS.metro).kmh) * 3600));
}

export function dwellSeconds(line) {
  return (KINDS[line.kind] ?? KINDS.metro).dwell;
}

/**
 * Quickest trip between two stations. Returns the trip, or null when the stations are the
 * same, unknown or not connected.
 */
export function findTrip(net, fromId, toId, kmPerPx, worldTheme = DEFAULT_THEME) {
  if (fromId === toId || !stationOf(net, fromId) || !stationOf(net, toId)) return null;
  const transfer = (net.transferMinutes ?? 4) * 60;

  const neighbours = (key) => {
    const [station, lineId] = key.split("@");
    const line = lineOf(net, lineId);
    const out = [];
    const i = line.stops.indexOf(station);
    if (i > 0) out.push({ to: `${line.stops[i - 1]}@${lineId}`, cost: runSeconds(net, line, i - 1, kmPerPx) + dwellSeconds(line) });
    if (i < line.stops.length - 1) out.push({ to: `${line.stops[i + 1]}@${lineId}`, cost: runSeconds(net, line, i, kmPerPx) + dwellSeconds(line) });
    for (const other of linesAt(net, station)) if (other.id !== lineId) out.push({ to: `${station}@${other.id}`, cost: transfer });
    return out;
  };

  const dist = new Map();
  const prev = new Map();
  const queue = new MinHeap();
  for (const line of linesAt(net, fromId)) {
    const key = `${fromId}@${line.id}`;
    dist.set(key, 0);
    queue.push([0, key]);
  }
  let goal = null;
  while (queue.size) {
    const [cost, key] = queue.pop();
    if (cost > (dist.get(key) ?? Infinity)) continue;
    if (key.split("@")[0] === toId) { goal = key; break; }
    for (const move of neighbours(key)) {
      const next = cost + move.cost;
      if (next < (dist.get(move.to) ?? Infinity)) {
        dist.set(move.to, next);
        prev.set(move.to, key);
        queue.push([next, move.to]);
      }
    }
  }
  if (!goal) return null;

  const path = [];
  for (let key = goal; key; key = prev.get(key)) path.unshift(key.split("@"));
  const legs = [];
  for (const [station, lineId] of path) {
    const leg = legs.at(-1);
    if (leg?.lineId === lineId) leg.stops.push(station);
    else legs.push({ lineId, stops: [station] });
  }
  return buildTrip(net, legs.filter((leg) => leg.stops.length > 1), kmPerPx, worldTheme);
}

/** Binary heap of [cost, key] pairs, cheapest first (big city networks have thousands of nodes). */
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item) {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (a[up][0] <= a[i][0]) break;
      [a[up], a[i]] = [a[i], a[up]];
      i = up;
    }
  }
  pop() {
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

function directionLabel(net, line, stops) {
  const forward = line.stops.indexOf(stops[1]) > line.stops.indexOf(stops[0]);
  const terminal = forward ? line.stops.at(-1) : line.stops[0];
  return `${line.name} toward ${stationOf(net, terminal)?.name ?? "the end of the line"}`;
}

/**
 * Lay the legs out on a timeline in seconds from the doors closing at the origin. The trip
 * carries the names, colours and themes it needs, so every client can show it without the
 * network. `worldTheme` is the module's default theme.
 */
export function buildTrip(net, legs, kmPerPx, worldTheme = DEFAULT_THEME) {
  const segments = [];
  const transfers = [];
  const names = {};
  const lines = {};
  const platforms = {};
  let t = 0;
  legs.forEach((leg, legIndex) => {
    const line = lineOf(net, leg.lineId);
    lines[line.id] = { name: line.name, color: line.color, strip: lighten(line.color), car: (KINDS[line.kind] ?? KINDS.metro).car };
    for (const id of leg.stops) {
      const station = stationOf(net, id);
      names[id] = station?.name ?? "Stop";
      // At a transfer, the platform looks like the line being boarded.
      platforms[id] = stationTheme(net, line, station, worldTheme);
    }
    if (legIndex > 0) {
      const transfer = (net.transferMinutes ?? 4) * 60;
      transfers.push({ station: leg.stops[0], at: t, seconds: transfer, fromLine: legs[legIndex - 1].lineId, toLine: line.id });
      t += transfer;
    }
    for (let i = 1; i < leg.stops.length; i++) {
      const from = leg.stops[i - 1];
      const to = leg.stops[i];
      const forward = line.stops.indexOf(to) > line.stops.indexOf(from);
      const index = forward ? line.stops.indexOf(from) : line.stops.indexOf(to);
      if (i > 1) t += dwellSeconds(line);
      const run = runSeconds(net, line, index, kmPerPx);
      const scenery = line.segments[index]?.scenery ?? DEFAULT_SCENERY;
      const theme = segmentTheme(net, line, stationOf(net, from), stationOf(net, to), worldTheme);
      segments.push({ legIndex, routeId: line.id, line: line.id, from, to, env: scenery, theme, depart: t, arrive: t + run });
      t += run;
    }
  });
  // Each stop's platform: as the GM set it, or (auto) underground when a tunnel reaches it.
  const platformKinds = {};
  for (const id of Object.keys(names)) {
    const setting = stationOf(net, id)?.platform;
    platformKinds[id] = setting === "underground" || setting === "above" ? setting
      : segments.some((s) => (s.from === id || s.to === id) && isTunnel(s.env)) ? "underground" : "above";
  }
  return {
    from: legs[0].stops[0],
    to: legs.at(-1).stops.at(-1),
    legs: legs.map((leg) => ({ ...leg, routeId: leg.lineId, line: leg.lineId, label: directionLabel(net, lineOf(net, leg.lineId), leg.stops) })),
    segments,
    transfers,
    names,
    lines,
    platforms,
    platformKinds,
    total: t
  };
}

/** Cut a trip short so it ends at the first stop reached at or after `elapsed`. */
export function truncateTrip(trip, elapsed) {
  const index = trip.segments.findIndex((seg) => seg.arrive >= elapsed);
  if (index < 0) return trip;
  const segments = trip.segments.slice(0, index + 1);
  const last = segments.at(-1);
  const usedLegs = new Set(segments.map((s) => s.legIndex));
  const legs = trip.legs.filter((_, i) => usedLegs.has(i)).map((leg, i) => {
    const stops = [];
    for (const seg of segments.filter((s) => s.legIndex === i)) {
      if (!stops.length) stops.push(seg.from);
      stops.push(seg.to);
    }
    return { ...leg, stops };
  });
  return {
    ...trip,
    to: last.to,
    legs,
    segments,
    transfers: trip.transfers.filter((tr) => tr.at < last.arrive),
    total: last.arrive
  };
}

/** Station ids in the order a line strip shows them: the origin, then each stop reached. */
export function tripStops(trip) {
  return [trip.segments[0].from, ...trip.segments.map((s) => s.to)];
}
