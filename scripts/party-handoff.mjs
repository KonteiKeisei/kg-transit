// With KG Cities (party rides): how a party's travel in the city meets the trains. Nothing here
// runs without KG Cities.
//  - A party that arrives at a station (a walk, a cab, its own vehicles, a teleport) gets the
//    Board window there, for the GM, with that party chosen.
//  - planTrain: the best stations to walk to and from for a trip across the map, for KG Cities'
//    travel window to offer the train beside walking and driving.
//  - openBoard: the Board window for a party, at a station, with its destination chosen.
// Boarding stays the GM's: the window opens only on the GM in charge's screen.

import { kmPerPixel, sceneEnabled, sceneNetwork, stationPositions, worldDwell, worldTheme } from "./config.mjs";
import { fareValue } from "./fare.mjs";
import { findTrip, stationOf } from "./network.mjs";
import { BoardDialog } from "./board-dialog.mjs";
import { partyRides } from "./ride.mjs";

/** A party counts as at a station within this many grid spaces of it (as Board finds riders). */
const AT_STATION_GRID = 4;
/** Walking pace for choosing stations: 3 mph, in metres a second, and how much longer streets are than a straight line. */
const WALK_MPS = 1.341;
const STREET_FACTOR = 1.3;
/** How many of the nearest stations to try at each end. */
const TRY = 4;

/**
 * The best train for a trip from one scene point to another, or null (no network on the scene,
 * or no line that helps): { originId, destinationId, originName, destinationName,
 * origin: { x, y }, destination: { x, y }, seconds (the ride), legs: [{ label, color }],
 * fare (copper a rider) }. Stations are chosen for the least walking plus riding, the walks
 * reckoned as the crow flies; KG Cities works out the real walks to them.
 */
export function planTrain(scene, from, to) {
  if (!scene || !sceneEnabled(scene)) return null;
  const net = sceneNetwork(scene), at = stationPositions(net), kmPx = kmPerPixel(scene);
  const ids = Object.keys(at);
  if (ids.length < 2) return null;
  const walk = (a, b) => (Math.hypot(a.x - b.x, a.y - b.y) * kmPx * 1000 * STREET_FACTOR) / WALK_MPS;
  const nearest = (p) => ids.slice().sort((a, b) => walk(p, at[a]) - walk(p, at[b])).slice(0, TRY);
  let best = null;
  for (const o of nearest(from)) for (const d of nearest(to)) {
    if (o === d) continue;
    const trip = findTrip(net, o, d, kmPx, worldTheme(), worldDwell());
    if (!trip) continue;
    const total = walk(from, at[o]) + trip.total + walk(at[d], to);
    if (!best || total < best.total) best = { o, d, trip, total };
  }
  if (!best) return null;
  const { o, d, trip } = best;
  return {
    originId: o, destinationId: d,
    originName: stationOf(net, o)?.name ?? "the station", destinationName: stationOf(net, d)?.name ?? "the station",
    origin: at[o], destination: at[d], seconds: trip.total,
    legs: trip.legs.map((leg) => ({ label: leg.label, color: trip.lines[leg.line].color })),
    fare: fareValue(net.fare)
  };
}

/** The station a point stands at (within reach, in scene pixels: four grid spaces by default), or null. */
export function stationAt(scene, point, reach = AT_STATION_GRID * scene?.grid?.size) {
  if (!scene || !sceneEnabled(scene)) return null;
  const at = stationPositions(sceneNetwork(scene));
  let best = null, bd = reach;
  for (const [id, p] of Object.entries(at)) {
    const d = Math.hypot(p.x - point.x, p.y - point.y);
    if (d <= bd) { bd = d; best = id; }
  }
  return best;
}

/**
 * The Board window, for the GM in charge, on the scene they are looking at: at a station, for a
 * party token (its members ride), with a destination chosen. False when it cannot open here.
 */
export function openBoard({ layer, ride, scene, originId, partyTokenId = null, destinationId = null }) {
  if (!game.user.isGM || !game.users.activeGM?.isSelf) return false;
  if (!scene || canvas.scene?.id !== scene.id) return false;
  new BoardDialog({ originId, layer, ride, partyTokenId, destinationId }).render({ force: true });
  return true;
}

/** Listen for KG Cities' parties arriving: at a station, offer the trains (the GM in charge). */
export function installHandoff({ layer, ride }) {
  Hooks.on("kgCities.arrived", ({ token, scene, trip }) => {
    if (!partyRides() || !game.user.isGM || !game.users.activeGM?.isSelf || !token) return;
    // A trip planned with the train opens its own Board, destination and all (KG Cities does it).
    if (trip?.then?.board) return;
    // Only a party set down on the station: the token over its icon. Near is not enough (at a
    // city's scale, four grid spaces is a quarter of a mile, and a trip to Fenway is not a trip
    // to Blandford Street).
    const size = Math.max(token.width, token.height) * scene.grid.size;
    const centre = { x: token.x + (token.width * scene.grid.size) / 2, y: token.y + (token.height * scene.grid.size) / 2 };
    const originId = stationAt(scene, centre, size / 2);
    if (!originId) return;
    if (ride.partyRide(token.id)) return;
    if (!openBoard({ layer, ride, scene, originId, partyTokenId: token.id })) {
      ui.notifications.info(`${token.name} reached ${stationOf(sceneNetwork(scene), originId)?.name ?? "a station"}. View that scene to board them.`);
    }
  });
}
