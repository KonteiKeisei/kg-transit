import { normalize } from "./network.mjs";
import { DEFAULT_THEME, isTheme } from "./themes.mjs";

export const MODULE_ID = "kg-transit";
export const ASSET_PATH = `modules/${MODULE_ID}/assets`;

/** Settings that are not per car (each car's sound and interior are registered from CARS). */
export const SETTINGS = {
  loopVolume: "loopVolume",
  terminalVolume: "terminalVolume",
  taxiBriefing: "taxiBriefing",
  landingBriefing: "landingBriefing",
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

/**
 * Put a full-screen view (the flight's scenes) just above the canvas and under everything else:
 * Foundry's interface, sheets and other modules' HUDs stay on top. It goes right after the
 * canvas in the page, at the canvas's own stacking level.
 */
export function attachAboveCanvas(el) {
  const board = document.getElementById("board");
  if (board?.parentElement) board.after(el);
  else document.body.prepend(el);
  const z = board ? Number.parseInt(getComputedStyle(board).zIndex, 10) : Number.NaN;
  el.style.zIndex = Number.isFinite(z) ? String(z) : "auto";
}

/**
 * The free part of the canvas on screen, where a full-screen view goes: the canvas's box, inside
 * Foundry's interface area and no lower than the bottom of the chat. The whole window when there
 * is no canvas.
 */
export function canvasRect() {
  const box = (el) => {
    const r = el?.getBoundingClientRect();
    return r && r.width > 50 && r.height > 50 ? r : null;
  };
  const board = box(document.getElementById("board"));
  const r = board
    ? { left: board.left, top: board.top, right: board.right, bottom: board.bottom }
    : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  // Foundry shrinks its interface area to make room for the camera dock (wherever it is docked,
  // however big it grows): keep inside it.
  const ui = box(document.getElementById("interface"));
  if (ui) {
    r.left = Math.max(r.left, ui.left);
    r.top = Math.max(r.top, ui.top);
    r.right = Math.min(r.right, ui.right);
    r.bottom = Math.min(r.bottom, ui.bottom);
  }
  // The bottom of the chat is the lowest safe line of the screen: nothing of ours goes lower.
  const chat = box(document.getElementById("sidebar"));
  if (chat && chat.bottom > r.top + (r.bottom - r.top) / 2) r.bottom = Math.min(r.bottom, chat.bottom);
  return { ...r, width: r.right - r.left, height: r.bottom - r.top };
}

/**
 * Foundry's own interface pieces on screen, read directly the way Calendaria's HUD finds its
 * place: the scene controls, the scene navigation, the sidebar (its real width, nothing when
 * collapsed), the hotbar, the players list and the camera (A/V) dock. Each is sorted by the edge
 * of the canvas it sits along. [{ edge: "top" | "right" | "bottom" | "left", rect }].
 */
function interfacePieces(rect = canvasRect()) {
  const apps = globalThis.ui ?? {};
  const els = [
    apps.controls?.element ?? document.getElementById("scene-controls"),
    apps.nav?.element ?? document.getElementById("scene-navigation") ?? document.getElementById("navigation"),
    apps.sidebar?.element ?? document.getElementById("sidebar"),
    apps.hotbar?.element ?? document.getElementById("hotbar"),
    apps.players?.element ?? document.getElementById("players"),
    apps.webrtc?.element ?? document.getElementById("camera-views")
  ];
  const boxes = [];
  for (let el of els) {
    el = el?.[0] ?? el;
    if (!(el instanceof HTMLElement) || !el.isConnected) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    // Only what overlaps the canvas matters (a dock beside a shrunk canvas is already outside it).
    if (!r.width || !r.height || r.right <= rect.left || r.left >= rect.right || r.bottom <= rect.top || r.top >= rect.bottom) continue;
    boxes.push(r);
  }
  // Strips across the whole canvas (the sidebar, a camera dock) first; they trim the area the
  // smaller pieces are then sorted against, so the players list above a dock counts as the bottom.
  const spans = (r) => Math.max(r.width / rect.width, r.height / rect.height);
  boxes.sort((a, b) => spans(b) - spans(a));
  const area = { ...rect };
  const pieces = [];
  for (const r of boxes) {
    // How far it stands off each edge of what is left (past an edge counts as touching it); the
    // nearest wins, and in a corner the edge along its longer side.
    const gaps = {
      top: Math.max(0, r.top - area.top), bottom: Math.max(0, area.bottom - r.bottom),
      left: Math.max(0, r.left - area.left), right: Math.max(0, area.right - r.right)
    };
    const along = r.width >= r.height ? ["top", "bottom"] : ["left", "right"];
    const nearest = Math.min(...Object.values(gaps));
    const close = Object.keys(gaps).filter((k) => gaps[k] <= nearest + 24);
    const edge = close.find((k) => along.includes(k)) ?? close[0];
    pieces.push({ edge, rect: r });
    if (spans(r) >= 0.6) {
      if (edge === "top") area.top = Math.max(area.top, r.bottom);
      else if (edge === "bottom") area.bottom = Math.min(area.bottom, r.top);
      else if (edge === "left") area.left = Math.max(area.left, r.right);
      else area.right = Math.min(area.right, r.left);
    }
  }  return pieces;
}

/**
 * How far in from each edge of the canvas's box Foundry's interface reaches (the scene
 * navigation along the top, the scene controls on the left, the sidebar on the right, the
 * hotbar, players list and a camera dock along the bottom). A full-screen view keeps its
 * captions and controls inside that. { top, right, bottom, left } in pixels.
 */
export function safeArea(rect = canvasRect()) {
  const ins = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const { edge, rect: r } of interfacePieces(rect)) {
    if (edge === "top") ins.top = Math.max(ins.top, r.bottom - rect.top);
    else if (edge === "bottom") ins.bottom = Math.max(ins.bottom, rect.bottom - r.top);
    else if (edge === "left") ins.left = Math.max(ins.left, r.right - rect.left);
    else ins.right = Math.max(ins.right, rect.right - r.left);
  }
  return ins;
}

/**
 * Where a corner window (the subway ride window, the cabin) goes: left of the sidebar and higher
 * than the camera dock, the canvas's bottom edge and anything else along the bottom under it,
 * `gap` pixels clear. { right, bottom } in px.
 */
export function cornerSpot(gap = 16, width = 640) {
  const rect = canvasRect();
  const pieces = interfacePieces(rect);
  let right = rect.right;
  for (const { edge, rect: r } of pieces) if (edge === "right") right = Math.min(right, r.left);
  let bottom = rect.bottom;
  for (const { edge, rect: r } of pieces) {
    if (edge === "bottom" && r.right > right - width - gap && r.left < right) bottom = Math.min(bottom, r.top);
  }
  return {
    right: Math.round(window.innerWidth - right + gap),
    bottom: Math.round(window.innerHeight - bottom + gap)
  };
}
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
