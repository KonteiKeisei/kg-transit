// Flying between KG Cities' cities, as it was in 1986. PURE: no Foundry.
//
// Airports come from KG Cities (api.airports()): { iata, name, cities, size: hub | medium | small,
// lat, lon }. A flight's plan: who flies it and on what, the fare, and every step from the curb
// at one end to the curb at the other, in minutes.

/**
 * The fare: the Department of Transportation's Standard Industry Fare Level, the coach fare
 * formula of the day, revised every six months: a terminal charge plus so much a mile, less per
 * mile the further you fly. In dollars, one way. (Its rates for 1986: 26 USC 61 rulings.)
 */
export const FARE_LEVELS = [
  { from: [1986, 1], terminal: 26.02, bands: [[500, 0.1423], [1500, 0.1085], [Infinity, 0.1043]] },
  { from: [1986, 7], terminal: 23.80, bands: [[500, 0.1302], [1500, 0.0993], [Infinity, 0.0954]] }
];

/** The fare level in force in a year and month (1 to 12): the latest that has begun, else the first. */
export function fareLevel(year, month = 1) {
  const at = year * 12 + month;
  return [...FARE_LEVELS].reverse().find((l) => l.from[0] * 12 + l.from[1] <= at) ?? FARE_LEVELS[0];
}

/** The one-way coach fare in dollars for a flight of so many miles. */
export function fareDollars(miles, level = FARE_LEVELS[0]) {
  let left = miles, last = 0, cost = level.terminal;
  for (const [upTo, rate] of level.bands) {
    const span = Math.min(left, upTo - last);
    cost += span * rate;
    left -= span;
    last = upTo;
    if (left <= 0) break;
  }
  return Math.round(cost);
}

/* ---------------------------------------- */
/*  Distance                                 */
/* ---------------------------------------- */

const R_MILES = 3958.8;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle statute miles between two { lat, lon }. */
export function miles(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(h));
}

/** Initial compass bearing from a to b, degrees (0 north, 90 east). */
export function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/* ---------------------------------------- */
/*  Aircraft and airlines                    */
/* ---------------------------------------- */

/** The wide-bodies of the day. art: assets/flight/<art>.webp, a side view nose to the left. */
export const AIRCRAFT = {
  "747": { name: "Boeing 747", engines: "four engines", art: "747", boarding: 30, deplane: 15, range: Infinity },
  dc10: { name: "McDonnell Douglas DC-10", engines: "three engines", art: "dc10", boarding: 25, deplane: 12, range: Infinity },
  l1011: { name: "Lockheed L-1011 TriStar", engines: "three engines", art: "l1011", boarding: 25, deplane: 12, range: Infinity },
  // The A300 was a short and medium-haul plane in American service (Eastern's East Coast routes).
  a300: { name: "Airbus A300", engines: "two engines", art: "a300", boarding: 20, deplane: 10, range: 1500 },
  "767": { name: "Boeing 767", engines: "two engines", art: "767", boarding: 20, deplane: 10, range: Infinity }
};

/**
 * The airlines of 1986: where they had hubs, what they flew of the above, and their tail colour
 * (the tail of the side view is painted in it).
 */
export const AIRLINES = {
  eastern: { name: "Eastern Air Lines", hubs: ["ATL", "MIA", "BOS", "LGA", "JFK", "DCA", "EWR", "PHL", "FLL"], fleet: ["a300", "l1011"], tail: "#1f4aa8" },
  delta: { name: "Delta Air Lines", hubs: ["ATL", "FLL", "BOS", "DTW"], fleet: ["l1011", "767"], tail: "#1b2f6e" },
  panam: { name: "Pan American", hubs: ["JFK", "MIA", "SFO", "LGA"], fleet: ["747", "a300"], tail: "#1e6fd0" },
  twa: { name: "Trans World Airlines", hubs: ["STL", "JFK", "BOS", "LAX", "LAS"], fleet: ["l1011", "747", "767"], tail: "#c4122f" },
  american: { name: "American Airlines", hubs: ["ORD", "LGA", "BOS", "LAX", "SJC", "DCA"], fleet: ["dc10", "767"], tail: "#a9b0b8" },
  united: { name: "United Airlines", hubs: ["ORD", "SFO", "IAD", "LAX", "LAS", "OAK"], fleet: ["dc10", "747", "767"], tail: "#24418f" },
  northwest: { name: "Northwest Orient", hubs: ["DTW", "BOS", "LGA", "MIA"], fleet: ["dc10", "747"], tail: "#c8102e" },
  western: { name: "Western Airlines", hubs: ["LAX", "LAS", "SFO"], fleet: ["dc10"], tail: "#d22630" },
  continental: { name: "Continental Airlines", hubs: ["EWR", "AUS", "LAX", "MDW"], fleet: ["dc10", "a300"], tail: "#c8102e" },
  people: { name: "People Express", hubs: ["EWR", "BWI", "MDW"], fleet: ["747"], tail: "#7b1f2b" },
  piedmont: { name: "Piedmont Airlines", hubs: ["BWI", "PHL", "DET", "BUR", "LGB"], fleet: ["767"], tail: "#16365e" }
};

/** A steady number from text, so the same route always gets the same airline and plane. */
function hash(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Which planes suit a distance, best first. */
function suited(distance) {
  if (distance < 700) return ["a300", "767", "l1011", "dc10", "747"];
  if (distance < 1800) return ["767", "l1011", "dc10", "a300", "747"];
  return ["747", "dc10", "l1011", "767", "a300"];
}

/** The airline and aircraft for a route: an airline with a hub at either end, a plane of its fleet for the distance. */
export function operatorFor(from, to, distance) {
  const ids = Object.keys(AIRLINES);
  let pool = ids.filter((id) => AIRLINES[id].hubs.includes(from.iata) || AIRLINES[id].hubs.includes(to.iata));
  if (!pool.length) pool = ["united", "american", "twa", "eastern", "delta"];
  const h = hash([from.iata, to.iata].sort().join("-"));
  const airline = pool[h % pool.length];
  const fleet = AIRLINES[airline].fleet;
  const order = suited(distance).filter((t) => fleet.includes(t) && distance <= AIRCRAFT[t].range);
  // The best fit, or now and then the next one (some routes saw a bigger plane).
  const aircraft = order[(h >>> 8) % 4 === 0 && order.length > 1 ? 1 : 0] ?? "767";
  return { airline, aircraft, flightNumber: 100 + ((h >>> 4) % 1800) };
}

/* ---------------------------------------- */
/*  Time                                     */
/* ---------------------------------------- */

/**
 * Minutes on the ground by airport size, 1986: no ID check, a walk-through metal detector, and
 * anyone could walk to the gate; twenty minutes before a domestic flight was usually enough.
 */
export const GROUND = {
  hub: { curb: 30, bagCheck: 10, taxiOut: 18, taxiIn: 10, claim: 20 },
  medium: { curb: 22, bagCheck: 8, taxiOut: 12, taxiIn: 7, claim: 15 },
  small: { curb: 15, bagCheck: 5, taxiOut: 8, taxiIn: 5, claim: 10 }
};

/** Cruise and the jet stream, mph: eastbound flights ride it, westbound ones fight it. */
const CRUISE_MPH = 530;
const JET_STREAM_MPH = 55;
/** Climbing out and coming down, minutes on top of the cruise. */
const CLIMB_DESCENT = 20;

/**
 * Everything about a flight: { from, to, miles, airline, aircraft, flightNumber, fare (dollars),
 * steps: [{ key, label, detail, minutes, where: "origin" | "air" | "destination" }], minutes }.
 * bags: checking bags (the counter, and the wait at the carousel).
 */
export function planFlight(from, to, { year = 1986, month = 1, bags = true } = {}) {
  const distance = miles(from, to);
  const { airline, aircraft, flightNumber } = operatorFor(from, to, distance);
  const plane = AIRCRAFT[aircraft];
  const a = GROUND[from.size] ?? GROUND.medium, b = GROUND[to.size] ?? GROUND.medium;
  const east = Math.sin(rad(bearing(from, to)));
  const speed = CRUISE_MPH + JET_STREAM_MPH * east;
  const air = Math.round(CLIMB_DESCENT + (distance / speed) * 60);
  const steps = [
    { key: "curb", where: "origin", minutes: a.curb + (bags ? a.bagCheck : 0), label: "Curb to gate",
      detail: bags ? "Ticket counter, bags checked, the metal detector, the walk to the gate" : "Ticket counter, the metal detector, the walk to the gate" },
    { key: "board", where: "origin", minutes: plane.boarding, label: "Boarding", detail: `Rows called from the back, onto the ${plane.name}` },
    { key: "taxiOut", where: "origin", minutes: a.taxiOut, label: "Taxi and takeoff", detail: from.size === "hub" ? "In line for the runway" : "Out to the runway" },
    { key: "air", where: "air", minutes: air, label: "In the air", detail: `${Math.round(distance).toLocaleString()} miles${Math.abs(east) > 0.5 ? (east > 0 ? ", the jet stream behind you" : ", into the jet stream") : ""}` },
    { key: "taxiIn", where: "destination", minutes: b.taxiIn, label: "Taxi to the gate", detail: "Landing and rolling in" },
    { key: "deplane", where: "destination", minutes: plane.deplane, label: "Off the plane", detail: "Up the jet bridge" }
  ];
  if (bags) steps.push({ key: "claim", where: "destination", minutes: b.claim, label: "Baggage claim", detail: "Waiting at the carousel" });
  return {
    from: from.iata, to: to.iata, miles: Math.round(distance), airline, aircraft, flightNumber,
    fare: fareDollars(distance, fareLevel(year, month)), bags,
    steps, minutes: steps.reduce((s, x) => s + x.minutes, 0)
  };
}

/**
 * Where an encounter can interrupt the trip, in order, and the step it comes after (the air
 * point is halfway through the flight).
 */
export const ENCOUNTER_POINTS = [
  { key: "departing", label: "In the departing airport", after: "curb", where: "the departure gate" },
  { key: "boarding", label: "On the plane, before takeoff", after: "board", where: "the plane, at the gate" },
  { key: "air", label: "During the flight", after: "air", half: true, where: "the plane, in the air" },
  { key: "landed", label: "On the plane, after landing", after: "taxiIn", where: "the plane, at the gate" },
  { key: "arriving", label: "In the arriving airport", after: "deplane", where: "the arrivals hall" }
];

/** Minutes of the trip gone by when an encounter at this point begins. */
export function minutesUntil(plan, point) {
  const p = ENCOUNTER_POINTS.find((e) => e.key === point) ?? ENCOUNTER_POINTS[2];
  let total = 0;
  for (const step of plan.steps) {
    if (step.key === p.after) return total + (p.half ? Math.round(step.minutes / 2) : step.minutes);
    total += step.minutes;
  }
  return total;
}

/** Seconds into the trip when the weather becomes the destination's: halfway through the flight. */
export const midFlight = (plan) => minutesUntil(plan, "air") * 60;

/** What the GM's skip button calls the start of each step. */
const SKIP_TO = { board: "boarding", taxiOut: "taxi", deplane: "the gate", claim: "baggage claim" };
/**
 * The takeoff and the landing are skipped to a little before they happen, in real seconds (times
 * the GM's speed): 10 seconds before the takeoff roll (the last 20 seconds of taxiing out,
 * taxi-view.mjs TAKEOFF_SECONDS), and just before the landing's descent in the cabin begins (the
 * last 20 seconds of the flight, LANDING_SECONDS), so the whole comedown shows.
 */
export const TAKEOFF_LEAD = 20 + 10;
export const LANDING_LEAD = 20 + 2;

/**
 * The points the GM's skip stops at, in order: the start of each step on the ground, the takeoff
 * and the landing (a little before each), then the arrival. [{ key, label, at: seconds into the trip }].
 */
export function skipPoints(plan, rate = 1) {
  const points = [];
  let start = 0;
  for (const step of plan.steps) {
    const end = start + step.minutes * 60;
    if (step.key === "taxiOut") {
      points.push({ key: "taxiOut", label: SKIP_TO.taxiOut, at: start });
      points.push({ key: "takeoff", label: "takeoff", at: Math.max(start, end - TAKEOFF_LEAD * rate) });
    } else if (step.key === "air") {
      points.push({ key: "landing", label: "landing", at: Math.max(start, end - LANDING_LEAD * rate) });
    } else if (SKIP_TO[step.key]) {
      points.push({ key: step.key, label: SKIP_TO[step.key], at: start });
    }
    start = end;
  }
  points.push({ key: "arrival", label: "arrival", at: plan.minutes * 60 });
  return points;
}

/**
 * Where the GM's skip goes from so many seconds into the trip: the next skip point (skipPoints),
 * or the encounter when it comes first (a skip never passes it). `rate`: the GM's speed.
 * { key: a step key | "takeoff" | "landing" | "encounter" | "arrival", label, at: seconds into the trip }.
 */
export function nextSkip(plan, seconds, encounter = null, rate = 1) {
  const next = skipPoints(plan, rate).find((p) => p.at > seconds + 0.5) ?? { key: "arrival", label: "arrival", at: plan.minutes * 60 };
  if (encounter && !encounter.done) {
    const at = encounter.minutes * 60;
    if (at > seconds + 0.5 && at <= next.at) return { key: "encounter", label: "encounter", at };
  }
  return next;
}

/** "6 h 20 min", "45 min". */
export function formatMinutes(minutes) {
  const m = Math.round(minutes);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}
