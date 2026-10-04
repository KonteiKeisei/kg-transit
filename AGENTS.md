# Working on KG Transit

This file is for anyone changing the module, and especially for an AI coding assistant (Claude, ChatGPT, Copilot, Cursor and the like). Give it this file first. It explains how the module fits together, where things live, and how to make the common changes safely.

Tools that look for instructions automatically: Codex and many others read `AGENTS.md`; Claude Code reads `CLAUDE.md` (copy or rename this file if you use it); Cursor reads `.cursorrules`.

---

## What the module is

A Foundry VTT **v13** module (`kg-transit`). The GM builds a transit network per scene (lines, stops, scenery between stops), places stops on the map, and the party rides between them. A ride:

- moves **game time in real time** (the active GM's client advances `game.time`),
- shows a **ride window** to viewers: a car interior image with transparent windows over scenery drawn on a canvas in perspective,
- moves the **party token** along the line on the map,
- charges **fares** from dnd5e actors' coins.

Hard dependency: **Calendaria** (weather and its real-time clock). System features (currency, party/group actors) assume **dnd5e 5.3.3**.

There is **no build step**: plain ES modules loaded by Foundry, one stylesheet, Handlebars templates. Tests run in Node with no dependencies.

## Layout

```
module.json                 Foundry manifest (id kg-transit, requires calendaria)
scripts/
  main.mjs                  Entry: settings, hooks, the one scene control, opens the editor
  catalog.mjs               PURE. Train types (KINDS), cars (CARS), scenery (SCENERY), PLATFORMS
  themes.mjs                PURE. THEMES (modern, industrial, fantasy, future) and theme resolution
  cities.mjs                PURE. City packs to networks: era/year filtering, projection, KG Cities scene data
  city-setup.mjs            Detects KG Cities scenes, loads packs, seeds scenes (auto on first view)
  network.mjs               PURE. Network shape, normalize(), routing (findTrip), timing, trips
  timeline.mjs              PURE. Where the train is at any second (stateAt), map position (trainPoint)
  fare.mjs                  PURE. dnd5e coins: fare value, paying with change
  demo-network.mjs          PURE. The sample network; starterNetwork() seeds new scenes
  config.mjs                Module id, setting keys, scene flag helpers, map scale (kmPerPixel), clock text
  editor.mjs                Network editor (ApplicationV2 + templates/editor.hbs)
  board-dialog.mjs          Board dialog (ApplicationV2 + templates/board.hbs)
  station-layer.mjs         PIXI station icons on the canvas, hover, double-click, drag, click-to-place
  ride.mjs                  RideController: ride state, GM clock driving, fast-forward, arrival
  follow.mjs                TokenTrain (moves tokens, GM only) and CameraFollow (every client)
  overlay.mjs               The ride window: car interior, HUD, line strip, sound, car switching
  scenery.mjs               Wall renderer (perspective columns), texture cache, smoke, next car, sway
  scenery-art.mjs           Canvas drawing of every texture, per theme: near rows, far skylines, tunnels, platforms
  weather.mjs               Calendaria weather to ride weather; rain/snow/fog/lightning layer
  flights.mjs               PURE. Air travel, 1986: distance, the fare level (SIFL), airlines and aircraft by route, curb-to-curb steps, encounter points
  airports.mjs              Loads data/airports.json; hands each city's airports to KG Cities (api.addLandmarks) to draw in violet
  flight-dialog.mjs         Flight booking (ApplicationV2 + templates/flight.hbs), opened by Hooks "kgCities.airport"
  flight.mjs                FlightController: world setting activeFlight, the GM's clock, skips (the clock only), the destination's weather halfway, destination scene, tokens, encounter, Continue flight
  plane-show.mjs            Every client's flight screen: five scenes (departure terminal, jet bridge, flight, jet bridge,
                            arrival terminal) filling the free canvas area (config.mjs canvasRect/safeArea, read from
                            Foundry's own interface as Calendaria's HUD does), a fade to black between scenes, the cabin
                            in its own subway-style window (cornerSpot), terminal ambiance and jets by scene
  plane-lights.mjs          A plane's night lights: windows found in the art (small dark blobs in rows), beacons and
                            tail light from its outline, wingtip by hand per plane; darkness(hour) eases dusk and dawn
  sky.mjs                   Sky, clouds and weather on a 2D canvas, for the cabin windows and the flight screen
templates/editor.hbs, board.hbs, flight.hbs
styles/transit.css          All styles. Prefixes: .kg-transit-* (Foundry UI), .kgt-* (ride window, editor)
assets/                     car-interior.webp, steam-interior.webp (keyed), strip-map-mask.webp, flight/, terminals/, sounds/*.ogg
                            (shipped images are WebP; the tools write WebP; source art in assets/ is not shipped)
data/cities/<id>.json       City packs (generated by tools/cities/build.py; do not hand-edit)
data/cities/index.json      Ids of the cities with packs
tests/*.test.mjs            node --test; cover the PURE files and the token mover
tools/
  preview.html              Runs the real ride window outside Foundry (stubs game, CALENDARIA)
  icons-preview.html        Draws station icons with real PIXI on a mocked canvas (?theme=)
  themes-preview.html       Gallery of every theme's textures, drawn flat (?theme=&tod=&kinds=)
  editor-preview.html       The real network editor with Foundry stubbed (?theme= sets the world default)
  preview-server.py         Serves the module at /modules/kg-transit/ for the previews (no cache)
  key-interior.py           Keys green-screen windows out of interior source art
  package.py                Builds "dist/kg-transit v<version>.zip" (kg-transit/ at the top); never overwrites a built version
  build-airports.mjs        tools/airports/airports.json (the 1986 airports, their texts) to data/airports.json, outlines from OpenStreetMap
  flight-art.py             Cuts assets/flight/ (plane side views, the cabin) out of tools/flight-src/
  terminal-art.py           assets/terminals/<CODE>-terminal|day|dusk.webp from assets/airport-terminal-*.zip (not in git):
                            the terminal's #00FF00 windows keyed clear, the tarmac plates re-encoded
  flight-preview.html       Plays a flight outside Foundry (jump buttons for each end and the air); records clips via preview-server's /save/
  cities/build.py           Builds data/cities from OpenStreetMap (Overpass) and Wikidata; curation tables inside
  cities/index.json         Copy of KG Cities' city list (ids, centres, metro and core boxes)
  cities/boston-1986.json   The hand-built 1986 MBTA, used as Boston's 1980s snapshot
```

Files marked PURE import nothing from Foundry or the DOM, so Node can test them. Keep it that way: put Foundry calls in the other files.

## Data model

The network is stored per scene in the flag `flags.kg-transit.network`, written whole by `saveNetwork()` (config.mjs). Lines and stations are **arrays** so a save replaces them outright (Foundry merges objects in flag updates, which would keep deleted keys).

```js
{
  name: "City Transit",          // speaker for chat cards
  badge: "M",                    // letters on station icons
  theme: null,                   // scene theme: key of THEMES, or null to use the world setting
  fare: { amount: 2, coin: "sp" },
  transferMinutes: 4,
  partyTokenId: null,            // optional token on this scene that rides the line
  cars: { subway: { sound, interior } },  // optional per-network sound and car art by CARS key (beats the module settings)
  preset: null,                  // { city, cityName, era, year, version, note? } when made from a city pack
  stations: [{ id, name, x, y, theme, platform }],  // x, y in scene pixels or null; theme null = inherit; platform auto | underground | above
  lines: [{
    id, name, color, kind, theme, // kind: key of KINDS (metro, light, tram, express, steam); theme null = inherit
    stops: [stationId, ...],     // riding order; a station on two lines is a transfer
    segments: [{ scenery, minutes }]  // segments[i] runs stops[i] to stops[i+1]; minutes null = from distance
  }]
}
```

Always pass saved data through `normalize()` (network.mjs) before use; it fills defaults and keeps `segments` in step with `stops`. `flags.kg-transit.enabled` turns the network on for a scene.

**Trips** (`findTrip` / `buildTrip`) are self-contained: they carry `names` (station names) and `lines` (name, colour, car) so any client can show a ride without reading the scene. A trip's `segments[]` have `from`, `to`, `line`, `env` (the scenery key), `theme`, `depart`, `arrive` (seconds from boarding). `platforms` maps each station on the trip to its platform theme, and `platformKinds` to `"underground"` or `"above"`.

## Themes

Four themes (`THEMES`, themes.mjs): **modern**, **industrial** (1880s to 1920s), **fantasy** (industrial fantasy), **future** (neon). A theme is picked at four levels, most specific first: **stop**, **line**, **scene** (`net.theme`), **world** (the `theme` module setting, read with `worldTheme()` in config.mjs). Null at any level inherits.

- `stationTheme(net, line, station, world)`: a platform. At a transfer the trip uses the line being boarded.
- `segmentTheme(net, line, from, to, world)`: a stretch of track. A stop's theme covers the track either side; the stop ahead wins.
- Themes are resolved when the trip is built (`findTrip(..., worldTheme)`), so every client draws the same thing.

What a theme changes:

- **Scenery** (scenery-art.mjs): `KITS[theme]` sets lamps, window colours, poles, shop signs, antennas and so on used by the shared building helpers (`ctx.kit`). `NEAR_THEMED[theme][area]` and `FAR_THEMED[theme][kind]` replace whole areas (falling back to `NEAR_AREAS` / `FAR_KINDS`). `themeSky()` tints the sky.
- **Tunnels**: scenery with `tunnel: "theme"` uses `THEMES[theme].tunnel`; other tunnels keep their style but take the theme's lamp light (`TUNNEL_LAMP`).
- **Platforms**: underground stops draw `drawStation(THEMES[theme].platform, ...)`; above-ground stops draw `drawPlatformAbove(theme, ...)` (a canopy and platform from `PLATFORM_STYLES[theme]`, transparent where the skyline of the stretch shows through).
- **Ride window**: the overlay root gets `theme-<key>`; transit.css styles the HUD and the `.kgt-tint` wash over the car (masked to the interior art) per theme.
- **Map icons**: `THEMES[theme].icon` picks a look in `ICON_LOOKS` (station-layer.mjs): rounded square, enamel plate, shield, hexagon.
- **Editor**: `glyph` is the theme's Font Awesome icon.

A platform set to **auto** is underground when a tunnel segment on the trip reaches it, above ground otherwise.

## Real cities (KG Cities)

**Contract with KG Cities.** A city scene describes itself through `game.modules.get("kg-cities").api.sceneInfo(scene)` if KG Cities offers it, otherwise the scene flag `flags["kg-cities"]` (read by `readCityInfo`, cities.mjs):

```js
{ city: "boston",                 // id from KG Cities' data/cities/index.json
  era: "1980s" | "modern",
  year: 1986,                     // optional; 1980s defaults to 1986, modern to this year
  bounds: { north, south, west, east },  // the lat/lon box stretched exactly over scene.dimensions.sceneRect (Web Mercator)
  extent: "core" | "metro" }      // only used when bounds are missing: the pack's core or metro box
```

**Flow.** `canvasReady` calls `autoSetupCity` (city-setup.mjs): the active GM, setting `cityAuto` on, a city scene, no network flag yet. Then `cityPreset` loads `data/cities/<id>.json` and `cityNetwork(pack, info, sceneRect)` builds the network:

- uses `pack.snapshots[era]` when there is one (Boston 1980s), else the pack's modern data;
- keeps stations and lines open in `year` (`opened <= year < closed`), with `names` entries (`until` year) for period names and colours;
- projects lat/lon onto the scene and drops stations outside it; lines keep the stops left (two or more), and the stretch across a dropped stop keeps the first stretch's scenery;
- drops services that became duplicates (two branches that both stop where the branch was not built yet);
- sets fare by year, `cars.subway.sound` to the shipped loop, and `preset` (with a `note` when there is nothing to ride).

Transit is turned on only when there are lines. The editor shows the city and year, and **Reset to city network** reapplies the preset (keeping the party token).

**Building packs.** `python tools/cities/build.py [ids] [--refresh]`. For each city in `CITIES`:

1. Overpass: route relations of the listed types and networks in the metro box (`out geom`), their ways' tags, stop nodes, stop areas, stations and stop area groups. Cached in `tools/cities/cache/`.
2. Stops become stations through their stop area (or the nearest same-named station within 300 m). Stop area groups and same-named stations within 450 m merge, so transfers share a station.
3. Each route's ways are chained into one polyline; stops are located on it, and the track between two stops gives the scenery: mostly tunnel, a named bridge (`bridge` scenery), mostly viaduct (`elevated`), otherwise `downtown`, `city` or `suburb` by distance from the city centre. `scenery` overrides in `CITIES` fix known stretches.
4. Variants of a route: rush-hour/night/special variants are dropped when a base service exists; a variant whose stations are all on a kept variant is dropped; the rest become separate lines named by their own terminal (or their own name, like the S shuttles).
5. Wikidata gives opening years (official opening, else inception) through the stations' `wikidata` tags; `start_date` is the fallback.

Curation lives in `CITIES` (build.py): `systems` (route types, network regex, refs to keep or skip), `lines` (opening years, `eras` with period names/colours), `fares` (cents by year, stored in the Boston coin mapping: pp $1, gp 25c, ep 10c, sp 5c, cp 1c), `renames`, `scenery`, `eras` (network name/badge by era).

**Add a city.** Add it to `tools/cities/index.json` (copy from KG Cities), add a `CITIES` entry, run the build, check it with `tools/icons-preview.html?city=<id>` (routes drawn over the metro box) and `tools/editor-preview.html?city=<id>&era=1980s`, and run `npm test` (tests/cities.test.mjs checks every pack is consistent). For an exact period network like Boston 1986, add a snapshot (`snapshots[era] = { year, stations, lines }`, same shapes as the pack).

## How a ride flows

1. GM double-clicks a station (station-layer.mjs), and `BoardDialog` opens. The ride carries the network's `cars` overrides; the overlay picks sound and interior as network, then module setting, then built-in.
2. Board: fares are paid (fare.mjs `pay`), then `RideController.start()` (ride.mjs).
3. The ride object is written to the **world setting `activeRide`**. Its `onChange` fires on every client, which is how all clients learn of the ride, including ones that join or reload mid-ride. Ending a ride writes `{}`.
4. **Only the active GM** (`game.users.activeGM`) drives: every 250 ms it accumulates real time, advances `game.time` every 5 s, moves tokens every 1 s (`TokenTrain.step`, with Foundry's movement animation), and finishes at the trip total. Pausing the game stops it.
5. Every client's `RideOverlay` renders each animation frame from `controller.displayElapsed()` (world time, smoothed between the GM's writes) through `stateAt()` (timeline.mjs).
6. `CameraFollow` pans players' views (and the GM's while a ride token is selected).

## The ride window

- The stage is the interior art's size, **1672 x 941**, scaled to fit. The vanishing point (`STAGE_SIZE.vpX/vpY` = 836, 440) is the end door.
- Behind the interior `<img>` sits `.kgt-world`: a backdrop div, the **walls canvas** (scenery.mjs), the fog div and the rain/snow canvas (weather.mjs).
- Walls are drawn per frame in screen columns: a column at horizontal distance `dx` from the vanishing point shows the wall at depth `z = 1000 * (L / dx - 1)`. There is a **near** plane (L = 836) and, outdoors, a **far** plane (L = 2336) whose texture horizon is at eye level.
- Textures come from `scenery-art.mjs`, keyed by strings (`tunnel:<style>:<theme>`, `station:<platform style>:<name>:<color>`, `platform:<theme>:<far>:<tod>:<season>:<variant>:<sky>:<name>:<color>`, `outdoor:<theme>:<near>:<far>:<tod>:<season>:<variant>:<sky>`, parts URI-encoded), cached (14 at most) and pre-drawn after the first view.
- Near textures are **2800 x 941** and must tile side to side; they are transparent above the buildings so the far layer shows. Eye level is y = 440; windows show roughly y 0 to 490; street level is usually y 540 to 620. Far textures are **4200 x 1700** with the horizon at y 1440, stored at half resolution.
- Each car in `CARS` has its end door and door window coordinates (`door`, `win`), used to draw the **car ahead** through the door window.

## Recipes

### Add a scenery choice

1. In `scripts/catalog.mjs`, add an entry to `SCENERY`: `{ label, group, icon, near: "<area>", far: "<kind>" }` (or `tunnel: "<style>"` for a tunnel; `"theme"` follows the theme). `icon` is a Font Awesome name for the editor.
2. In `scripts/scenery-art.mjs`, add the near drawing to `NEAR_AREAS` (a function of `ctx`; use `streetOf()`, the building helpers, `tree()`, `poles()`; push windows to `ctx.windows`, lamps to `ctx.lamps`, roofs to `ctx.roofs` so night lighting and snow work). Add a far drawing to `FAR_KINDS` if none fits. Themes reuse it with their kit; add `NEAR_THEMED` versions where a theme should look different.
3. Run `npm test` (a test checks every scenery entry has layers) and look at it in `tools/preview.html` by giving a demo segment that scenery.

### Add a car (interior)

1. Make the art: **1672 x 941**, looking down the aisle at the end door, windows (including the door's) in solid chroma green.
2. Save it as `assets/<name>-interior-source.png`, add it to `tools/key-interior.py`, run the script.
3. In `catalog.mjs`, add to `CARS`: `interior` file, `door` and `win` boxes in art pixels, `mask` (or null), optional `smoke`, and new `soundSetting` / `interiorSetting` keys. Settings register themselves from `CARS` in main.mjs.
4. Point a train type at it: `KINDS.<kind>.car = "<carKey>"`.

### Add a train type

Add to `KINDS` in catalog.mjs: `{ label, kmh, dwell, car }`. It appears in the editor's Type list.

### Add a theme

1. In `themes.mjs`, add to `THEMES`: `{ label, hint, icon, glyph, platform, tunnel }`.
2. In `scenery-art.mjs`: a `KITS` entry, any `NEAR_THEMED` / `FAR_THEMED` areas, a `TUNNEL_LAMP` colour, a `PLATFORM_STYLES` entry, and, for new styles, cases in `drawTunnel()` / `drawStation()` with backdrops in `TUNNEL_BACKDROPS` / `STATION_BACKDROPS`.
3. In `station-layer.mjs`, an `ICON_LOOKS` entry if it has a new icon shape.
4. In `transit.css`, `#kg-transit-ride.theme-<key>` tint variables and `.theme-<key>` HUD rules.
5. Check it in `tools/themes-preview.html?theme=<key>` and `tools/preview.html?theme=<key>`. The world setting's choices and the editor pickers list `THEMES` automatically.

### Change how a theme draws one kind of scenery

Add or edit `NEAR_THEMED[theme][area]` (near row) or `FAR_THEMED[theme][kind]` (skyline) in scenery-art.mjs. Anything not listed there falls back to the modern drawing with the theme's kit.

### Change fares or currency

`fare.mjs` works in copper with the dnd5e rates (pp 1000, gp 100, ep 50, sp 10, cp 1). Other systems: change `COINS` and where actors' coins are read and written (`actor.system.currency` in board-dialog.mjs).

## Foundry v13 notes

- Apps use `foundry.applications.api.ApplicationV2` with `HandlebarsApplicationMixin`. Click handlers are static `actions` (with `this` as the app); the editor listens for `change` once in `_onFirstRender`.
- Scene controls: `getSceneControlButtons` receives an object keyed by control name; tools are objects with `onChange`.
- Use `foundry.utils.*` (e.g. `foundry.utils.Color`), not old globals.
- Token movement is written with `scene.updateEmbeddedDocuments("Token", updates, { animation: { duration } })`.
- The station layer is a plain `PIXI.Container` added to `canvas.interface`, not a Foundry canvas layer.

## Conventions

- Plain modern JavaScript ES modules, two-space indent, double quotes, semicolons.
- Comments explain why, at the top of functions and for non-obvious steps.
- User-facing text is plain and short. Settings and editor labels say what the thing does.
- Keep the PURE files free of Foundry and DOM calls, and add a test when you change them.
- Do not add a build step or npm dependencies without a strong reason.

## Releases

Every build is kept in `dist/`, named by version: `kg-transit v2.zip`, `kg-transit v3.zip`, `kg-transit v4.zip` for major versions, with the full number for patches (`kg-transit v4.0.1.zip`). For a new build, bump `version` in `module.json` and `package.json`, then run `python tools/package.py`. It refuses to overwrite a version that is already built; `--force` rebuilds it on purpose.

## Checking your work

```bash
npm test
```

```bash
node --check scripts/main.mjs
```

For anything visual, run the preview server and open the previews (see README, For developers). The previews stub Foundry, so they check the ride window, scenery, icons and the editor's layout, not the Board dialog, saving to scenes or Foundry hooks; test those in a Foundry world.
