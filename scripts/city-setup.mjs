import { FLAGS, MODULE_ID, SETTINGS, saveNetwork, setting } from "./config.mjs";
import { cityNetwork, presetLabel, readCityInfo } from "./cities.mjs";

/** The KG Cities module, whose scenes are real cities. */
export const CITIES_MODULE = "kg-cities";
const packs = new Map();

/**
 * What KG Cities says a scene is: { city, era, year, bounds, extent }, or null. Asks the
 * module's API when it offers one, otherwise reads the scene's flags (so a city scene still
 * works when KG Cities is turned off).
 */
export function sceneCity(scene) {
  if (!scene) return null;
  const api = game.modules.get(CITIES_MODULE)?.api;
  let data = null;
  try {
    data = api?.sceneInfo?.(scene) ?? null;
  } catch (err) {
    console.warn(`${MODULE_ID} | KG Cities could not describe the scene`, err);
  }
  return readCityInfo(data ?? scene.flags?.[CITIES_MODULE]);
}

/** A city's pack from data/cities, or null when the module has none for it. */
export function loadPack(cityId) {
  if (!packs.has(cityId)) {
    packs.set(cityId, fetch(`modules/${MODULE_ID}/data/cities/${encodeURIComponent(cityId)}.json`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null));
  }
  return packs.get(cityId);
}

/**
 * The preset network for a city scene: { info, net, reason }, or null when the scene is not
 * a city or there is no pack for it. `reason` explains an empty network.
 */
export async function cityPreset(scene) {
  const info = sceneCity(scene);
  if (!info) return null;
  const pack = await loadPack(info.city);
  if (!pack) return null;
  const { net, reason } = cityNetwork(pack, info, scene.dimensions.sceneRect);
  return { info, net, reason, pack };
}

/**
 * Put the city's network on the scene, keeping its party token. Transit is turned on only
 * when there is something to ride.
 */
export async function applyCityPreset(scene, preset, { keepParty = null } = {}) {
  const net = { ...preset.net, partyTokenId: keepParty };
  await saveNetwork(scene, net);
  if (net.lines.length) await scene.setFlag(MODULE_ID, FLAGS.enabled, true);
  return net;
}

/**
 * On a city scene that has never had a network, the active GM sets up the city's network
 * as it stood in the scene's year (module setting "Set up city networks").
 */
export async function autoSetupCity(scene) {
  if (!scene || game.user !== game.users.activeGM || !setting(SETTINGS.cityAuto)) return false;
  if (scene.getFlag(MODULE_ID, FLAGS.network) !== undefined) return false;
  const preset = await cityPreset(scene);
  if (!preset) return false;
  const net = await applyCityPreset(scene, preset);
  if (net.lines.length) {
    ui.notifications.info(`KG Transit: ${net.name} is ready on this scene (${presetLabel(net.preset)}): ${net.lines.length} lines, ${net.stations.length} stations. Double-click a station to ride.`);
  } else if (preset.reason) {
    ui.notifications.info(`KG Transit: ${preset.reason}`);
  }
  return true;
}
