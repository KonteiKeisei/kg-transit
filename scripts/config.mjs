import { normalize } from "./network.mjs";
import { DEFAULT_THEME, isTheme } from "./themes.mjs";

export const MODULE_ID = "kg-transit";
export const ASSET_PATH = `modules/${MODULE_ID}/assets`;

/** Settings that are not per car (each car's sound and interior are registered from CARS). */
export const SETTINGS = {
  loopVolume: "loopVolume",
  terminalVolume: "terminalVolume",
  iconSize: "iconSize",
  showToAll: "showRideToAll",
  activeRide: "activeRide",
  activeFlight: "activeFlight",
  dollarRate: "dollarRate",
  liveryFolder: "liveryFolder",
  theme: "theme",
  cityAuto: "cityAuto"
};

export const FLAGS = {
  enabled: "enabled",
  network: "network"
};

export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

/** The world's default theme, which scenes, lines and stops inherit unless they override it. */
export function worldTheme() {
  const value = game.settings.get(MODULE_ID, SETTINGS.theme);
  return isTheme(value) ? value : DEFAULT_THEME;
}

export function sceneEnabled(scene) {
  return !!scene?.getFlag(MODULE_ID, FLAGS.enabled);
}

/** The scene's network, always in a usable shape. */
export function sceneNetwork(scene) {
  return normalize(scene?.getFlag(MODULE_ID, FLAGS.network));
}

/** Save the whole network. Lines and stations are arrays, so a save replaces them outright. */
export async function saveNetwork(scene, net) {
  await scene.update({ [`flags.${MODULE_ID}.${FLAGS.network}`]: normalize(net) });
}

/** Kilometres per scene grid unit, from the scene's units (feet if unrecognised). */
const UNIT_KM = {
  ft: 0.0003048, feet: 0.0003048, foot: 0.0003048,
  yd: 0.0009144, yard: 0.0009144, yards: 0.0009144,
  m: 0.001, meter: 0.001, meters: 0.001, metre: 0.001, metres: 0.001,
  km: 1, kilometer: 1, kilometers: 1, kilometre: 1, kilometres: 1,
  mi: 1.609344, mile: 1.609344, miles: 1.609344
};

/** Map pixels to kilometres on a scene, for working out travel times. */
export function kmPerPixel(scene) {
  const grid = scene.grid;
  const unit = UNIT_KM[String(grid.units ?? "ft").trim().toLowerCase().replace(/\.$/, "")] ?? UNIT_KM.ft;
  return ((grid.distance || 5) * unit) / (grid.size || 100);
}

/** Positions of placed stations, keyed by id. */
export function stationPositions(net) {
  const out = {};
  for (const s of net.stations) if (Number.isFinite(s.x) && Number.isFinite(s.y)) out[s.id] = { x: s.x, y: s.y };
  return out;
}

/** "2:31 PM" for a world time, using the active calendar's hours and minutes. */
export function formatClock(worldTime) {
  const c = game.time.calendar?.timeToComponents?.(worldTime);
  if (!c) return "";
  const hour = c.hour ?? 0;
  const minute = String(c.minute ?? 0).padStart(2, "0");
  const h12 = ((hour + 11) % 12) + 1;
  return `${h12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

export function formatDuration(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
