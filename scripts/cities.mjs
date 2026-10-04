// Real city networks for KG Cities scenes. PURE: no Foundry.
//
// KG Cities makes scenes of real US cities from OpenStreetMap, in the 1980s or today. When a
// scene is one of them, KG Transit sets up that city's rail network as it stood in the scene's
// year, from a city pack (data/cities/<id>.json, built by tools/cities/build.py):
//
//   { id, name, center, metro, core,                 metro/core: { center: [lon, lat], miles: [w, h] }
//     network: { name, badge, transferMinutes }, eras: { <era>: { network, badge } },
//     fares: [{ until?, amount, coin }],              the first whose `until` year is not past
//     stations: [{ id, name, lat, lon, platform, opened?, closed?, names?: [{ until, name }] }],
//     lines: [{ id, name, color, kind, stops, segments, opened?, closed?, names?: [{ until, name?, color? }] }],
//     snapshots: { <era>: { year, stations, lines } }, a hand-built network for an era (Boston 1986)
//     cars?: { <car>: { sound?, interior? } } }        city-specific art and sound
//
// What a scene says about itself (flags["kg-cities"], or the KG Cities API):
//   { city: "boston", era: "1980s" | "modern", year?: 1986,
//     bounds?: { north, south, west, east },          the lat/lon box stretched over the scene rectangle
//     extent?: "core" | "metro" }                     used for the box when bounds are missing

export const ERAS = {
  "1980s": { label: "1980s", year: 1986 },
  modern: { label: "Modern", year: null }
};

/** The shipped subway ride sound, the default for every city network. */
export const CITY_SOUND = "modules/kg-transit/assets/sounds/subway-loop.ogg";

/** A scene's city, era and year from KG Cities' scene data, or null when it is not a city scene. */
export function readCityInfo(data, now = new Date().getFullYear()) {
  if (!data || typeof data !== "object") return null;
  const city = String(data.city ?? data.cityId ?? "").trim().toLowerCase();
  if (!city) return null;
  const era = Object.hasOwn(ERAS, data.era) ? data.era : Number(data.year) && Number(data.year) < 2000 ? "1980s" : "modern";
  const year = Number.isFinite(Number(data.year)) && Number(data.year) > 1800 ? Math.round(Number(data.year)) : ERAS[era].year ?? now;
  const b = data.bounds;
  const bounds = b && ["north", "south", "west", "east"].every((k) => Number.isFinite(Number(b[k])))
    ? { north: Number(b.north), south: Number(b.south), west: Number(b.west), east: Number(b.east) } : null;
  return { city, era, year, bounds, extent: data.extent === "metro" ? "metro" : data.extent === "core" ? "core" : null };
}

// ------------------------------------------------------------------ map projection

const D2R = Math.PI / 180;

/** Normalised Web Mercator (0..1 across the world, y south), as KG Cities draws its maps. */
export function toWorld(lat, lon) {
  const s = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, lat)) * D2R);
  return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
}

/** A lat/lon box of so many miles [wide, tall] around a [lon, lat] centre. */
export function boxAround([lon, lat], [wideMiles, tallMiles]) {
  const dLat = (tallMiles * 1609.344) / 111320 / 2;
  const dLon = (wideMiles * 1609.344) / (111320 * Math.cos(lat * D2R)) / 2;
  return { north: lat + dLat, south: lat - dLat, west: lon - dLon, east: lon + dLon };
}

/** Maps lat/lon to scene pixels: the box's corners are the scene rectangle's corners. */
export function makeProjection(bounds, rect) {
  const nw = toWorld(bounds.north, bounds.west);
  const se = toWorld(bounds.south, bounds.east);
  const kx = rect.width / (se.x - nw.x);
  const ky = rect.height / (se.y - nw.y);
  return (lat, lon) => {
    const w = toWorld(lat, lon);
    return { x: rect.x + kx * (w.x - nw.x), y: rect.y + ky * (w.y - nw.y) };
  };
}

// ------------------------------------------------------------------ building the network

const openIn = (item, year) => (!item.opened || item.opened <= year) && (!item.closed || item.closed > year);

/** The entry of a by-year list (`until` years) in force in a year; entries without `until` last forever. */
function inForce(list, year) {
  return (list ?? []).filter((e) => !e.until || year <= e.until).sort((a, b) => (a.until ?? 1e9) - (b.until ?? 1e9))[0] ?? null;
}

/** The scene's lat/lon box: its own, else the pack's core or metro box. */
export function sceneBounds(pack, info) {
  if (info.bounds) return info.bounds;
  const area = pack[info.extent ?? "core"] ?? pack.core ?? pack.metro;
  return boxAround(area.center, area.miles);
}

/**
 * The network for a city scene in its year, ready to save on the scene, or a reason when
 * there is nothing to ride (no rail yet, or none inside the scene).
 * `rect` is the scene rectangle in pixels ({ x, y, width, height }).
 */
export function cityNetwork(pack, info, rect) {
  const year = info.year;
  const source = pack.snapshots?.[info.era] ?? pack;
  const project = makeProjection(sceneBounds(pack, info), rect);
  const margin = Math.max(rect.width, rect.height) * 0.005;
  const inside = (p) => p.x >= rect.x - margin && p.y >= rect.y - margin && p.x <= rect.x + rect.width + margin && p.y <= rect.y + rect.height + margin;

  const stations = new Map();
  for (const s of source.stations) {
    if (!openIn(s, year)) continue;
    const p = project(s.lat, s.lon);
    if (!inside(p)) continue;
    stations.set(s.id, {
      id: s.id,
      name: inForce(s.names, year)?.name ?? s.name,
      x: Math.round(p.x),
      y: Math.round(p.y),
      theme: null,
      platform: s.platform === "underground" || s.platform === "above" ? s.platform : "auto"
    });
  }

  let lines = [];
  for (const line of source.lines) {
    if (!openIn(line, year)) continue;
    const era = inForce(line.names, year);
    // Stops not open (or off the scene) drop out; the track across the gap keeps the scenery
    // of its first stretch, or its bridge if it crosses one.
    const stops = [];
    const segments = [];
    let gap = [];
    line.stops.forEach((id, i) => {
      if (i > 0) gap.push(line.segments[i - 1]);
      if (!stations.has(id)) return;
      if (stops.length) segments.push({ scenery: gap.includes("bridge") ? "bridge" : gap[0], minutes: null });
      stops.push(id);
      gap = [];
    });
    if (stops.length < 2) continue;
    lines.push({
      id: line.id,
      name: era?.name ?? line.name,
      color: era?.color ?? line.color,
      kind: line.kind ?? "metro",
      theme: null,
      stops,
      segments
    });
  }
  lines = dropDuplicateServices(lines);

  const used = new Set(lines.flatMap((l) => l.stops));
  const eraNet = pack.eras?.[info.era] ?? {};
  const fare = inForce(pack.fares, year) ?? { amount: 0, coin: "sp" };
  const net = {
    name: eraNet.network ?? pack.network.name,
    badge: eraNet.badge ?? pack.network.badge ?? "M",
    theme: null,
    fare: { amount: fare.amount, coin: fare.coin },
    transferMinutes: pack.network.transferMinutes ?? 4,
    partyTokenId: null,
    cars: { subway: { sound: CITY_SOUND, interior: null }, ...structuredClone(pack.cars ?? {}) },
    preset: { city: pack.id, cityName: pack.name, era: info.era, year, version: pack.version ?? 1 },
    lines,
    stations: [...stations.values()].filter((s) => used.has(s.id))
  };
  let reason = null;
  if (!lines.length) {
    const first = Math.min(...source.lines.map((l) => l.opened ?? 0).filter(Boolean));
    reason = Number.isFinite(first) && first > year
      ? `${pack.name} had no rail transit in ${year}. Its first line here opened in ${first}.`
      : `None of ${pack.name}'s rail lines in ${year} reach this scene.`;
    net.preset.note = reason;
  }
  return { net, reason };
}

/**
 * Services that became the same train once later stations are filtered out (two branches
 * that both end where the branch had not been built yet) are kept once.
 */
export function dropDuplicateServices(lines) {
  const kept = [];
  for (const line of [...lines].sort((a, b) => b.stops.length - a.stops.length)) {
    const set = new Set(line.stops);
    const dup = kept.some((k) => {
      if (k.name !== line.name && k.stops.length !== line.stops.length) return false;
      const other = new Set(k.stops);
      return [...set].every((id) => other.has(id));
    });
    if (!dup) kept.push(line);
  }
  // Back to the pack's order.
  return lines.filter((l) => kept.includes(l));
}

/** "Boston, 1986" */
export function presetLabel(preset) {
  return preset ? `${preset.cityName ?? preset.city}, ${preset.year}` : "";
}
