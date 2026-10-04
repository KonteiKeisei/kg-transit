import { registerAirports } from "./airports.mjs";
import { BoardDialog } from "./board-dialog.mjs";
import { FlightController } from "./flight.mjs";
import { FlightDialog } from "./flight-dialog.mjs";
import { CARS } from "./catalog.mjs";
import { applyCityPreset, autoSetupCity, cityPreset, sceneCity } from "./city-setup.mjs";
import { FLAGS, MODULE_ID, SETTINGS, saveNetwork, sceneEnabled } from "./config.mjs";
import { starterNetwork } from "./demo-network.mjs";
import { NetworkEditor } from "./editor.mjs";
import { RideController } from "./ride.mjs";
import { StationLayer } from "./station-layer.mjs";
import { DEFAULT_THEME, THEMES } from "./themes.mjs";

const layer = new StationLayer();
const ride = new RideController();
const flights = new FlightController();
let editor = null;

Hooks.once("init", () => {
  const register = (key, data) => game.settings.register(MODULE_ID, key, data);
  register(SETTINGS.theme, {
    name: "Default theme",
    hint: "How stations, tunnels and scenery look everywhere, unless a scene, line or stop picks its own theme in the network editor.",
    scope: "world", config: true, type: String, default: DEFAULT_THEME,
    choices: Object.fromEntries(Object.entries(THEMES).map(([key, t]) => [key, `${t.label}: ${t.hint}`])),
    onChange: () => {
      layer.draw();
      if (editor?.rendered) editor.render();
    }
  });
  register(SETTINGS.cityAuto, {
    name: "Set up city networks",
    hint: "On a KG Cities scene, set up that city's real rail network as it stood in the scene's era (1980s or today) the first time the scene is viewed.",
    scope: "world", config: true, type: Boolean, default: true
  });
  for (const car of Object.values(CARS)) {
    register(car.soundSetting, {
      name: `${car.label}: ride sound`, hint: "Loops through the ride in this car, fading in and out. Leave empty for silence.",
      scope: "world", config: true, type: String, filePicker: "audio", default: ""
    });
    register(car.interiorSetting, {
      name: `${car.label}: interior image`,
      hint: "Optional. Your own car interior, with transparent windows. Leave empty for the built-in art.",
      scope: "world", config: true, type: String, filePicker: "image", default: ""
    });
  }
  register(SETTINGS.loopVolume, {
    name: "Ride sound volume", scope: "client", config: true, type: Number, default: 0.8,
    range: { min: 0, max: 1, step: 0.05 }
  });
  register(SETTINGS.terminalVolume, {
    name: "Terminal ambiance volume",
    hint: "The airport terminal heard around the party while their flight is on the ground (check-in, boarding, taxiing, baggage claim).",
    scope: "client", config: true, type: Number, default: 0.5,
    range: { min: 0, max: 1, step: 0.05 },
    onChange: () => flights.show.refreshSound()
  });
  register(SETTINGS.iconSize, {
    name: "Station icon size", hint: "On-screen size of the station icons, in pixels.",
    scope: "client", config: true, type: Number, default: 26, range: { min: 14, max: 48, step: 2 },
    onChange: () => layer.rescale()
  });
  register(SETTINGS.showToAll, { scope: "world", config: false, type: Boolean, default: false });
  register(SETTINGS.activeRide, {
    scope: "world", config: false, type: Object, default: {},
    onChange: (value) => ride.onRideChanged(value)
  });

  register(SETTINGS.dollarRate, {
    name: "Plane tickets: copper per dollar",
    hint: "What a dollar of the period's airfare costs, in copper pieces. 1000 makes a dollar one platinum piece, as the city fares count it (pp $1); a coast-to-coast coach ticket of 1986 ($321) is then 321 pp.",
    scope: "world", config: true, type: Number, default: 1000, range: { min: 10, max: 10000, step: 10 }
  });
  register(SETTINGS.liveryFolder, {
    name: "Plane liveries folder",
    hint: "Optional. A folder of your own airline liveries, side views nose to the left on a transparent background, named <airline>-<plane>.webp or .png (for example united-dc10.webp, twa-l1011.png). A flight uses its airline's livery when the folder has one, otherwise the white plane with its tail painted.",
    scope: "world", config: true, type: String, filePicker: "folder", default: ""
  });
  register(SETTINGS.activeFlight, {
    scope: "world", config: false, type: Object, default: {},
    onChange: (value) => flights.onChanged(value)
  });

  layer.onBoard = (originId) => {
    if (ride.ride) return ui.notifications.warn("A ride is already under way.");
    new BoardDialog({ originId, layer, ride }).render({ force: true });
  };
});

Hooks.once("ready", () => {
  ride.init();
  flights.init();
  registerAirports();
  game.modules.get(MODULE_ID).api = { ride, flights, layer, openEditor, sceneCity, cityPreset, applyCityPreset };
  if (!globalThis.CALENDARIA) ui.notifications.warn("KG Transit needs Calendaria for its clock and weather.");
});

/**
 * Turn transit on for the scene (if it isn't yet) and open its network editor. A scene that
 * has never had a network starts with its city's real network (KG Cities scenes), or else the
 * sample one, its stops ready to place.
 */
async function openEditor(scene = canvas.scene) {
  if (!scene) return;
  if (scene.getFlag(MODULE_ID, FLAGS.network) === undefined) {
    const preset = await cityPreset(scene);
    if (preset) await applyCityPreset(scene, preset);
    else await saveNetwork(scene, starterNetwork());
  }
  if (!sceneEnabled(scene)) await scene.setFlag(MODULE_ID, FLAGS.enabled, true);
  if (editor?.rendered && editor.scene === scene) return editor.bringToFront();
  editor?.close();
  editor = new NetworkEditor({ scene, layer });
  editor.render({ force: true });
}

Hooks.on("canvasReady", async () => {
  layer.draw();
  // A city scene seen for the first time gets its city's network (and draws again with it).
  if (await autoSetupCity(canvas.scene)) layer.draw();
});
// An airport clicked on a KG Cities map (the GM): book a flight from it.
Hooks.on("kgCities.airport", ({ airport, scene }) => {
  if (!game.user.isGM) return;
  if (flights.flight) return ui.notifications.warn("A flight is already in the air.");
  if (ride.ride) return ui.notifications.warn("A ride is under way.");
  new FlightDialog({ airport, scene, flights }).render({ force: true });
});

Hooks.on("canvasTearDown", () => {
  editor?.close();
  layer.destroy();
});
Hooks.on("canvasPan", () => layer.rescale());
Hooks.on("updateScene", (scene, changes) => {
  // A new grid scale changes the editor's scale warning and its estimated minutes.
  if (editor?.rendered && editor.scene === scene && "grid" in changes) editor.render();
  if (scene !== canvas.scene) return;
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) || foundry.utils.hasProperty(changes, `flags.-=${MODULE_ID}`)) layer.draw();
});

// One control in the Journal Notes tools: turns transit on for the scene and opens the editor.
Hooks.on("getSceneControlButtons", (controls) => {
  const notes = controls.notes;
  if (!notes || !game.user.isGM) return;
  notes.tools.kgTransit = {
    name: "kgTransit",
    title: "Transit network",
    icon: "fa-solid fa-train-subway",
    order: 100,
    button: true,
    onChange: () => openEditor()
  };
});
