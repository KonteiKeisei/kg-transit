// Where the train is at a given moment of a trip, for the ride overlay and the tokens.
// Pure: no Foundry, no DOM.

import { pointOnTrip, shapeOf, tripTrack } from "./route-path.mjs";

/** Cruise speed of the window scenery, in texture pixels per second. */
export const CRUISE_PX = 900;
const RAMP_MAX = 20;

/**
 * Trapezoid speed profile over one segment of `run` seconds: speed up, cruise, slow down.
 * Returns the fraction of the segment covered at `t` and the speed relative to cruise (0 to 1).
 */
export function segmentMotion(run, t) {
  const ramp = Math.min(RAMP_MAX, run / 3);
  const cruise = run - ramp;
  const x = Math.max(0, Math.min(run, t));
  let covered;
  let speed;
  if (x < ramp) {
    covered = 0.5 * x * x / ramp;
    speed = x / ramp;
  } else if (x <= run - ramp) {
    covered = 0.5 * ramp + (x - ramp);
    speed = 1;
  } else {
    const left = run - x;
    covered = cruise - 0.5 * left * left / ramp;
    speed = left / ramp;
  }
  return { fraction: covered / cruise, speed, length: cruise * CRUISE_PX };
}

/**
 * The ride at `elapsed` seconds:
 * - phase: "running" between stations, "stopped" at an intermediate stop, "transfer" while
 *   changing trains, "arrived" at the end.
 * - distance: total scenery pixels travelled, for scrolling textures.
 * - station: the stop the train is at or approaching; nextStation for the line strip.
 * - approach: 0 to 1, how close the train is to stopping (1 when stopped).
 */
export function stateAt(trip, elapsed) {
  const t = Math.max(0, elapsed);
  let distance = 0;
  const segments = trip.segments;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const run = seg.arrive - seg.depart;
    const next = segments[i + 1];

    if (t < seg.depart) {
      // Before this segment: either stopped at its origin or changing trains there.
      const transfer = trip.transfers.find((tr) => tr.station === seg.from && tr.at + tr.seconds === seg.depart);
      return {
        phase: transfer && t >= transfer.at ? "transfer" : "stopped",
        segmentIndex: i, line: seg.line, env: "station", speed: 0, approach: 1, distance,
        station: seg.from, nextStation: seg.to, transfer: transfer ?? null, progress: t / trip.total
      };
    }
    const motion = segmentMotion(run, t - seg.depart);
    if (t < seg.arrive) {
      const remaining = seg.arrive - t;
      const approach = remaining < RAMP_MAX * 1.5 ? 1 - remaining / (RAMP_MAX * 1.5) : 0;
      const leaving = t - seg.depart < RAMP_MAX ? 1 - (t - seg.depart) / RAMP_MAX : 0;
      return {
        phase: "running", segmentIndex: i, line: seg.line, env: seg.env, speed: motion.speed, fraction: motion.fraction,
        approach: Math.max(approach, leaving), distance: distance + motion.fraction * motion.length,
        station: approach >= leaving ? seg.to : seg.from, nextStation: seg.to, transfer: null, progress: t / trip.total
      };
    }
    distance += motion.length;
    if (!next) break;
  }

  const last = segments.at(-1);
  return {
    phase: "arrived", segmentIndex: segments.length - 1, line: last.line, env: "station", speed: 0, approach: 1,
    distance, station: last.to, nextStation: null, transfer: null, progress: 1
  };
}

/**
 * How far along the trip's track the train is at `elapsed` seconds, in map pixels from the
 * origin: between stations it eases out of and into each stop on the same curve as the ride.
 * `track` is one shape per segment (route-path.mjs tripTrack); null if a stop isn't placed.
 */
export function trainDistance(trip, elapsed, track) {
  const state = stateAt(trip, elapsed);
  const index = state.phase === "arrived" ? track.length : state.segmentIndex;
  let d = 0;
  for (let i = 0; i < index; i++) {
    if (!track[i]) return null;
    d += track[i].length;
  }
  if (state.phase !== "running") return track[Math.min(index, track.length - 1)] ? d : null;
  return track[index] ? d + track[index].length * state.fraction : null;
}

/**
 * Where the train is on the map at `elapsed` seconds, along each stretch's track (straight, or
 * curved through its travel nodes). `positions` maps station ids to { x, y }; `shapes` is the
 * network's routeShapes (straight lines between the positions when left out).
 */
export function trainPoint(trip, elapsed, positions, shapes = straightShapes(positions)) {
  const track = tripTrack(trip, shapes);
  const d = trainDistance(trip, elapsed, track);
  return d === null ? null : pointOnTrip(track, d);
}

/** Straight track between station positions, for networks without their lines to hand. */
export function straightShapes(positions) {
  return {
    get: (lineId, from, to) => {
      const a = positions[from], b = positions[to];
      return a && b ? shapeOf([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]) : null;
    }
  };
}