// Themes: the era and look of the world the trains run through. PURE: no Foundry.
//
// A theme is chosen at four levels, most specific first:
//   stop  -> its platform and the track either side of it
//   line  -> everything on that line
//   scene -> the whole network (set in the editor's network settings)
//   world -> the module setting, the default for every scene
// Any level left empty (null) inherits from the next one down.
//
// Each theme names its station icon shape on the map (`icon`), its Font Awesome icon in the
// editor (`glyph`), its underground platform style (`platform`, drawStation) and the tunnel
// it uses where a stretch is set to the theme's tunnel (`tunnel`, drawTunnel).

export const THEMES = {
  modern: {
    label: "Modern",
    hint: "Concrete and tile, sodium lamps, billboards",
    icon: "rounded",
    glyph: "fa-city",
    platform: "tile",
    tunnel: "concrete"
  },
  industrial: {
    label: "Industrial",
    hint: "1880s to 1920s: brick, smokestacks, gas lamps, riveted iron",
    icon: "enamel",
    glyph: "fa-industry",
    platform: "brick",
    tunnel: "brick"
  },
  fantasy: {
    label: "Fantasy",
    hint: "Industrial fantasy: timber and stone, forges, lanterns, castles",
    icon: "shield",
    glyph: "fa-chess-rook",
    platform: "vault",
    tunnel: "rock"
  },
  future: {
    label: "Future",
    hint: "Neon skylines, cyber tunnels, maglev, light strips",
    icon: "hex",
    glyph: "fa-microchip",
    platform: "neon",
    tunnel: "cyber"
  }
};

export const DEFAULT_THEME = "modern";

export function isTheme(key) {
  return Object.hasOwn(THEMES, key ?? "");
}

/** The first theme set, from most specific to least, falling back to Modern. */
export function pickTheme(...levels) {
  return levels.find(isTheme) ?? DEFAULT_THEME;
}

/** A station's platform theme: the stop's own, then its line's, the scene's, the world's. */
export function stationTheme(net, line, station, world) {
  return pickTheme(station?.theme, line?.theme, net?.theme, world);
}

/**
 * A stretch of track's theme. A stop's theme covers the track either side of it; when both
 * ends have one, the stop the train is heading for wins.
 */
export function segmentTheme(net, line, from, to, world) {
  return pickTheme(to?.theme, from?.theme, line?.theme, net?.theme, world);
}

/** Choices for the editor's theme pickers, with an "inherit" option naming what it inherits. */
export function themeChoices(selected, inherited) {
  const inheritLabel = inherited ? `Inherit (${THEMES[inherited]?.label ?? inherited})` : "Inherit";
  return [
    { key: "", label: inheritLabel, selected: !isTheme(selected) },
    ...Object.entries(THEMES).map(([key, t]) => ({ key, label: t.label, selected: key === selected }))
  ];
}
