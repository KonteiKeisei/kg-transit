// The choices a network is built from: train types, scenery between stops, and station
// styles. Pure data, shared by the editor, the timetable and the window scenery.

/**
 * Train types: running speed (km/h over straight-line distance), dwell at each stop (s),
 * and which car the riders sit in.
 */
export const KINDS = {
  metro: { label: "Metro", kmh: 36, dwell: 30, car: "subway" },
  light: { label: "Light rail", kmh: 28, dwell: 25, car: "subway" },
  tram: { label: "Tram", kmh: 16, dwell: 20, car: "subway" },
  express: { label: "Express", kmh: 60, dwell: 40, car: "subway" },
  steam: { label: "Steam", kmh: 40, dwell: 60, car: "steam" }
};

/**
 * Car interiors. Each art has transparent windows; `door` and `win` are the end door (frame
 * included) and its window in art pixels, for showing the car ahead; `mask` repaints the
 * overhead line maps in the line's colour; `smoke` blows engine smoke past the windows.
 */
export const CARS = {
  subway: {
    label: "Subway car",
    interior: "car-interior.webp",
    mask: "strip-map-mask.webp",
    door: { x: 775, y: 313, w: 120, h: 265 },
    win: { x: 802, y: 344, w: 67, h: 108 },
    soundSetting: "subwaySound",
    interiorSetting: "subwayInterior"
  },
  steam: {
    label: "Steam coach",
    interior: "steam-interior.webp",
    mask: null,
    door: { x: 778, y: 318, w: 116, h: 282 },
    win: { x: 800, y: 340, w: 72, h: 116 },
    smoke: true,
    soundSetting: "steamSound",
    interiorSetting: "steamInterior"
  }
};

export function carFor(kind) {
  return CARS[(KINDS[kind] ?? KINDS.metro).car] ?? CARS.subway;
}

/**
 * What riders see between two stops. `near` is the row of buildings (or tunnel wall) beside
 * the track, `far` the skyline or landscape behind it; tunnels have no far layer.
 */
export const SCENERY = {
  "tunnel-concrete": { label: "Tunnel (theme)", group: "Underground", icon: "fa-archway", tunnel: "theme" },
  "tunnel-brick": { label: "Tunnel: brick", group: "Underground", icon: "fa-dungeon", tunnel: "brick" },
  "tunnel-rock": { label: "Tunnel: rock cave", group: "Underground", icon: "fa-mountain", tunnel: "rock" },
  "tunnel-cyber": { label: "Tunnel: cyber", group: "Underground", icon: "fa-microchip", tunnel: "cyber" },
  city: { label: "City", group: "Urban", icon: "fa-city", near: "city", far: "city" },
  downtown: { label: "Downtown towers", group: "Urban", icon: "fa-building", near: "downtown", far: "downtown" },
  town: { label: "Old town", group: "Urban", icon: "fa-house-chimney", near: "town", far: "city" },
  fantasy: { label: "Fantasy city", group: "Urban", icon: "fa-chess-rook", near: "fantasy", far: "fantasy" },
  elevated: { label: "Elevated over the city", group: "Urban", icon: "fa-train", near: "elevated", far: "city" },
  industrial: { label: "Industrial", group: "Urban", icon: "fa-industry", near: "industrial", far: "city" },
  dockside: { label: "Dockside", group: "Urban", icon: "fa-anchor", near: "dockside", far: "harbor" },
  suburb: { label: "Suburbs", group: "Open", icon: "fa-house", near: "suburb", far: "hills" },
  countryside: { label: "Countryside", group: "Open", icon: "fa-wheat-awn", near: "countryside", far: "farmland" },
  forest: { label: "Forest", group: "Open", icon: "fa-tree", near: "forest", far: "hills" },
  mountains: { label: "Mountains", group: "Open", icon: "fa-mountain-sun", near: "mountains", far: "mountains" },
  coast: { label: "Coast", group: "Open", icon: "fa-water", near: "coast", far: "sea" },
  bridge: { label: "Bridge over water", group: "Open", icon: "fa-bridge-water", near: "bridge", far: "river" }
};

export const DEFAULT_SCENERY = "tunnel-concrete";

export function isTunnel(scenery) {
  return !!SCENERY[scenery]?.tunnel;
}

/**
 * Where a stop's platform is. Auto: underground when a tunnel reaches the stop, otherwise
 * above ground. The theme decides what the platform looks like.
 */
export const PLATFORMS = {
  auto: { label: "Auto" },
  underground: { label: "Underground" },
  above: { label: "Above ground" }
};

/** Line colours offered first in the editor; any colour can be picked. */
export const SUGGESTED_COLORS = ["#d6312b", "#ee8a1d", "#1f5fbf", "#1e9a4a", "#8a3fb6", "#f2c418", "#1aa3b8", "#c2447f", "#6b6b6b", "#7a4a2a"];
