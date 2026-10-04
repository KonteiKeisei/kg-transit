// What every client sees during a flight: the plane from the side, nose to the left, buffeted by
// the weather, the cabin in a corner window, the clock and where the trip is. It covers the
// canvas but not the sidebar, so the table can talk all the way. A skip plays Calendaria's
// time-skip cinematic full screen with the plane over it; its sky and date show through.
// The GM gets the controls: speed (the clock and the weather go faster, the plane and the
// clouds never do), and a skip to the next step (Skip to boarding, to taxi, to takeoff, to
// landing...), or to the encounter when it comes first.
//
// On the ground (curb to takeoff, and landing to the baggage carousel) the screen is the
// airport's terminal instead, full screen and without the cabin window: the tarmac out of its
// windows (by day or at dusk), the weather falling past them, the terminal in front. Changing
// between the terminal and the flight always goes through black: fade to black, swap while
// nothing shows (and only once the next view's art has loaded), fade back up. The screen opens
// from black the same way, so no half-loaded view is ever seen.

import { ASSET_PATH, MODULE_ID, SETTINGS, escapeHtml, formatClock } from "./config.mjs";
import { AIRCRAFT, AIRLINES, formatMinutes, midFlight, nextSkip } from "./flights.mjs";
import { darkness, drawLights, readLights } from "./plane-lights.mjs";
import { SkyPainter, turbulence } from "./sky.mjs";
import { WeatherLayer, currentWeather, rideWeather } from "./weather.mjs";
import { STAGE_SIZE } from "./scenery-art.mjs";

const FADE_MS = 900;
const SOUND_FADE_MS = 2500;
/** How often the clock, the step and the weather are read again (ms). */
const READ_MS = 1000;
const WEATHER_MS = 3000;
/** The speeds the GM can pick (game seconds per real second). */
export const RATES = [1, 2, 5, 10, 30, 60];
/** The cabin's engine roar, looped through the flight. */
const JET_SOUND = `${ASSET_PATH}/sounds/InteriorJet.ogg`;
/** The terminal around the party while they are on the ground. */
const TERMINAL_SOUND = `${ASSET_PATH}/sounds/TerminalAmbiance.ogg`;
const art = new Map();
/** The jet sound while on the ground: the engines heard through the terminal glass. */
const GROUND_VOLUME = 0.3;
/** Each half of a dip to black (ms). */
const BLACK_MS = 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const images = new Map();

/** An image by address, loaded once (null when missing). */
function cachedImage(src) {
  if (!images.has(src)) images.set(src, loadImage(src));
  return images.get(src);
}

/** An airport's terminal layers: assets/terminals/<CODE>-terminal|day|dusk.webp (tools/terminal-art.py). */
const terminalArt = (code, layer) => `${ASSET_PATH}/terminals/${code}-${layer}.webp`;
/** The jet bridge, walked while boarding and getting off (one for every airport). */
const JET_BRIDGE = `${ASSET_PATH}/terminals/jetbridge.webp`;
/** The steps spent in the jet bridge rather than the terminal. */
const BRIDGE_STEPS = new Set(["board", "deplane"]);

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
  /** controls: { setRate(rate), skip("encounter" | "landing") } for the GM's buttons. */
  constructor(controls = {}) {
    this.controls = controls;
    this.root = null;
    this.flight = null;
    this.frame = null;
    this.weather = null;
    this.ownSky = 1;
    this.readAt = 0;
    this.weatherAt = 0;
    Hooks.on("calendaria.cinematicStart", (payload) => {
      const id = payload?.keyframes?.find((k) => k.weather)?.weather?.id;
      if (id) this.setWeather(rideWeather(id));
    });
  }

  /** The weather outside, for the sky around the plane and past the cabin's portholes. */
  setWeather(weather) {
    if (weather) this.weather = weather;
    this.sky?.set({ hour: this.hour, weather: this.weather });
    this.pipSky?.set({ hour: this.hour, weather: this.weather });
    this.groundWeather?.set(this.weather ?? rideWeather(null), tarmacLight(this.hour ?? 12).tod);
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
      <div class="kgt-flight-black" style="opacity:1"></div>
      <div class="kgt-flight-caption"></div>
      <div class="kgt-flight-clock"><span class="time"></span><span class="eta"></span></div>
      <div class="kgt-flight-controls"></div>
      <div class="kgt-flight-status"><div class="kgt-flight-step"><strong></strong><em></em></div><span></span></div>
      <div class="kgt-flight-pip"><canvas></canvas><img src="${ASSET_PATH}/flight/cabin.webp" alt=""></div>`;
    root.style.opacity = "0";
    document.body.append(root);
    this.root = root;
    this.canvas = root.querySelector(".kgt-flight-sky");
    this.pip = root.querySelector(".kgt-flight-pip");
    this.pipCanvas = this.pip.querySelector("canvas");
    this.pipArt = this.pip.querySelector("img");
    // The terminal: tarmac (two plates, to cross-fade day into dusk), weather, terminal, lightning.
    this.ground = root.querySelector(".kgt-flight-ground");
    this.groundStage = root.querySelector(".kgt-ground-stage");
    this.tarmacs = [...root.querySelectorAll(".kgt-ground-tarmac")];
    this.terminal = root.querySelector(".kgt-ground-terminal");
    this.groundWeather = new WeatherLayer();
    this.terminal.before(this.groundWeather.canvas, this.groundWeather.fog);
    this.groundStage.append(this.groundWeather.flash);
    this.black = root.querySelector(".kgt-flight-black");
    // undefined: nothing decided yet, so the first read always lifts the black.
    this.groundAt = undefined;
    this.groundJob = null;
    this.groundOn = false;
    this.groundCode = null;
    this.groundSize = "";
    this.bridge = root.querySelector(".kgt-ground-bridge");
    cachedImage(JET_BRIDGE);
    // Every layer of both airports, ready before they are needed.
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
    // The screen fades in on black; the first read picks the view and lifts the black once it has loaded.
    requestAnimationFrame(() => {
      root.style.transition = `opacity ${FADE_MS}ms ease, right 600ms ease`;
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
    // Redrawn only when something on it changes (read() asks every second).
    const state = `${rate}|${next.key}|${next.at}`;
    if (state === this.controlsFor) return;
    this.controlsFor = state;
    box.innerHTML = `
      <span class="rates" data-tooltip="How fast the clock (and the weather) runs. The plane does not speed up.">
        ${RATES.map((r) => `<button type="button" data-rate="${r}" class="${r === rate ? "active" : ""}">&times;${r}</button>`).join("")}
      </span>
      <button type="button" data-skip="next" data-tooltip="Jump the clock to it, with Calendaria's time-skip">
        <i class="fa-solid fa-forward-step"></i> Skip to ${escapeHtml(next.label)}
      </button>`;
  }

  #onControl(event) {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.rate) this.controls.setRate?.(Number(b.dataset.rate));
    else if (b.dataset.skip) this.controls.skip?.();
  }

  /** Once a second: the hour (the sky follows it), the clock, where the trip is, the room left for the sidebar. */
  #read(now) {
    const f = this.flight;
    if (!f || !this.root) return;
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
    if (now - this.weatherAt > WEATHER_MS && !this.cinematic) {
      this.weatherAt = now;
      this.setWeather(f.destWeather && elapsed >= midFlight(f.plan) ? f.destWeather : currentWeather());
    }
    const { step, left } = stepAt(f.plan, elapsed);
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
    // On the ground at one end or the other: that airport's terminal, or the jet bridge while
    // boarding and getting off (not while a skip's cinematic plays).
    const where = f.phase === "landed" ? "destination" : step.where;
    const bridge = f.phase !== "landed" && BRIDGE_STEPS.has(step.key);
    this.#setGround(this.cinematic || where === "air" ? null : bridge ? "bridge" : (where === "origin" ? f.from.iata : f.to.iata));
    // Beside the sidebar, so the chat stays in reach; full screen while the cinematic plays.
    const sidebar = document.getElementById("sidebar");
    this.root.style.right = this.cinematic ? "0px" : `${Math.round(sidebar?.getBoundingClientRect().width ?? 0)}px`;
  }

  /**
   * The terminal of an airport (its code), the jet bridge ("bridge"), or the flight (null).
   * Changes queue up and run one at a time (#changeGround), so a fade is never cut short.
   */
  #setGround(code) {
    const light = tarmacLight(this.hour ?? 12);
    // The weather and the night dim the view outside.
    const [bright, sat] = SKY_DIM[this.weather?.sky] ?? SKY_DIM.clear;
    for (const img of this.tarmacs) img.style.filter = `brightness(${(bright * light.dim).toFixed(2)}) saturate(${sat})`;
    const key = code === "bridge" ? "bridge" : code ? `${code}|${light.plate}` : null;
    if (key === this.groundAt) return;
    this.groundAt = key;
    this.groundJob = (this.groundJob ?? Promise.resolve())
      .then(() => this.#changeGround(code, light.plate, key))
      .catch((err) => console.warn(`${MODULE_ID} | flight screen`, err));
  }

  async #changeGround(code, plate, key) {
    const root = this.root;
    if (!root || this.groundAt !== key) return;
    // Everything the next view needs, loaded before anything changes on screen.
    let terminal = null, tarmac = null, bridge = null;
    if (code === "bridge") {
      bridge = await cachedImage(JET_BRIDGE);
      if (!bridge) code = null;
    } else if (code) {
      [terminal, tarmac] = await Promise.all([cachedImage(terminalArt(code, "terminal")), cachedImage(terminalArt(code, plate))]);
      // An airport without art: the flight stays on screen.
      if (!terminal || !tarmac) code = null;
    }
    if (!code) await this.platePromise;
    if (this.root !== root || this.groundAt !== key) return;
    const on = !!code;
    if (on && this.groundOn && this.groundCode === code) {
      // Day turning to dusk at the same airport: both plates are loaded, so the view cross-fades.
      this.#showTarmac(tarmac.src, true);
    } else if (on || this.groundOn) {
      // Terminal, jet bridge, flight: every change goes through black.
      await this.#toBlack(1);
      if (this.root !== root || this.groundAt !== key) return;
      if (bridge) this.bridge.src = bridge.src;
      else if (on) {
        this.terminal.src = terminal.src;
        this.#showTarmac(tarmac.src, false);
      }
      this.groundOn = on;
      this.groundCode = on ? code : null;
      root.classList.toggle("on-ground", on);
      root.classList.toggle("in-bridge", !!bridge);
      this.#mixSound();
      // Decoded and painted before the black lifts.
      const shown = bridge ? [this.bridge] : on ? [this.terminal, ...this.tarmacs] : [];
      await Promise.all(shown.filter((img) => img.getAttribute("src")).map((img) => img.decode().catch(() => {})));
      await nextFrame();
      if (this.root !== root || this.groundAt !== key) return;
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
    const cine = document.getElementById("calendaria-cinematic");
    this.cinematic = !!cine && Number(getComputedStyle(cine).opacity) > 0.5;
    if (now - this.readAt > READ_MS) { this.readAt = now; this.#read(now); }
    const w = Math.round(this.root.clientWidth), h = Math.round(this.root.clientHeight);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    this.#fitGround(w, h);
    // Rain and snow past the terminal windows: the plane is parked, so it falls straight.
    if (this.groundOn && this.groundCode !== "bridge") this.groundWeather.update(now, dt, 0, 1);
    // Calendaria's cinematic, while it plays, is the sky; otherwise ours.
    this.ownSky += ((this.cinematic ? 0 : 1) - this.ownSky) * Math.min(1, dt * 2.5);
    const g = canvas.getContext("2d");
    this.sky.draw(now, dt, 1);
    if (this.ownSky > 0.01) {
      // Our sky goes behind what the painter drew (clouds and weather).
      g.save();
      g.globalCompositeOperation = "destination-over";
      g.globalAlpha = this.ownSky;
      const grad = g.createLinearGradient(0, 0, 0, h);
      const p = this.sky.palette();
      grad.addColorStop(0, p[0]);
      grad.addColorStop(1, p[1]);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.restore();
    }

    // The plane: a slow swell, then jolts as rough as the weather, kept gentle. Never faster
    // than life. None of it on the ground: the terminal is still, and the plane is not shown.
    const plate = this.plate;
    if (!plate || this.groundOn) return;
    const rough = turbulence(this.weather);
    if (Math.random() < dt * (0.2 + 1.4 * rough)) this.joltV += (Math.random() - 0.5) * 420 * rough;
    this.joltV += (-this.jolt * 40 - this.joltV * 7) * dt;
    this.jolt += this.joltV * dt;
    const pw = Math.min(w * 0.62, 1100), ph = (pw * plate.height) / plate.width;
    // Under Calendaria's date (a third of the way down), above its progress bar.
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

  #land() {
    if (this.landing || !this.root) return;
    this.landing = true;
    setTimeout(() => this.#end(), 2200);
  }

  /**
   * Two loops at the ride sound's volume: the engines and the terminal. On the ground the
   * terminal is all around and the jets are heard through the glass; in the air, only the jets.
   */
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
   * Fade each loop to its level for where the party is: the jets at the ride sound volume, the
   * terminal at its own setting (Terminal ambiance volume, 50% unless a player changes it).
   */
  #mixSound() {
    const v = this.volume ?? 0.8;
    let ambience = 0.5;
    try { ambience = Number(game.settings.get(MODULE_ID, SETTINGS.terminalVolume)); } catch { /* not registered (previews) */ }
    if (!Number.isFinite(ambience)) ambience = 0.5;
    this.sound?.fade?.(v * (this.groundOn ? GROUND_VOLUME : 1), { duration: SOUND_FADE_MS });
    this.ambience?.fade?.(this.groundOn ? ambience : 0, { duration: SOUND_FADE_MS });
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
    setTimeout(() => this.#remove(root), FADE_MS + 50);
  }

  #remove(root = this.root) {
    if (root === this.root) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
      this.root = null;
      this.canvas = null;
      this.pipCanvas = null;
    }
    root?.remove();
  }
}
