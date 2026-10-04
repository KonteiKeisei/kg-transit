// What every client sees during a flight. The trip is five scenes, one after another:
//
//   departure terminal   curb to gate (and the wait at the gate)
//   jet bridge           boarding
//   cabin                taxiing out, the last 20 seconds the takeoff (the airport out of the windows)
//   flight               in the air: the plane from the side, the cabin in a corner window
//   cabin                the landing rollout and taxiing to the gate
//   jet bridge           off the plane
//   arrival terminal     baggage claim and leaving the airport
//
// A terminal is the airport's own: the tarmac out of its windows (by day or at dusk), the
// weather falling past them, the terminal in front. Changing scene is a fade to black, a swap
// while nothing shows (once the next scene's art has loaded) and a fade back up; steps within a
// scene change nothing on screen. The screen opens from black the same way.
//
// The scenes fill the canvas's box on screen, just above the canvas and under Foundry's
// interface, sheets and other modules' HUDs; their captions, clock, controls and status line keep
// inside the part of the screen no interface covers. In the air the cabin shows in a window of
// its own, like the subway ride window: in the corner beside the sidebar, resizable, with an
// expand button anyone can use to fill the screen and shrink it back.
//
// Sound: the terminal's ambiance in the terminals (quieter in the jet bridge); the jets idling
// in the cabin while it taxis, up to full power for the takeoff, and in the air. The GM gets the controls: speed (the clock and the weather go faster, the plane and
// the clouds never do), and a skip to the next step, which only moves the clock.

import { ASSET_PATH, MODULE_ID, SETTINGS, attachAboveCanvas, canvasRect, cornerSpot, escapeHtml, formatClock, safeArea } from "./config.mjs";
import { AIRCRAFT, AIRLINES, formatMinutes, midFlight, nextSkip } from "./flights.mjs";
import { darkness, drawLights, readLights } from "./plane-lights.mjs";
import { SkyPainter, turbulence } from "./sky.mjs";
import { WeatherLayer, currentWeather, rideWeather } from "./weather.mjs";
import { STAGE_SIZE } from "./scenery-art.mjs";
import { TAKEOFF_SECONDS, TAXI_SPEED, TaxiView, takeoffState, taxiInState } from "./taxi-view.mjs";

const FADE_MS = 900;
const SOUND_FADE_MS = 2500;
/** How often the clock, the step and the weather are read again (ms). */
const READ_MS = 500;
const WEATHER_MS = 3000;
/** The speeds the GM can pick (game seconds per real second). */
export const RATES = [1, 2, 5, 10, 30, 60];
/** The cabin's engine roar, in the air only. */
const JET_SOUND = `${ASSET_PATH}/sounds/InteriorJet.ogg`;
/** The terminal around the party while they are on the ground. */
const TERMINAL_SOUND = `${ASSET_PATH}/sounds/TerminalAmbiance.ogg`;
/** The terminal's ambiance in the jet bridge, as a share of its volume in the terminal. */
const BRIDGE_AMBIENCE = 0.4;
const art = new Map();
/** Each half of a dip to black (ms). */
const BLACK_MS = 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const images = new Map();

/** The scene of each step: "terminal" (the airport at that end), "bridge", "taxi" (the cabin) or "flight". */
const SCENE_OF = { curb: "terminal", board: "bridge", taxiOut: "taxi", air: "flight", taxiIn: "taxi", deplane: "bridge", claim: "terminal" };
const CABIN_ART = `${ASSET_PATH}/flight/cabin.webp`;
/** Planes parked at the gates out of the cabin windows. */
const GATE_PLANES = ["767", "747", "dc10", "a300"];

/** An image by address, loaded once (null when missing). */
function cachedImage(src) {
  if (!images.has(src)) images.set(src, loadImage(src));
  return images.get(src);
}

/** An airport's terminal layers: assets/terminals/<CODE>-terminal|day|dusk.webp (tools/terminal-art.py). */
const terminalArt = (code, layer) => `${ASSET_PATH}/terminals/${code}-${layer}.webp`;
/** The jet bridge, from boarding to takeoff and from landing to off the plane (one for every airport). */
const JET_BRIDGE = `${ASSET_PATH}/terminals/jetbridge.webp`;

/** Day or dusk tarmac by the hour, and how dark the night makes it. */
function tarmacLight(hour) {
  if (hour >= 7 && hour < 17) return { plate: "day", tod: "day", dim: 1 };
  const night = hour >= 20 || hour < 5;
  return { plate: "dusk", tod: night ? "night" : "dusk", dim: night ? 0.72 : 1 };
}

/** Grey skies dull the view out of the windows. */
const SKY_DIM = { clear: [1, 1], partly: [1, 1], cloudy: [0.93, 0.85], overcast: [0.86, 0.72], storm: [0.72, 0.6] };

/** An image, or null when there is none at that address. */
async function loadImage(src) {
  const img = new Image();
  img.src = src;
  return (await img.decode().then(() => true, () => false)) ? img : null;
}

const folderSetting = (key) => {
  try { return String(game.settings.get(MODULE_ID, key) ?? "").replace(/\/+$/, ""); } catch { return ""; }
};

/**
 * The side view: the airline's livery for the plane when the GM has one
 * (<livery folder>/<airline>-<aircraft>.webp, or .png), else the module's white plane
 * (assets/flight/<aircraft>.webp) with its tail in the airline's colour (painted once per plane
 * and airline).
 */
async function plateFor(aircraft, airline) {
  const key = `${aircraft}|${airline}`;
  if (art.has(key)) return art.get(key);
  const liveries = folderSetting(SETTINGS.liveryFolder);
  const livery = liveries
    ? await loadImage(`${liveries}/${airline}-${aircraft}.webp`) ?? await loadImage(`${liveries}/${airline}-${aircraft}.png`)
    : null;
  if (livery) {
    // On a canvas, so its windows and lights can be read like the module's own planes.
    const lc = document.createElement("canvas");
    lc.width = livery.naturalWidth;
    lc.height = livery.naturalHeight;
    lc.getContext("2d").drawImage(livery, 0, 0);
    lc.lights = readLights(lc, aircraft);
    art.set(key, lc);
    return lc;
  }
  const img = await loadImage(`${ASSET_PATH}/flight/${AIRCRAFT[aircraft]?.art ?? "767"}.webp`);
  if (!img) return null;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  // The fin: what stands above the fuselage's top line, aft. The top line is found at 60% of the
  // length (ahead of the tail, behind the wing).
  try {
    const data = g.getImageData(0, 0, c.width, c.height).data;
    const col = Math.round(c.width * 0.6);
    let top = 0;
    while (top < c.height && data[(top * c.width + col) * 4 + 3] < 128) top++;
    // On the trijets the third engine sits in the tail: paint only the fin above it.
    const finBottom = { l1011: 0.3, dc10: 0.31 }[aircraft];
    if (finBottom) top = Math.min(top, Math.round(c.height * finBottom));
    g.save();
    g.beginPath();
    g.rect(c.width * 0.66, 0, c.width * 0.34, Math.max(0, top - 2));
    g.clip();
    g.globalCompositeOperation = "source-atop";
    g.globalAlpha = 0.88;
    g.fillStyle = AIRLINES[airline]?.tail ?? "#24418f";
    g.fillRect(0, 0, c.width, c.height);
    // Keep the panel shading: multiply the art back in, lightly.
    g.globalCompositeOperation = "multiply";
    g.globalAlpha = 0.35;
    g.drawImage(img, 0, 0);
    g.restore();
  } catch { /* a tainted canvas: the plane stays white */ }
  // Its lights at night (lit windows, navigation lights, beacons, strobes).
  c.lights = readLights(c, aircraft);
  art.set(key, c);
  return c;
}

/** The step of the trip at so many seconds in: { step, index, left } (left: seconds to the step's end). */
function stepAt(plan, seconds) {
  let t = 0;
  for (let i = 0; i < plan.steps.length; i++) {
    t += plan.steps[i].minutes * 60;
    if (seconds < t) return { step: plan.steps[i], index: i, left: t - seconds };
  }
  return { step: plan.steps.at(-1), index: plan.steps.length - 1, left: 0 };
}

/** "14 min left", "1 h 20 min left", "under a minute left". */
function timeLeft(seconds) {
  return seconds < 60 ? "under a minute left" : `${formatMinutes(Math.ceil(seconds / 60))} left`;
}

export class PlaneShow {
  /** controls: { setRate(rate), skip() } for the GM's buttons. */
  constructor(controls = {}) {
    this.controls = controls;
    this.root = null;
    this.flight = null;
    this.frame = null;
    this.weather = null;
    this.readAt = 0;
    this.weatherAt = 0;
    this.placedFor = "";
    /** The cabin window filling the screen (each viewer's own choice, kept for the next flight). */
    this.cabinExpanded = false;
  }

  /** The weather outside, for the sky around the plane, past the cabin's portholes and the terminal's windows. */
  setWeather(weather) {
    if (weather) this.weather = weather;
    this.sky?.set({ hour: this.hour, weather: this.weather });
    this.pipSky?.set({ hour: this.hour, weather: this.weather });
    this.groundWeather?.set(this.weather ?? rideWeather(null), tarmacLight(this.hour ?? 12).tod);
    this.taxiView?.set({ hour: this.hour, weather: this.weather });
  }

  /** Show, update or end for the current flight (null when none). */
  sync(flight) {
    if (!flight) return this.#end();
    const fresh = flight.id !== this.flight?.id;
    this.flight = flight;
    if (fresh) this.#start();
    this.#caption();
    this.#controls();
    this.readAt = 0;
    // The destination's weather may have just arrived: read it now.
    this.weatherAt = 0;
    if (flight.phase === "landed") this.#land();
  }

  async #start() {
    this.#remove();
    const f = this.flight;
    const root = document.createElement("section");
    root.id = "kg-transit-flight";
    root.innerHTML = `
      <canvas class="kgt-flight-sky"></canvas>
      <div class="kgt-flight-ground"><div class="kgt-ground-stage">
        <img class="kgt-ground-tarmac" alt=""><img class="kgt-ground-tarmac" alt=""><img class="kgt-ground-terminal" alt="">
        <img class="kgt-ground-bridge" alt="">
      </div></div>
      <div class="kgt-flight-taxi"><canvas></canvas><img alt=""></div>
      <div class="kgt-flight-black" style="opacity:1"></div>
      <div class="kgt-flight-caption"></div>
      <div class="kgt-flight-clock"><span class="time"></span><span class="eta"></span></div>
      <div class="kgt-flight-controls"></div>
      <div class="kgt-flight-status"><div class="kgt-flight-step"><strong></strong><em></em></div><span></span></div>`;
    root.style.opacity = "0";
    // Over the canvas, under Foundry's interface, sheets and other modules' HUDs.
    attachAboveCanvas(root);
    this.root = root;
    this.#holdCanvas(true);
    this.placedFor = "";
    this.#place();
    this.canvas = root.querySelector(".kgt-flight-sky");
    // The cabin: a window of its own, like the subway ride window (shown in the air only).
    const cabin = document.createElement("section");
    cabin.id = "kg-transit-cabin";
    cabin.className = this.cabinExpanded ? "expanded" : "";
    cabin.innerHTML = `<canvas></canvas><img src="${ASSET_PATH}/flight/cabin.webp" alt="">
      <button type="button" data-act="size" data-tooltip="Full screen or window"><i class="fa-solid ${this.cabinExpanded ? "fa-compress" : "fa-expand"}"></i></button>`;
    document.body.append(cabin);
    cabin.querySelector('[data-act="size"]').addEventListener("click", () => this.#toggleCabin());
    this.pip = cabin;
    this.pipCanvas = cabin.querySelector("canvas");
    this.pipArt = cabin.querySelector("img");
    this.placedFor = "";
    this.#place();
    // The terminal: tarmac (two plates, to cross-fade day into dusk), weather, terminal, lightning.
    this.ground = root.querySelector(".kgt-flight-ground");
    this.groundStage = root.querySelector(".kgt-ground-stage");
    this.tarmacs = [...root.querySelectorAll(".kgt-ground-tarmac")];
    this.terminal = root.querySelector(".kgt-ground-terminal");
    this.bridge = root.querySelector(".kgt-ground-bridge");
    this.groundWeather = new WeatherLayer();
    this.terminal.before(this.groundWeather.canvas, this.groundWeather.fog);
    this.groundStage.append(this.groundWeather.flash);
    this.black = root.querySelector(".kgt-flight-black");
    // The cabin while taxiing: the airport painted behind its windows.
    this.taxiCanvas = root.querySelector(".kgt-flight-taxi canvas");
    this.taxiArt = root.querySelector(".kgt-flight-taxi img");
    this.taxiView = new TaxiView(this.taxiCanvas);
    Promise.all(GATE_PLANES.map((a) => cachedImage(`${ASSET_PATH}/flight/${a}.webp`)))
      .then((planes) => { if (this.taxiView) this.taxiView.planes = planes.filter(Boolean); });
    this.taxiStep = null;
    this.bump = 0;
    this.bumpV = 0;
    this.nextBump = 0;
    // undefined: nothing decided yet, so the first read always lifts the black.
    this.sceneAt = undefined;
    this.sceneJob = null;
    this.scene = null;
    this.groundSize = "";
    // Every scene's art, ready before it is needed.
    cachedImage(JET_BRIDGE);
    cachedImage(CABIN_ART);
    for (const code of [f.from.iata, f.to.iata]) for (const layer of ["terminal", "day", "dusk"]) cachedImage(terminalArt(code, layer));
    root.querySelector(".kgt-flight-controls").addEventListener("click", (e) => this.#onControl(e));
    this.hour = game.time.calendar?.timeToComponents?.(game.time.worldTime)?.hour ?? 12;
    this.sky = new SkyPainter(this.canvas, { drift: 1, fill: false });
    this.pipSky = new SkyPainter(this.pipCanvas, { drift: 1, fill: true });
    this.setWeather(this.weather ?? currentWeather());
    this.plate = null;
    this.platePromise = plateFor(f.plan.aircraft, f.plan.airline).then((p) => {
      if (this.flight?.id === f.id) this.plate = p;
      return p;
    });
    this.#caption();
    this.#controls();
    this.#startSound(f.id);
    // The screen fades in on black; the first read picks the scene and lifts the black once it has loaded.
    requestAnimationFrame(() => {
      root.style.transition = `opacity ${FADE_MS}ms ease`;
      root.style.opacity = "1";
    });
    this.jolt = 0;
    this.joltV = 0;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.#draw(now, dt);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  /**
   * Cover the canvas's box on screen, and keep the captions, clock, controls and status line
   * inside the part no interface covers (--safe-* insets in pixels). The cabin window sits in
   * the corner left of the sidebar and above a docked camera row (the canvas's bottom edge).
   */
  #place() {
    const root = this.root;
    if (!root) return;
    const rect = canvasRect();
    const safe = safeArea(rect);
    const key = `${rect.left},${rect.top},${rect.width},${rect.height}|${safe.top},${safe.right},${safe.bottom},${safe.left}|${this.cabinExpanded}`;
    if (key === this.placedFor) return;
    this.placedFor = key;
    Object.assign(root.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    for (const side of ["top", "right", "bottom", "left"]) root.style.setProperty(`--safe-${side}`, `${Math.round(safe[side])}px`);
    if (this.pip) {
      // Full screen, the window's own CSS fills it; in the corner, clear of the interface.
      const spot = cornerSpot();
      Object.assign(this.pip.style, this.cabinExpanded ? { right: "", bottom: "" } : { right: `${spot.right}px`, bottom: `${spot.bottom}px` });
    }
  }

  /** The cabin window full screen or back in its corner, like the subway ride window. */
  #toggleCabin() {
    this.cabinExpanded = !this.cabinExpanded;
    this.pip?.classList.toggle("expanded", this.cabinExpanded);
    this.#place();
    const icon = this.pip?.querySelector('[data-act="size"] i');
    if (icon) icon.className = `fa-solid ${this.cabinExpanded ? "fa-compress" : "fa-expand"}`;
  }

  #caption() {
    if (!this.root || !this.flight) return;
    const { plan, from, to } = this.flight;
    this.root.querySelector(".kgt-flight-caption").innerHTML =
      `<i class="fa-solid fa-plane"></i> ${escapeHtml(AIRLINES[plan.airline].name)} ${plan.flightNumber}
       <span>${escapeHtml(from.iata)} to ${escapeHtml(to.iata)}, ${escapeHtml(AIRCRAFT[plan.aircraft].name)}</span>`;
  }

  /** The GM's buttons: speed, and a skip to the next step (or the encounter, when it comes first). */
  #controls() {
    const box = this.root?.querySelector(".kgt-flight-controls");
    if (!box) return;
    const f = this.flight;
    if (!game.user.isGM || !f || f.phase !== "flying") {
      box.innerHTML = "";
      this.controlsFor = null;
      return;
    }
    const rate = f.rate ?? 1;
    const next = nextSkip(f.plan, Math.max(0, game.time.worldTime - (f.start ?? game.time.worldTime)), f.encounter);
    // Redrawn only when something on it changes (read() asks twice a second).
    const state = `${rate}|${next.key}|${next.at}`;
    if (state === this.controlsFor) return;
    this.controlsFor = state;
    box.innerHTML = `
      <span class="rates" data-tooltip="How fast the clock (and the weather) runs. The plane does not speed up.">
        ${RATES.map((r) => `<button type="button" data-rate="${r}" class="${r === rate ? "active" : ""}">&times;${r}</button>`).join("")}
      </span>
      <button type="button" data-skip="next" data-tooltip="Move the clock to it">
        <i class="fa-solid fa-forward-step"></i> Skip to ${escapeHtml(next.label)}
      </button>`;
  }

  #onControl(event) {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.rate) this.controls.setRate?.(Number(b.dataset.rate));
    else if (b.dataset.skip) this.controls.skip?.();
  }

  /** Twice a second: the hour (the sky follows it), the clock, where the trip is, and the screen's place. */
  #read(now) {
    const f = this.flight;
    if (!f || !this.root) return;
    this.#place();
    const world = game.time.worldTime;
    const parts = game.time.calendar?.timeToComponents?.(world);
    const hour = parts?.hour ?? 12;
    // How dark it is, for the plane's lights (eased through dusk and dawn).
    this.dark = darkness(hour, parts?.minute ?? 0);
    if (hour !== this.hour) { this.hour = hour; this.setWeather(); }
    const total = f.plan.minutes * 60;
    const elapsed = Math.max(0, Math.min(total, world - (f.start ?? world)));
    // The departure city's weather until halfway through the flight, the destination's after
    // (rolled by the GM's client then, and saved with the flight).
    if (now - this.weatherAt > WEATHER_MS) {
      this.weatherAt = now;
      this.setWeather(f.destWeather && elapsed >= midFlight(f.plan) ? f.destWeather : currentWeather());
    }
    const { step, left } = stepAt(f.plan, elapsed);
    // Where the taxiing is, for the takeoff and the rollout between reads.
    this.taxiStep = { key: step.key, left, total: step.minutes * 60, rate: f.rate ?? 1, at: now, running: f.phase === "flying" && !game.paused };
    this.root.querySelector(".kgt-flight-clock .time").textContent = formatClock(world);
    this.root.querySelector(".kgt-flight-clock .eta").textContent =
      `${f.phase === "landed" ? "Arrived" : `Arrives ${formatClock((f.start ?? world) + total)}`}${(f.rate ?? 1) > 1 ? `, ×${f.rate}` : ""}`;
    const status = this.root.querySelector(".kgt-flight-status");
    if (f.phase === "landed") {
      status.querySelector("strong").textContent = `Welcome to ${f.to.cityName ?? f.to.name}`;
      status.querySelector("em").textContent = "";
      status.querySelector("span").textContent = "";
    } else {
      // The step, how long it has left (it counts down at the GM's speed), and what it is.
      status.querySelector("strong").textContent = step.label;
      status.querySelector("em").textContent = timeLeft(left);
      status.querySelector("span").textContent = step.detail ?? "";
    }
    // The skip button names the step after this one.
    this.#controls();
    // The scene of the step: the terminal at that end, the jet bridge, or the flight. After
    // landing (and once the trip is over), the arrival terminal.
    const kind = f.phase === "landed" ? "terminal" : SCENE_OF[step.key] ?? "flight";
    const code = step.where === "origin" && f.phase !== "landed" ? f.from.iata : f.to.iata;
    this.#setScene(kind === "terminal" ? `terminal:${code}` : kind);
  }

  /**
   * Change scene: "terminal:<CODE>", "bridge", "taxi" or "flight". Changes queue up and run one at a time
   * (#changeScene), so a fade is never cut short; asking for the scene already showing does nothing.
   */
  #setScene(scene) {
    const light = tarmacLight(this.hour ?? 12);
    // The weather and the night dim the view outside the terminal.
    const [bright, sat] = SKY_DIM[this.weather?.sky] ?? SKY_DIM.clear;
    for (const img of this.tarmacs) img.style.filter = `brightness(${(bright * light.dim).toFixed(2)}) saturate(${sat})`;
    // A terminal's key includes its light, so dusk falling at the gate cross-fades the view.
    const key = scene.startsWith("terminal:") ? `${scene}|${light.plate}` : scene;
    if (key === this.sceneAt) return;
    this.sceneAt = key;
    this.sceneJob = (this.sceneJob ?? Promise.resolve())
      .then(() => this.#changeScene(scene, light.plate, key))
      .catch((err) => console.warn(`${MODULE_ID} | flight screen`, err));
  }

  async #changeScene(scene, plate, key) {
    const root = this.root;
    if (!root || this.sceneAt !== key) return;
    // Everything the next scene needs, loaded before anything changes on screen.
    let terminal = null, tarmac = null, bridge = null, cabin = null;
    if (scene.startsWith("terminal:")) {
      const code = scene.slice(9);
      [terminal, tarmac] = await Promise.all([cachedImage(terminalArt(code, "terminal")), cachedImage(terminalArt(code, plate))]);
      // An airport without art: the jet bridge stands in for its terminal.
      if (!terminal || !tarmac) scene = "bridge";
    }
    if (scene === "bridge") {
      bridge = await cachedImage(JET_BRIDGE);
      if (!bridge) scene = "flight";
    }
    if (scene === "taxi") {
      cabin = await cachedImage(CABIN_ART);
      if (!cabin) scene = "flight";
    }
    if (scene === "flight") await this.platePromise;
    if (this.root !== root || this.sceneAt !== key) return;
    if (scene === this.scene && scene.startsWith("terminal:")) {
      // Dusk falling at the same airport: both plates are loaded, so the view cross-fades.
      this.#showTarmac(tarmac.src, true);
    } else if (scene !== this.scene) {
      // A new scene: fade to black, swap while nothing shows, fade back up.
      await this.#toBlack(1);
      if (this.root !== root || this.sceneAt !== key) return;
      if (terminal) {
        this.terminal.src = terminal.src;
        this.#showTarmac(tarmac.src, false);
      }
      if (bridge) this.bridge.src = bridge.src;
      if (cabin) this.taxiArt.src = cabin.src;
      this.scene = scene;
      root.classList.toggle("on-ground", scene !== "flight" && scene !== "taxi");
      root.classList.toggle("in-bridge", scene === "bridge");
      root.classList.toggle("in-taxi", scene === "taxi");
      // The cabin window in the air only.
      this.pip?.classList.toggle("shown", scene === "flight");
      this.#mixSound();
      // Decoded and painted before the black lifts.
      const shown = bridge ? [this.bridge] : cabin ? [this.taxiArt] : terminal ? [this.terminal, ...this.tarmacs] : [];
      await Promise.all(shown.filter((img) => img.getAttribute("src")).map((img) => img.decode().catch(() => {})));
      await nextFrame();
      if (this.root !== root || this.sceneAt !== key) return;
    }
    await this.#toBlack(0);
  }

  /** Show a tarmac plate: cross-faded from the one showing, or cut straight to it (under black). */
  #showTarmac(src, fade) {
    const [shown, next] = this.tarmacs[0].classList.contains("on") ? this.tarmacs : [this.tarmacs[1], this.tarmacs[0]];
    if (shown.getAttribute("src") === src && shown.classList.contains("on")) return;
    if (!fade) this.ground.classList.add("cut");
    next.src = src;
    next.classList.add("on");
    shown.classList.remove("on");
    if (!fade) {
      void this.ground.offsetWidth;
      this.ground.classList.remove("cut");
    }
  }

  /** Fade the black over the screen in (1) or out (0); resolves when the fade is done. */
  #toBlack(level) {
    const black = this.black;
    if (!black || Math.abs((Number(black.style.opacity) || 0) - level) < 0.01) return Promise.resolve();
    black.style.opacity = String(level);
    return sleep(BLACK_MS);
  }

  /** The terminal's 16:9 stage covers the screen, centred, like the ride window. */
  #fitGround(w, h) {
    const size = `${w}x${h}`;
    if (size === this.groundSize) return;
    this.groundSize = size;
    const k = Math.max(w / STAGE_SIZE.w, h / STAGE_SIZE.h);
    this.groundStage.style.transform = `translate(${(w - STAGE_SIZE.w * k) / 2}px, ${(h - STAGE_SIZE.h * k) / 2}px) scale(${k})`;
  }

  #draw(now, dt) {
    const canvas = this.canvas;
    if (!canvas) return;
    if (now - this.readAt > READ_MS) { this.readAt = now; this.#read(now); }
    const w = Math.round(this.root.clientWidth), h = Math.round(this.root.clientHeight);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    this.#fitGround(w, h);
    if (this.scene === "taxi") return this.#drawTaxi(now, dt, w, h);
    const onGround = this.scene && this.scene !== "flight";
    // Rain and snow past the terminal windows: the plane is parked, so it falls straight.
    if (onGround && this.scene !== "bridge") this.groundWeather.update(now, dt, 0, 1);
    // Nothing of the flight to draw on the ground: the terminals and the jet bridge are still.
    if (onGround) return;
    const g = canvas.getContext("2d");
    this.sky.draw(now, dt, 1);
    // The sky goes behind what the painter drew (clouds and weather).
    g.save();
    g.globalCompositeOperation = "destination-over";
    const grad = g.createLinearGradient(0, 0, 0, h);
    const p = this.sky.palette();
    grad.addColorStop(0, p[0]);
    grad.addColorStop(1, p[1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.restore();

    // The plane: a slow swell, then jolts as rough as the weather, kept gentle. Never faster than life.
    const plate = this.plate;
    if (!plate) return;
    const rough = turbulence(this.weather);
    if (Math.random() < dt * (0.2 + 1.4 * rough)) this.joltV += (Math.random() - 0.5) * 420 * rough;
    this.joltV += (-this.jolt * 40 - this.joltV * 7) * dt;
    this.jolt += this.joltV * dt;
    const pw = Math.min(w * 0.62, 1100), ph = (pw * plate.height) / plate.width;
    const cx = w * 0.5, cy = h * 0.52;
    const swell = Math.sin(now / 1400) * (4 + 5 * rough) + Math.sin(now / 530) * 1 * rough;
    const pitch = (Math.sin(now / 2100) * (0.4 + 0.7 * rough) + this.jolt * 0.025) * (Math.PI / 180);
    g.save();
    g.translate(cx, cy + swell + this.jolt);
    g.rotate(pitch);
    // At night the plane is in shadow and its lights are on.
    const dark = this.dark ?? 0;
    if (dark > 0.01) g.filter = `brightness(${(1 - 0.62 * dark).toFixed(3)}) saturate(${(1 - 0.35 * dark).toFixed(3)})`;
    g.drawImage(plate, -pw / 2, -ph / 2, pw, ph);
    g.filter = "none";
    drawLights(g, plate.lights, plate, pw, ph, dark, now);
    g.restore();

    // The cabin, its portholes on the same sky, shaken by the same jolts.
    const pc = this.pipCanvas;
    if (pc) {
      const bw = Math.round(this.pip.clientWidth), bh = Math.round(this.pip.clientHeight);
      if (pc.width !== bw || pc.height !== bh) { pc.width = bw; pc.height = bh; }
      this.pipSky.draw(now, dt, 0.35);
      const shake = (swell * 0.1 + this.jolt * 0.2) * (bw / 400);
      this.pipArt.style.transform = `translateY(${shake.toFixed(2)}px) rotate(${(pitch * 0.4).toFixed(4)}rad) scale(1.04)`;
    }
  }

  /** How the plane moves while taxiing: the takeoff at the end of taxiing out, the rollout at the start of taxiing in. */
  #taxiState(now) {
    const s = this.taxiStep;
    if (!s || (s.key !== "taxiOut" && s.key !== "taxiIn")) return takeoffState(-1);
    // The step's seconds left now, counted on from the last read at the GM's speed.
    const left = Math.max(0, s.left - (s.running ? ((now - s.at) / 1000) * s.rate : 0));
    // In real seconds, so the takeoff lasts its 20 seconds whatever the speed.
    if (s.key === "taxiOut") return takeoffState(TAKEOFF_SECONDS - left / s.rate);
    return taxiInState((s.total - left) / s.rate, left / s.rate);
  }

  /** The cabin full screen, the airport going by outside; bumps on the taxiway, the rumble of the takeoff roll. */
  #drawTaxi(now, dt, w, h) {
    const c = this.taxiCanvas;
    if (!c || !this.taxiView) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const state = this.#taxiState(now);
    this.taxiView.draw(now, dt, state);
    // A bump at each joint in the taxiway; rattling once the plane is fast; smooth once it flies.
    const ground = 1 - Math.min(1, state.climb * 6);
    if (now > this.nextBump && ground > 0) {
      this.bumpV -= (60 + 160 * Math.min(1, state.speed / 40)) * ground;
      this.nextBump = now + Math.max(90, 1300 / Math.max(1, state.speed / TAXI_SPEED));
    }
    this.bumpV += (-this.bump * 180 - this.bumpV * 14) * dt;
    this.bump += this.bumpV * dt;
    const rattle = ground * Math.min(1, state.speed / 70) * (Math.random() - 0.5) * 2.4;
    const k = h / 1000;
    this.taxiArt.style.transform = `translateY(${((this.bump + rattle) * k).toFixed(2)}px) scale(1.03)`;
    // The cabin lights are turned down for a takeoff or landing after dark.
    const dim = this.dark ?? 0;
    this.taxiArt.style.filter = dim > 0.01 ? `brightness(${(1 - 0.45 * dim).toFixed(3)}) saturate(${(1 - 0.2 * dim).toFixed(3)})` : "";
    // The engines: idling, spooling up for the takeoff.
    if (now - (this.powerAt ?? 0) > 400) {
      this.powerAt = now;
      const level = (this.volume ?? 0.8) * state.power;
      if (Math.abs(level - (this.jetLevel ?? -1)) > 0.02) {
        this.jetLevel = level;
        this.sound?.fade?.(level, { duration: 450 });
      }
    }
  }

  #land() {
    if (this.landing || !this.root) return;
    this.landing = true;
    setTimeout(() => this.#end(), 2200);
  }

  /** Two loops, faded in and out by scene (#mixSound): the jets and the terminal. */
  async #startSound(flightId) {
    const audio = globalThis.foundry?.audio?.AudioHelper;
    if (!audio) return;
    this.volume = Number(game.settings.get(MODULE_ID, SETTINGS.loopVolume)) || 0.8;
    const play = async (src) => {
      try {
        return await audio.play({ src, volume: 0, loop: true, channel: "environment" }, false);
      } catch (err) {
        console.warn(`${MODULE_ID} | flight sound failed to play: ${src}`, err);
        return null;
      }
    };
    const [jet, terminal] = await Promise.all([play(JET_SOUND), play(TERMINAL_SOUND)]);
    if (this.flight?.id !== flightId) return [jet, terminal].forEach((s) => s?.stop());
    this.sound = jet;
    this.ambience = terminal;
    this.#mixSound();
  }

  /**
   * Each loop at its level for the scene: the jets in the air only (at the ride sound volume),
   * the terminal's ambiance in the terminals (Terminal ambiance volume, 50% unless a player
   * changes it), quieter in the jet bridge.
   */
  #mixSound() {
    const v = this.volume ?? 0.8;
    let ambience = 0.5;
    try { ambience = Number(game.settings.get(MODULE_ID, SETTINGS.terminalVolume)); } catch { /* not registered (previews) */ }
    if (!Number.isFinite(ambience)) ambience = 0.5;
    const scene = this.scene ?? "";
    // Taxiing, the engines follow the plane (#drawTaxi); they start at idle.
    const jets = scene === "flight" ? v : scene === "taxi" ? v * 0.25 : 0;
    this.jetLevel = jets;
    const terminal = scene.startsWith("terminal:") ? ambience : scene === "bridge" ? ambience * BRIDGE_AMBIENCE : 0;
    this.sound?.fade?.(jets, { duration: SOUND_FADE_MS });
    this.ambience?.fade?.(terminal, { duration: SOUND_FADE_MS });
  }

  /** A volume setting changed: the loops follow straight away. */
  refreshSound() {
    this.volume = Number(game.settings.get(MODULE_ID, SETTINGS.loopVolume)) || 0.8;
    this.#mixSound();
  }

  #stopSound() {
    for (const sound of [this.sound, this.ambience]) sound?.fade(0, { duration: SOUND_FADE_MS }).then(() => sound.stop());
    this.sound = null;
    this.ambience = null;
  }

  #end() {
    this.#stopSound();
    this.flight = null;
    this.landing = false;
    this.weather = null;
    const root = this.root;
    if (!root) return;
    root.style.transition = `opacity ${FADE_MS}ms ease`;
    root.style.opacity = "0";
    this.pip?.classList.remove("shown");
    setTimeout(() => this.#remove(root), FADE_MS + 50);
  }

  #remove(root = this.root) {
    if (root === this.root) {
      this.pip?.remove();
      this.pip = null;
      cancelAnimationFrame(this.frame);
      this.frame = null;
      this.root = null;
      this.canvas = null;
      this.pipCanvas = null;
      this.taxiView = null;
      this.taxiCanvas = null;
      this.#holdCanvas(false);
    }
    root?.remove();
  }

  /**
   * While the flight is on screen the scene under it is out of reach: the cover takes the clicks
   * and the wheel, and the canvas stops reacting to the pointer (PIXI hears pointer moves from the
   * whole page, so hovers such as KG Cities' landmark cards would still fire through the cover).
   * A scene drawn meanwhile (the destination) is held too; the canvas is given back at the end.
   */
  #holdCanvas(on) {
    document.body.classList.toggle("kgt-flying", on);
    if (on) {
      this.root?.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
      this.root?.addEventListener("contextmenu", (event) => event.preventDefault());
      const hold = () => {
        const stage = globalThis.canvas?.stage;
        if (!stage || stage.eventMode === "none") return;
        this.stageMode = stage.eventMode;
        stage.eventMode = "none";
      };
      hold();
      this.holdHook ??= globalThis.Hooks?.on("canvasReady", hold);
    } else {
      if (this.holdHook) Hooks.off("canvasReady", this.holdHook);
      this.holdHook = null;
      if (this.stageMode && globalThis.canvas?.stage) globalThis.canvas.stage.eventMode = this.stageMode;
      this.stageMode = null;
    }
  }
}
