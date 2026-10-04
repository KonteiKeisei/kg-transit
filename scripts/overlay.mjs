import { CARS } from "./catalog.mjs";
import { ASSET_PATH, MODULE_ID, SETTINGS, cornerSpot, escapeHtml, formatClock, setting } from "./config.mjs";
import { tripStops } from "./network.mjs";
import { STAGE, Scenery, sceneryKey, timeOfDay, tripKeys } from "./scenery.mjs";
import { DEFAULT_THEME, isTheme } from "./themes.mjs";
import { stateAt } from "./timeline.mjs";
import { currentWeather } from "./weather.mjs";

/** How often to re-read Calendaria's weather during a ride. */
const WEATHER_POLL_MS = 2000;
const FADE_MS = 1200;
const SOUND_FADE_MS = 2500;

/**
 * The interior image for a car: the network's own (a city's car art), else the GM's from the
 * module settings, else the built-in art.
 */
function interiorFor(car, carKey, ride) {
  const custom = ride?.cars?.[carKey]?.interior || game.settings.get(MODULE_ID, car.interiorSetting);
  return { src: custom || `${ASSET_PATH}/${car.interior}`, builtIn: !custom };
}

/** The ride sound for a car: the network's own (every city network has one), else the module setting. */
function soundFor(car, carKey, ride) {
  return ride?.cars?.[carKey]?.sound || game.settings.get(MODULE_ID, car.soundSetting) || "";
}

/**
 * Everything a client shows during a ride. Viewers get the car in a window beside the canvas
 * (the expand button makes it full screen); everyone else gets a banner. The overlay only
 * reads the ride and the clock; the GM's RideController moves time.
 */
export class RideOverlay {
  constructor(controller) {
    this.controller = controller;
    this.root = null;
    this.ride = null;
    this.mode = null;
    this.frame = null;
    this.sound = null;
    this.soundCar = null;
    this.carKey = null;
    this.expanded = false;
  }

  /** Show, update or hide for the current ride (null when none). */
  sync(ride) {
    const mode = !ride ? null : this.#isViewer(ride) ? "window" : "banner";
    const tripChanged = ride && this.ride && JSON.stringify(ride.trip) !== JSON.stringify(this.ride.trip);
    this.ride = ride;
    if (mode !== this.mode || ride?.id !== this.rideId) {
      this.#teardown(!ride);
      this.mode = mode;
      this.rideId = ride?.id ?? null;
      if (mode) this.#build();
    } else if (tripChanged) {
      this.#buildStrip();
    }
  }

  #isViewer(ride) {
    if (game.user.isGM) return true;
    return ride.showToAll || ride.viewers.includes(game.user.id);
  }

  #build() {
    const root = document.createElement("section");
    root.id = "kg-transit-ride";
    root.className = `mode-${this.mode}`;
    root.style.opacity = "0";
    this.root = root;
    this.carKey = null;

    if (this.mode === "banner") {
      root.innerHTML = `<div class="kgt-banner"><span class="kgt-badge"></span><span class="kgt-banner-text"></span></div>`;
    } else {
      root.innerHTML = `
        <div class="kgt-viewport">
          <div class="kgt-stage" style="width:${STAGE.w}px;height:${STAGE.h}px">
            <img class="kgt-interior" alt="">
            <div class="kgt-stripmap"></div>
          </div>
        </div>
        <div class="kgt-hud">
          <div class="kgt-top">
            <div class="kgt-leg"><span class="kgt-badge"></span><span class="kgt-leg-label"></span></div>
            <div class="kgt-clock"><span class="kgt-time"></span><span class="kgt-eta"></span></div>
          </div>
          <div class="kgt-bottom">
            <div class="kgt-status"></div>
            <div class="kgt-line"></div>
          </div>
        </div>
        <div class="kgt-controls ${game.user.isGM ? "" : "player"}">
          ${game.user.isGM ? `
          <button type="button" data-act="skip" data-tooltip="Travel on to the next stop over 5 seconds, then ride on in real time"><i class="fa-solid fa-forward-step"></i> Skip to next stop</button>
          <button type="button" data-act="off" data-tooltip="Get off here if the train is stopped, or travel on to the next stop over 5 seconds and get off there"><i class="fa-solid fa-person-walking-arrow-right"></i> Get off next stop</button>
          <button type="button" data-act="ff" data-tooltip="Travel the rest of the way over 15 seconds"><i class="fa-solid fa-forward"></i> Arrive</button>
          <button type="button" data-act="stop" class="danger" data-tooltip="Stop the train where it is and put everyone off there, ending the ride"><i class="fa-solid fa-hand"></i> Emergency stop</button>` : ""}
          <button type="button" data-act="size" data-tooltip="Full screen or window"><i class="fa-solid fa-expand"></i></button>
        </div>`;
      const stage = root.querySelector(".kgt-stage");
      this.scenery = new Scenery(stage);
      this.interiorEl = stage.querySelector(".kgt-interior");
      for (const layer of this.scenery.sweepLayers) this.interiorEl.after(layer);
      // A wash of the theme's colour over the car itself (masked to the car art).
      this.tintEl = document.createElement("div");
      this.tintEl.className = "kgt-tint";
      this.interiorEl.after(this.tintEl);
      this.theme = null;
      root.querySelector(".kgt-controls")?.addEventListener("click", (event) => this.#onControl(event));
      this.#buildStrip();
      // Draw the whole trip's scenery in the background before it is needed.
      this.weather = currentWeather();
      this.weatherAt = performance.now();
      this.scenery.preload(tripKeys(this.ride.trip, this.#when(this.ride.start)));
    }

    document.body.append(root);
    this.resizeObserver = new ResizeObserver(() => this.#fit());
    this.resizeObserver.observe(root);
    requestAnimationFrame(() => {
      root.style.transition = `opacity ${FADE_MS}ms ease`;
      root.style.opacity = "1";
    });
    this.#fit();
    const loop = (now) => {
      this.#render(now);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  #teardown(fade) {
    cancelAnimationFrame(this.frame);
    this.frame = null;
    this.resizeObserver?.disconnect();
    this.#stopSound();
    const root = this.root;
    this.root = null;
    this.scenery = null;
    if (!root) return;
    if (!fade) return root.remove();
    root.style.transition = `opacity ${FADE_MS}ms ease`;
    root.style.opacity = "0";
    setTimeout(() => root.remove(), FADE_MS + 50);
  }

  /** Scale the art to cover the viewport (or the window), centred. */
  #fit() {
    const view = this.root?.querySelector(".kgt-viewport");
    const stage = this.root?.querySelector(".kgt-stage");
    if (!view || !stage) return;
    const { width, height } = view.getBoundingClientRect();
    const k = Math.max(width / STAGE.w, height / STAGE.h);
    stage.style.transform = `translate(${(width - STAGE.w * k) / 2}px, ${(height - STAGE.h * k) / 2}px) scale(${k})`;
  }

  /**
   * Seat the riders in the car for the line they are on: its interior, its overhead line maps
   * (subway cars), its smoke (steam), and its sound. Changes at a transfer between car types.
   */
  #setCar(carKey) {
    if (carKey === this.carKey) return;
    this.carKey = carKey;
    const car = CARS[carKey] ?? CARS.subway;
    const { src, builtIn } = interiorFor(car, carKey, this.ride);
    this.interiorEl.src = src;
    this.tintEl.style.maskImage = this.tintEl.style.webkitMaskImage = `url("${src}")`;
    const strip = this.root.querySelector(".kgt-stripmap");
    const mask = builtIn && car.mask ? `url(${ASSET_PATH}/${car.mask})` : "";
    strip.style.display = mask ? "" : "none";
    strip.style.maskImage = strip.style.webkitMaskImage = mask;
    this.scenery.setCar(this.interiorEl, car, builtIn);
    this.#startSound(car, soundFor(car, carKey, this.ride));
  }

  /** The theme of where the train is: styles the HUD and tints the car (styles/transit.css). */
  #setTheme(theme) {
    theme = isTheme(theme) ? theme : DEFAULT_THEME;
    if (theme === this.theme) return;
    if (this.theme) this.root.classList.remove(`theme-${this.theme}`);
    this.root.classList.add(`theme-${theme}`);
    this.theme = theme;
  }

  #buildStrip() {
    const strip = this.root?.querySelector(".kgt-line");
    if (!strip) return;
    const trip = this.ride.trip;
    const n = trip.segments.length;
    const transfers = new Set(trip.transfers.map((t) => t.station));
    const pct = (i) => (n ? (i / n) * 100 : 0);
    const bars = trip.segments.map((seg, i) =>
      `<span class="bar" style="left:${pct(i)}%;width:${pct(1)}%;--line:${trip.lines[seg.line].color}"></span>`).join("");
    const marks = tripStops(trip).map((id, i) => {
      const labelled = i === 0 || i === n || transfers.has(id);
      const name = escapeHtml(trip.names[id] ?? "");
      return `<span class="stop${labelled ? " key" : ""}" data-index="${i}" style="left:${pct(i)}%" data-tooltip="${name}">
        ${labelled ? `<span class="name">${name}</span>` : ""}</span>`;
    }).join("");
    strip.innerHTML = `<div class="track">${bars}${marks}<span class="train"></span></div>`;
  }

  #render(now) {
    const ride = this.ride;
    if (!ride || !this.root) return;
    // Twice a second: the window keeps left of the sidebar and above a docked camera row.
    if (this.mode === "window" && now - (this.placedAt ?? 0) > 500) {
      this.placedAt = now;
      const spot = this.expanded ? null : cornerSpot();
      Object.assign(this.root.style, spot ? { right: `${spot.right}px`, bottom: `${spot.bottom}px` } : { right: "", bottom: "" });
    }
    const trip = ride.trip;
    const elapsed = this.controller.displayElapsed(now);
    const state = stateAt(trip, elapsed);
    const seg = trip.segments[state.segmentIndex];
    const leg = trip.legs[seg.legIndex];
    const line = trip.lines[state.line];
    const worldNow = ride.start + elapsed;

    if (this.mode === "banner") {
      this.root.querySelector(".kgt-badge").style.setProperty("--line", line.color);
      this.root.querySelector(".kgt-banner-text").textContent =
        `The party is riding the ${line.name} to ${trip.names[trip.to]}, arriving ${formatClock(ride.start + trip.total)}.`;
      return;
    }

    this.#setCar(line.car);
    if (now - this.weatherAt > WEATHER_POLL_MS) {
      this.weather = currentWeather();
      this.weatherAt = now;
    }
    const when = this.#when(worldNow);
    this.scenery.setWeather(this.weather, timeOfDay(when.hour));
    this.scenery.setKey(sceneryKey(state, trip, when));
    this.#setTheme(state.phase !== "running" && state.station ? trip.platforms?.[state.station] ?? seg.theme : seg.theme);
    this.scenery.update(state.distance, state.speed, now);
    this.root.style.setProperty("--line", line.color);
    this.root.style.setProperty("--strip", line.strip);

    this.root.querySelector(".kgt-leg-label").textContent = leg.label;
    this.root.querySelector(".kgt-time").textContent = formatClock(worldNow);
    this.root.querySelector(".kgt-eta").textContent = `Arrives ${formatClock(ride.start + trip.total)}`;
    this.root.querySelector(".kgt-status").textContent = this.#status(state, trip, leg);

    const n = trip.segments.length;
    let pos = state.segmentIndex;
    if (state.phase === "running") pos += Math.min(1, (elapsed - seg.depart) / (seg.arrive - seg.depart));
    else if (state.phase === "arrived") pos = n;
    const train = this.root.querySelector(".kgt-line .train");
    if (train) train.style.left = `${(pos / n) * 100}%`;
    this.root.querySelectorAll(".kgt-line .stop").forEach((el) => {
      const i = Number(el.dataset.index);
      el.classList.toggle("passed", i <= Math.floor(pos));
      el.classList.toggle("next", !!state.nextStation && i === state.segmentIndex + 1);
    });

    // The sound dips a little whenever the train is stopped.
    if (this.sound?.ready) this.sound.sound.volume = setting(SETTINGS.loopVolume) * (0.7 + 0.3 * state.speed);
  }

  /** Hour, month and weather at a world time, for choosing scenery. */
  #when(worldTime) {
    const c = game.time.calendar?.timeToComponents?.(worldTime);
    return { hour: c?.hour ?? 12, month: c?.month ?? 6, weather: this.weather };
  }

  #status(state, trip, leg) {
    const name = (id) => trip.names[id] ?? "";
    if (state.phase === "arrived") return `${name(trip.to)}. This is the end of your trip.`;
    // While changing trains, the current segment is already the first one on the new train.
    if (state.phase === "transfer") return `${name(state.station)}. Change here for the ${leg.label}.`;
    if (state.phase === "stopped") return name(state.station);
    if (state.approach > 0.35 && state.station === state.nextStation) return `Now arriving ${name(state.nextStation)}`;
    return `Next stop: ${name(state.nextStation)}`;
  }

  #onControl(event) {
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "skip") this.controller.skipToNextStop();
    else if (act === "off") this.controller.getOffNextStop();
    else if (act === "ff") this.controller.arrive();
    else if (act === "stop") this.controller.emergencyStop();
    else if (act === "size") {
      this.expanded = !this.expanded;
      this.root.classList.toggle("expanded", this.expanded);
      this.#fit();
    }
  }

  /** Fade in the sound for this car (fading out the last car's, if it was different). */
  async #startSound(car, src) {
    const id = `${car.soundSetting}|${src}`;
    if (this.soundCar === id) return;
    this.#stopSound();
    this.soundCar = id;
    if (!src) return;
    const rideId = this.rideId;
    try {
      const sound = await foundry.audio.AudioHelper.play({ src, volume: 0, loop: true, channel: "environment" }, false);
      if (this.rideId !== rideId || !this.root || this.soundCar !== id) return sound?.stop();
      const entry = { sound, ready: false };
      this.sound = entry;
      await sound.fade(setting(SETTINGS.loopVolume), { duration: SOUND_FADE_MS, from: 0 });
      entry.ready = true;
    } catch (err) {
      console.warn(`${MODULE_ID} | ride sound failed to play`, err);
    }
  }

  #stopSound() {
    const entry = this.sound;
    this.sound = null;
    this.soundCar = null;
    if (!entry) return;
    entry.sound.fade(0, { duration: SOUND_FADE_MS }).then(() => entry.sound.stop());
  }
}
