// Airports: every KG Cities city's airports as of 1986 (data/airports.json, built by
// tools/build-airports.mjs). On a KG Cities scene a city's airports are drawn with its landmarks,
// in violet: terminals as buildings, the airfield's outline dashed. Clicking one (the GM) opens
// the flight booking.

import { MODULE_ID } from "./config.mjs";

let list = null;

/** Every airport: [{ id, iata, name, cities, size, lat, lon, opened?, closed?, text, outline, terminals }]. */
export async function loadAirports() {
  if (!list) {
    const res = await fetch(foundry.utils.getRoute(`modules/${MODULE_ID}/data/airports.json`)).catch(() => null);
    list = res?.ok ? await res.json() : [];
  }
  return list;
}

/** Open in a year: opened by then, not closed yet. */
export const openIn = (a, year) => (!a.opened || year >= a.opened) && (!a.closed || year < a.closed);

/** An airport as KG Cities draws a landmark. */
function asLandmark(a) {
  return {
    id: `kg-transit:${a.iata}`, name: a.name, lat: a.lat, lon: a.lon, tone: "airport", glow: true, summary: a.text,
    ...(a.opened ? { from: a.opened } : {}), ...(a.closed ? { until: a.closed } : {}),
    buildings: a.terminals, grounds: a.outline, airport: a
  };
}

/** Hand KG Cities our airports for its maps. */
export function registerAirports() {
  const cities = game.modules.get("kg-cities");
  if (!cities?.active || typeof cities.api?.addLandmarks !== "function") return;
  cities.api.addLandmarks(async (flag) => (await loadAirports()).filter((a) => a.cities.includes(flag.city)).map(asLandmark));
}
