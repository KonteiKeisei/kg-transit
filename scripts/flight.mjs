// A flight between KG Cities' cities. The GM books it (flight-dialog.mjs); it lives in a world
// setting so every client shows it (plane-show.mjs), including ones that join or reload mid-flight.
//
// The trip runs in real time by default, like a ride: the active GM's client moves the clock one
// game second per real second, times the speed the GM picks (×1 to ×60, eased in), and not while
// the game is paused. The plane on screen never speeds up; the clock and the weather do. The
// GM's skip moves the clock to the next step (or the encounter, if it comes first), nothing more.
//
// From takeoff, behind the flight, the destination city's scene is found or generated. At the
// encounter point (the GM's own scene, at a point of the trip) the party is moved there and it
// opens; Continue flight picks the trip up where it stopped. At the end the party's tokens move to
// the destination airport, that scene opens for everyone, and every view centres on the party.

import { MODULE_ID, SETTINGS, escapeHtml, formatClock, setting } from "./config.mjs";
import { formatMoney } from "./fare.mjs";
import { huddle } from "./follow.mjs";
import { AIRCRAFT, AIRLINES, ENCOUNTER_POINTS, formatMinutes, midFlight, minutesUntil, nextSkip } from "./flights.mjs";
import { PlaneShow } from "./plane-show.mjs";
import { rideWeather } from "./weather.mjs";

/** The GM's clock driver ticks this often (ms), and writes the world time at most this often. */
const TICK_MS = 250;
const COMMIT_MS = 1000;
/** How quickly a new speed is reached (per second, as a share of the gap). */
const EASE = 1.6;
/** How long everyone sees the landing before the screen clears (ms). */
const LANDED_MS = 2500;
/** View scale on arrival: the party and what is around them. */
const ARRIVAL_SCALE = 0.55;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = ({ iata, name, cities, lat, lon, terminals }) => ({ iata, name, cities, lat, lon, terminals });

/** Where the party steps out: the middle of the largest terminal, else the airport's point. */
function arrivalPoint(airport) {
  const area = (r) => Math.abs(r.reduce((s, [x0, y0], i) => { const [x1, y1] = r[(i + 1) % r.length]; return s + x0 * y1 - x1 * y0; }, 0));
  const ring = (airport.terminals ?? []).map((t) => t.rings[0]).sort((a, b) => area(b) - area(a))[0];
  if (!ring) return { lat: airport.lat, lon: airport.lon };
  return { lon: ring.reduce((s, p) => s + p[0], 0) / ring.length, lat: ring.reduce((s, p) => s + p[1], 0) / ring.length };
}

/** Wait until this client's canvas shows the scene (or a minute passes). */
function sceneShown(scene) {
  if (canvas.ready && canvas.scene?.id === scene.id) return Promise.resolve();
  return new Promise((resolve) => {
    const id = Hooks.on("canvasReady", (c) => { if (c.scene?.id === scene.id) { Hooks.off("canvasReady", id); resolve(); } });
    setTimeout(resolve, 60000);
  });
}

export class FlightController {
  constructor() {
    this.show = new PlaneShow({ setRate: (r) => this.setRate(r), skip: (to) => this.skip(to) });
    this.flight = null;
    this.focus = null;
    this.busy = false;
    this.button = null;
    this.timer = null;
    this.rate = 1;
    this.pending = 0;
    this.destination = null;
    Hooks.on("canvasReady", () => this.#focusIfHere());
  }

  init() {
    this.onChanged(setting(SETTINGS.activeFlight));
  }

  get isDriver() {
    return game.user.isGM && game.users.activeGM?.isSelf;
  }

  onChanged(flight) {
    flight = flight?.id ? flight : null;
    this.flight = flight;
    this.show.sync(flight?.phase === "encounter" ? null : flight);
    this.#continueButton(flight?.phase === "encounter" && game.user.isGM ? flight : null);
    if (flight?.focus && ["landed", "encounter"].includes(flight.phase)) {
      this.focus = { sceneId: flight.focusSceneId, x: flight.focus.x, y: flight.focus.y, until: Date.now() + 60000 };
      this.#focusIfHere();
    }
    // The active GM drives the clock while the plane is flying (also after a reload).
    if (flight?.phase === "flying" && this.isDriver) this.#drive();
    else this.#stopDriving();
  }

  /** Centre on the party once this client is on the scene they were moved to. */
  #focusIfHere() {
    const f = this.focus;
    if (!f || Date.now() > f.until || !canvas.ready || canvas.scene?.id !== f.sceneId || !Number.isFinite(f.x)) return;
    this.focus = null;
    canvas.animatePan({ x: f.x, y: f.y, scale: ARRIVAL_SCALE, duration: 1200 });
  }

  /** The GM's Continue flight button, while an encounter is on. */
  #continueButton(flight) {
    if (!flight) {
      this.button?.remove();
      this.button = null;
      return;
    }
    if (!this.button) {
      this.button = document.createElement("button");
      this.button.type = "button";
      this.button.id = "kg-transit-continue";
      this.button.addEventListener("click", () => this.continue());
      document.body.append(this.button);
    }
    this.button.innerHTML = `<i class="fa-solid fa-plane"></i> Continue flight to ${escapeHtml(flight.to.iata)}`;
  }

  /* ---------------------------------------- */
  /*  Booking and the GM's controls            */
  /* ---------------------------------------- */

  /** Book and fly (the GM, from the dialog). */
  async start({ plan, from, to, riders, waived, charged, sceneId, era, year, encounter = null }) {
    if (this.flight) return ui.notifications.warn("A flight is already under way.");
    const cities = await game.modules.get("kg-cities")?.api?.cities?.() ?? [];
    const toCity = cities.find((c) => c.id === to.cities[0]);
    const calendaria = globalThis.CALENDARIA?.api;
    const flight = {
      id: foundry.utils.randomID(), plan, phase: "flying", rate: 1,
      from: pick(from), to: { ...pick(to), cityName: toCity?.name ?? null },
      riders, era, year,
      // The world time the trip began: seconds into the trip are the clock less this.
      start: game.time.worldTime,
      // Where the party's tokens are now (they move at the encounter and at the end).
      sceneId,
      encounter: encounter && { ...encounter, minutes: minutesUntil(plan, encounter.at), done: false },
      clockWasRunning: !!calendaria?.isClockRunning?.()
    };
    if (flight.clockWasRunning) calendaria.stopClock();
    await this.#chat(this.#bookedCard(flight, waived, charged));
    if (this.isDriver) this.#prepareDestination(flight);
    await this.#save(flight);
    // The clock only runs while the game does.
    if (game.paused) game.togglePause(false, { broadcast: true });
  }

  /** The GM's speed: game seconds per real second. */
  async setRate(rate) {
    if (!game.user.isGM || this.flight?.phase !== "flying") return;
    await this.#save({ ...this.flight, rate });
  }

  /**
   * Skip to the next step of the trip (boarding, taxi, takeoff, landing, the gate, baggage
   * claim, arrival), or to the encounter when it comes first: the clock moves there, and the
   * flight screen changes scene if the step is in another one. Then the trip carries on in real time.
   */
  async skip() {
    if (!game.user.isGM || this.flight?.phase !== "flying" || this.busy) return;
    this.#run(async () => {
      this.#stopDriving();
      await this.#commit();
      let flight = this.flight;
      const next = nextSkip(flight.plan, this.#elapsed(flight), flight.encounter);
      await this.#save({ ...flight, phase: "skipping" });
      await this.#advance(next.at - this.#elapsed(flight));
      this.#rollWeatherIfDue(flight);
      await this.rolling;
      // The saved flight now carries the destination's weather, if it was rolled.
      flight = { ...flight, destWeather: this.flight?.destWeather ?? flight.destWeather, destZone: this.flight?.destZone ?? flight.destZone };
      if (next.key === "encounter") await this.#encounter(flight);
      else if (next.key === "arrival") await this.#arrive(flight);
      else await this.#save({ ...flight, phase: "flying" });
    });
  }

  /** The GM's Continue flight: the rest of the trip after an encounter, from where it stopped. */
  async continue() {
    const flight = this.flight;
    if (!flight || flight.phase !== "encounter" || !game.user.isGM) return;
    const elapsed = flight.encounter.minutes * 60;
    await this.#save({ ...flight, phase: "flying", focus: null, start: game.time.worldTime - elapsed });
    if (game.paused) game.togglePause(false, { broadcast: true });
  }

  /* ---------------------------------------- */
  /*  The clock (the active GM)                */
  /* ---------------------------------------- */

  #elapsed(flight = this.flight) {
    return game.time.worldTime - flight.start;
  }

  #drive() {
    if (this.timer) return;
    this.last = performance.now();
    this.lastCommit = this.last;
    this.pending = 0;
    this.rate = this.flight?.rate ?? 1;
    this.timer = setInterval(() => this.#tick(), TICK_MS);
  }

  #stopDriving() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /* ---------------------------------------- */
  /*  The weather at the other end             */
  /* ---------------------------------------- */

  /**
   * Halfway through the flight the weather becomes the destination's: Calendaria rolls new
   * weather for the destination scene's climate zone, and it is saved with the flight so every
   * screen shows it from then on (plane-show.mjs). Before that, the weather is the departure
   * city's. Rolled once, by the active GM; a skip past the halfway point rolls it too.
   */
  #rollWeatherIfDue(flight = this.flight) {
    if (!this.isDriver || !flight || flight.destWeather || this.rolling) return;
    if (this.#elapsed(flight) < midFlight(flight.plan)) return;
    this.rolling = (async () => {
      const api = globalThis.CALENDARIA?.api;
      if (!api?.generateWeather) return;
      const dest = await (this.destination ?? this.#prepareDestination(flight));
      // The destination scene's zone: its own, else the calendar's default ("none": no weather).
      const zoneId = dest?.getFlag?.("calendaria", "climateZoneOverride") || api.getActiveCalendar?.()?.weather?.activeZone || undefined;
      if (zoneId === "none") return;
      await api.generateWeather({ ...(zoneId ? { zoneId } : {}), randomize: true });
      const weather = rideWeather(api.getCurrentWeather?.(zoneId));
      if (this.flight?.id === flight.id) await this.#save({ ...this.flight, destWeather: weather, destZone: zoneId ?? null });
    })().catch((err) => console.warn(`${MODULE_ID} | the destination's weather`, err)).finally(() => { this.rolling = null; });
  }

  /** Write the time gathered so far. */
  async #commit() {
    const whole = Math.floor(this.pending);
    this.pending -= whole;
    if (whole > 0) await game.time.advance(whole);
  }

  async #tick() {
    const flight = this.flight;
    if (!flight || flight.phase !== "flying" || this.busy) return;
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (game.paused) return;
    // Ease into a new speed rather than lurch.
    this.rate += ((flight.rate ?? 1) - this.rate) * Math.min(1, dt * EASE);
    this.pending += dt * this.rate;
    this.#rollWeatherIfDue(flight);
    const encounter = flight.encounter && !flight.encounter.done;
    const target = (encounter ? flight.encounter.minutes : flight.plan.minutes) * 60;
    if (this.#elapsed() + this.pending >= target) {
      this.#run(async () => {
        this.#stopDriving();
        this.pending = 0;
        await this.#advance(target - this.#elapsed());
        if (encounter) await this.#encounter(flight);
        else await this.#arrive(flight);
      });
      return;
    }
    if (now - this.lastCommit >= COMMIT_MS && this.pending >= 1) {
      this.lastCommit = now;
      this.busy = true;
      try { await this.#commit(); } finally { this.busy = false; }
    }
  }

  /**
   * So many seconds go by: the clock moves straight there. No time-skip cinematic: the flight
   * screen's own fade through black is the only transition (Calendaria plays its cinematic only
   * for time moved through its own controls).
   */
  async #advance(seconds) {
    seconds = Math.round(seconds);
    if (seconds > 0) await game.time.advance(seconds);
  }

  /* ---------------------------------------- */
  /*  Encounter and arrival                    */
  /* ---------------------------------------- */

  async #run(fn) {
    if (this.busy) return;
    this.busy = true;
    try {
      await fn();
    } catch (err) {
      console.error(`${MODULE_ID} | flight`, err);
      ui.notifications.error(`The flight went wrong: ${err.message}`);
    } finally {
      this.busy = false;
    }
  }

  async #save(flight) {
    this.flight = flight;
    await game.settings.set(MODULE_ID, SETTINGS.activeFlight, flight);
  }

  /** The party into the GM's encounter scene, which opens for everyone. */
  async #encounter(flight) {
    const scene = game.scenes.get(flight.encounter.sceneId);
    let focus = null;
    flight = { ...flight, encounter: { ...flight.encounter, done: true } };
    if (scene) {
      const rect = scene.dimensions.sceneRect;
      const at = Number.isFinite(scene.initial?.x) ? { x: scene.initial.x, y: scene.initial.y } : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      focus = await this.#moveParty(flight, scene, at);
      if (scene.id !== canvas.scene?.id) {
        const shown = sceneShown(scene);
        await scene.activate();
        await shown;
      }
    }
    const point = ENCOUNTER_POINTS.find((p) => p.key === flight.encounter.at);
    await this.#save({ ...flight, phase: "encounter", sceneId: scene?.id ?? flight.sceneId, focus, focusSceneId: scene?.id ?? null });
    ui.notifications.info(`Encounter: ${point?.where ?? "on the way"}. Continue flight when it is done.`);
  }

  /** Land: the party to the destination airport, the scene for everyone, the view on them. */
  async #arrive(flight) {
    const dest = await (this.destination ?? this.#prepareDestination(flight));
    let focus = null;
    if (dest) {
      try {
        const at = game.modules.get("kg-cities")?.api?.projector(dest);
        const p = arrivalPoint(flight.to);
        if (!at) throw new Error("the destination scene has no map position");
        focus = await this.#moveParty(flight, dest, at(p.lat, p.lon));
      } catch (err) {
        console.error(`${MODULE_ID} | moving the party`, err);
        ui.notifications.warn(`The party could not be moved to ${dest.name}: ${err.message}`);
      }
      if (dest.id !== canvas.scene?.id) {
        const shown = sceneShown(dest);
        await dest.activate();
        await shown;
      }
      // A new city, new weather: rolled halfway through the flight; if it never was (the
      // clock got there some other way), Calendaria rolls it now for the scene's climate zone.
      if (!flight.destWeather && !this.flight?.destWeather) {
        try {
          await globalThis.CALENDARIA?.api?.generateWeather?.({ randomize: true });
        } catch (err) {
          console.warn(`${MODULE_ID} | weather on landing`, err);
        }
      }
    }
    await this.#save({ ...flight, phase: "landed", sceneId: dest?.id ?? flight.sceneId, focus, focusSceneId: dest?.id ?? null });
    await sleep(LANDED_MS);
    this.destination = null;
    await this.#save({});
    if (flight.clockWasRunning) globalThis.CALENDARIA?.api?.startClock?.();
    await this.#chat(`<div class="kg-transit-card kgt-flight-card"><h3><i class="fa-solid fa-plane-arrival"></i> Arrived at ${escapeHtml(flight.to.name)}</h3>
      <p>${formatClock(game.time.worldTime)}.</p></div>`);
    Hooks.callAll(`${MODULE_ID}.flightEnd`, flight, { scene: dest });
  }

  /**
   * The destination city's scene (same era) whose map covers its airport, or a new one, made
   * quietly behind the flight: the core of the city when the airport is in it, else the metro.
   */
  #prepareDestination(flight) {
    this.destination = (async () => {
      const api = game.modules.get("kg-cities")?.api;
      if (!api?.generateCity) throw new Error("KG Cities is not active");
      const cityId = flight.to.cities[0];
      const at = arrivalPoint(flight.to);
      return api.sceneCovering(cityId, { ...at, era: flight.era })
        ?? await api.generateCity(cityId, { era: flight.era, year: flight.year, area: "auto", at, view: false });
    })().catch((err) => {
      console.error(`${MODULE_ID} | destination scene`, err);
      ui.notifications.error(`${flight.to.cityName ?? flight.to.name} has no scene: ${err.message}`);
      return null;
    });
    return this.destination;
  }

  /**
   * The riders' tokens (and the party's group token, if any rider is in it) leave the scene they
   * are on and gather at a point of the next one in as tight a circle as they make, as off a
   * train: the party's group token in the middle, the rest in rings around it, spaced by the
   * tokens' own size. Riders without a token get one from their prototype. Returns the point,
   * for the view.
   */
  async #moveParty(flight, dest, centre) {
    const origin = game.scenes.get(flight.sceneId);
    const riderIds = new Set(flight.riders.map((r) => r.id));
    const tokens = (origin?.tokens ?? []).filter((t) => {
      if (riderIds.has(t.actorId)) return true;
      const members = Array.from(t.actor?.system?.members ?? []).map((m) => (m.actor ?? m)?.id);
      return t.actor?.type === "group" && members.some((id) => riderIds.has(id));
    });
    const withToken = new Set(tokens.map((t) => t.actorId));
    const size = dest.grid.size;
    const data = [];
    // The group token first, so it takes the middle.
    tokens.sort((a, b) => (b.actor?.type === "group") - (a.actor?.type === "group"));
    for (const t of tokens) {
      const obj = t.toObject();
      delete obj._id;
      data.push(obj);
    }
    for (const r of flight.riders) {
      if (withToken.has(r.id)) continue;
      const actor = game.actors.get(r.id);
      if (!actor) continue;
      const doc = (await actor.getTokenDocument()).toObject();
      delete doc._id;
      data.push(doc);
    }
    const offsets = huddle(data.length);
    const step = Math.max(...data.map((d) => Math.max(d.width ?? 1, d.height ?? 1)), 0) * size;
    data.forEach((d, i) => {
      const w = (d.width ?? 1) * size, h = (d.height ?? 1) * size;
      d.x = Math.round(centre.x + offsets[i].x * step - w / 2);
      d.y = Math.round(centre.y + offsets[i].y * step - h / 2);
    });
    if (data.length) await dest.createEmbeddedDocuments("Token", data);
    if (origin && tokens.length && origin.id !== dest.id) await origin.deleteEmbeddedDocuments("Token", tokens.map((t) => t.id));
    // From now on the party is here.
    flight.sceneId = dest.id;
    return centre;
  }

  #bookedCard(f, waived, charged) {
    const { plan } = f;
    const paid = charged.map((c) => `${escapeHtml(c.name)} ${formatMoney(c.value)}`).join(", ");
    return `<div class="kg-transit-card kgt-flight-card">
      <h3><i class="fa-solid fa-plane-departure"></i> ${escapeHtml(f.from.iata)} to ${escapeHtml(f.to.iata)}</h3>
      <p><strong>${escapeHtml(AIRLINES[plan.airline].name)} ${plan.flightNumber}</strong>, ${escapeHtml(AIRCRAFT[plan.aircraft].name)}, ${plan.miles} miles.</p>
      <p>${f.riders.map((r) => escapeHtml(r.name)).join(", ")} ${f.riders.length > 1 ? "fly" : "flies"} to ${escapeHtml(f.to.name)}: ${formatMinutes(plan.minutes)} door to door, arriving about ${formatClock(f.start + plan.minutes * 60)}.</p>
      ${paid ? `<p class="fare">Tickets: ${paid}.</p>` : ""}
      ${waived.length ? `<p class="fare">Flew free: ${waived.map(escapeHtml).join(", ")}.</p>` : ""}
    </div>`;
  }

  async #chat(content) {
    await ChatMessage.create({ content, speaker: { alias: "Air travel" } });
  }
}
