// Where the train is at a given moment of a trip, for the ride overlay.
// Pure: no Foundry, no DOM.

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
 * Where the train is on the map at `elapsed` seconds: between two stations it moves in a
 * straight line, easing out of and into each stop on the same curve as the ride; otherwise
 * it is at the station. `positions` maps station ids to { x, y }.
 */
export function trainPoint(trip, elapsed, positions) {
  const state = stateAt(trip, elapsed);
  if (state.phase === "running") {
    const seg = trip.segments[state.segmentIndex];
    const a = positions[seg.from];
    const b = positions[seg.to];
    if (!a || !b) return null;
    return { x: a.x + (b.x - a.x) * state.fraction, y: a.y + (b.y - a.y) * state.fraction };
  }
  const at = positions[state.station];
  return at ? { x: at.x, y: at.y } : null;
}
