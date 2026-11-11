import { MODULE_ID, SETTINGS, escapeHtml, formatClock, formatDuration, sceneNetwork, setting, stationPositions } from "./config.mjs";
import { formatMoney } from "./fare.mjs";
import { endAfterSegment, nextStop, standingAt, truncateTrip } from "./network.mjs";
import { routeShapes } from "./route-path.mjs";
import { trainPoint } from "./timeline.mjs";
import { CameraFollow, TOKEN_STEP_FAST_MS, TOKEN_STEP_MS, TokenBounce, TokenTrain } from "./follow.mjs";
import { RideOverlay } from "./overlay.mjs";

/** World time is written in batches this often while riding (seconds). */
const COMMIT_EVERY = 5;
/** How long the GM's fast travel takes (ms): to the next stop, and on to the end of the trip. */
const SKIP_MS = 5_000;
const ARRIVE_FF_MS = 15_000;
/** Clients estimate the clock between writes, but never run further ahead than this. */
const MAX_LEAD = COMMIT_EVERY + 1;

const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/**
 * KG Cities is running: several parties can ride at once, each its own ride (party rides).
 * Without it, KG Transit runs one ride at a time, as it always has.
 */
export const partyRides = () => !!globalThis.game?.modules?.get?.("kg-cities")?.active;

/**
 * Rides live in world settings, so every client (including ones that join or reload mid-ride)
 * sees the same thing: the one ride (activeRide) on its own, or with KG Cities one per party
 * (activeRides, by ride id). Only the active GM moves world time: one game second per real
 * second, paused while the game is paused, one clock for every ride. The GM can fast travel a
 * ride (ride.ff: { from, to, ms, then }): from one moment of its trip to another over `ms`, then
 * carry on in real time ("ride") or get off ("finish"); the clock runs on with it, so the other
 * rides move on too.
 *
 * Each client shows one ride at a time (its focus): a player their own party's, the GM the one
 * picked in the ride window's tabs. `this.ride` is that ride, so the window, the camera and the
 * GM's controls act on it.
 */
export class RideController {
  constructor() {
    this.rides = new Map();
    this.focusId = null;
    this.overlay = new RideOverlay(this);
    this.timer = null;
    this.pending = 0;
    this.busy = false;
    this.lastTick = 0;
    this.lastCommit = 0;
    this.worldSeenAt = performance.now();
    this.ffSeenAt = new Map();
    this.shown = new Map();
    // The one ride's tokens (on its own, as always); party rides each have their own (trains).
    this.tokens = new TokenTrain();
    this.trains = new Map();
    this.lastTokenStep = new Map();
    this.camera = new CameraFollow();
    this.bounce = new TokenBounce(this);
  }

  /** The ride this client is showing (its focus), or null. */
  get ride() {
    return this.rides.get(this.focusId) ?? null;
  }

  init() {
    Hooks.on("updateWorldTime", () => { this.worldSeenAt = performance.now(); });
    game.socket.on("module.kg-transit", async (request) => {
      if (request?.action !== "emergencyStop" || !this.isDriver || !this.rides.has(request.rideId)
        || !game.users.get(request.userId)?.isGM) return;
      try {
        await this.emergencyStop(request.rideId);
      } catch (err) {
        console.error(MODULE_ID + " | emergency stop failed", err);
        ui.notifications.error("The emergency stop failed. See the console for details.");
      }
    });
    this.sync();
  }

  get isDriver() {
    return game.user.isGM && game.users.activeGM?.isSelf;
  }

  /**
   * Every ride under way, from both settings: { id: ride }. `one` and `many`: a setting's new
   * value, when it has just changed (its onChange), else each is read from its setting.
   */
  #stored({ one, many } = {}) {
    if (one === undefined) one = setting(SETTINGS.activeRide);
    if (many === undefined) many = partyRides() ? setting(SETTINGS.activeRides) ?? {} : {};
    const out = { ...(many ?? {}) };
    if (one?.id) out[one.id] = one;
    return out;
  }

  /** The rides as stored changed (a setting's onChange): show, follow and drive them. */
  sync(changed = {}) {
    const stored = this.#stored(changed);
    const before = this.ride;
    for (const [id, ride] of Object.entries(stored)) {
      const old = this.rides.get(id);
      if (ride.ff && !old?.ff) this.ffSeenAt.set(id, performance.now());
      this.rides.set(id, ride);
    }
    for (const id of [...this.rides.keys()]) {
      if (stored[id]) continue;
      this.rides.delete(id);
      this.ffSeenAt.delete(id);
      this.shown.delete(id);
      this.trains.delete(id);
      this.lastTokenStep.delete(id);
    }
    // Keep showing the ride this client was on; else a player's own party's, else the first.
    if (!this.rides.has(this.focusId)) this.focusId = this.#defaultFocus();
    this.#show(before);
    if (this.rides.size) this.bounce.start();
    else this.bounce.stop();
    this.#watchSelection(this.rides.size > 0);
    if (this.rides.size && this.isDriver) this.#startDriving();
    else this.#stopDriving();
  }

  /** The one ride's setting changed (on its own: the ride itself, or {} when there is none). */
  onRideChanged(value) { this.sync({ one: value }); }

  /** The rides this user may watch: the GM every one, a player those they ride on or are shown. */
  watchable() {
    return [...this.rides.values()].filter((r) => game.user.isGM || r.showToAll || r.viewers?.includes(game.user.id));
  }

  #defaultFocus() {
    // With KG Cities, the GM sees the ride of the party token they have selected, or none.
    if (game.user.isGM && partyRides()) return this.#selectedRide()?.id ?? null;
    const mine = [...this.rides.values()].find((r) => r.viewers?.includes(game.user.id));
    return mine?.id ?? this.watchable()[0]?.id ?? this.rides.keys().next().value ?? null;
  }

  /** A token the GM has just selected (the controlToken hook): it alone decides what they see. */
  picked(tokenId) { this.lastPicked = tokenId; }

  /**
   * The ride of the token the GM selected last, or null. Only that one token counts: selecting
   * a party walking the streets closes the train window even if a riding party stays selected
   * too (KG Cities then shows the street view, never both).
   */
  #selectedRide() {
    const controlled = globalThis.canvas?.tokens?.controlled ?? [];
    const id = (t) => t.document?.id ?? t.id;
    const last = controlled.find((t) => id(t) === this.lastPicked) ?? controlled.at(-1);
    return last ? this.partyRide(id(last)) : null;
  }

  /** The GM's selection changed (with KG Cities): show its ride, or close the window. */
  followSelection() {
    if (!game.user.isGM || !partyRides()) return;
    const id = this.#selectedRide()?.id ?? null;
    if (id === this.focusId) return;
    const before = this.ride;
    this.focusId = id;
    this.#show(before);
  }

  /** The GM's selection is also checked twice a second while rides run, in case a hook is missed. */
  #watchSelection(on) {
    if (on && !this.watchTimer && game.user.isGM && partyRides()) this.watchTimer = setInterval(() => this.followSelection(), 500);
    else if (!on && this.watchTimer) { clearInterval(this.watchTimer); this.watchTimer = null; }
  }

  /** Show another ride in this client's window (the GM's tabs; a player stays on their own). */
  focus(id) {
    if (!game.user.isGM || !this.rides.has(id) || id === this.focusId) return;
    // With KG Cities the window follows the selection, so a tab selects that party's token.
    const token = partyRides() ? globalThis.canvas?.tokens?.get(this.rides.get(id).partyTokenId) : null;
    if (token) { token.control({ releaseOthers: true }); this.picked(token.document.id); }
    const before = this.ride;
    this.focusId = id;
    this.#show(before);
  }

  /** The window and the camera follow the focused ride. */
  #show(before) {
    const ride = this.ride;
    if (ride && ride.id !== before?.id) this.camera.start(ride);
    else if (ride) this.camera.ride = ride;
    else if (before) this.camera.end();
    this.overlay.sync(ride);
  }

  /** Elapsed trip seconds to draw now: the world clock, smoothed between the GM's writes. */
  displayElapsed(now = performance.now(), ride = this.ride) {
    if (!ride) return 0;
    const total = ride.trip.total;
    if (ride.ff) return this.#ffTarget(ride, now).at;
    const base = game.time.worldTime - ride.start;
    const lead = game.paused ? 0 : Math.min(MAX_LEAD, (now - this.worldSeenAt) / 1000);
    const estimate = Math.min(total, base + lead);
    // Smooth over small backward corrections when a write lands; follow big jumps.
    const shown = this.shown.get(ride.id) ?? 0;
    const value = estimate < shown && shown - estimate < MAX_LEAD ? shown : estimate;
    this.shown.set(ride.id, value);
    return value;
  }

  /** A party already riding (party rides): its ride, or null. */
  partyRide(tokenId) {
    return tokenId ? [...this.rides.values()].find((r) => r.partyTokenId === tokenId) ?? null : null;
  }

  async start({ trip, networkName, cars = {}, riders, waived, charged, showToAll, sceneId, tokenIds, partyTokenId = null, label = null }) {
    const viewers = game.users
      .filter((u) => !u.isGM && riders.some((r) => game.actors.get(r.id)?.testUserPermission(u, "OWNER")))
      .map((u) => u.id);
    const many = partyRides();
    // The first ride under way stops Calendaria's own clock; the last to end starts it again.
    const calendaria = globalThis.CALENDARIA?.api;
    const clockWasRunning = this.rides.size ? [...this.rides.values()].some((r) => r.clockWasRunning) : !!calendaria?.isClockRunning?.();
    if (calendaria?.isClockRunning?.()) calendaria.stopClock();

    const ride = {
      id: foundry.utils.randomID(),
      trip,
      networkName,
      cars,
      start: game.time.worldTime,
      riders,
      viewers,
      showToAll,
      sceneId,
      tokenIds,
      partyTokenId,
      label,
      party: many,
      clockWasRunning,
      ff: null
    };
    await this.#chat(this.#boardCard(ride, waived, charged), ride);
    Hooks.callAll(`${MODULE_ID}.rideStart`, ride);
    if (many) await game.settings.set(MODULE_ID, SETTINGS.activeRides, { ...(setting(SETTINGS.activeRides) ?? {}), [ride.id]: ride });
    else await game.settings.set(MODULE_ID, SETTINGS.activeRide, ride);
    // The train only moves while the game runs, so boarding unpauses it for everyone.
    if (game.paused) game.togglePause(false, { broadcast: true });
  }

  /** Save a changed ride where it is kept. */
  async #save(ride) {
    if (ride.party) await game.settings.set(MODULE_ID, SETTINGS.activeRides, { ...(setting(SETTINGS.activeRides) ?? {}), [ride.id]: ride });
    else await game.settings.set(MODULE_ID, SETTINGS.activeRide, ride);
  }

  /** Take a ride out of where it is kept. */
  async #remove(ride) {
    if (ride.party) {
      const all = { ...(setting(SETTINGS.activeRides) ?? {}) };
      delete all[ride.id];
      await game.settings.set(MODULE_ID, SETTINGS.activeRides, all);
    } else await game.settings.set(MODULE_ID, SETTINGS.activeRide, {});
  }

  #boardCard(ride, waived, charged) {
    const { trip } = ride;
    const from = trip.names[trip.from];
    const to = trip.names[trip.to];
    const legs = trip.legs.map((leg) => `<li style="--line:${trip.lines[leg.line].color}">${escapeHtml(leg.label)}</li>`).join("");
    const paid = charged.map((c) => `${escapeHtml(c.name)} ${formatMoney(c.value)}`).join(", ");
    return `<div class="kg-transit-card">
      <h3><i class="fa-solid fa-train-subway"></i> ${escapeHtml(from)} to ${escapeHtml(to)}</h3>
      <ol class="legs">${legs}</ol>
      <p>${ride.riders.map((r) => escapeHtml(r.name)).join(", ")} boarded. ${formatDuration(trip.total)}, arriving about ${formatClock(ride.start + trip.total)}.</p>
      ${paid ? `<p class="fare">Fares: ${paid}.</p>` : ""}
      ${waived.length ? `<p class="fare">Rode free: ${waived.map(escapeHtml).join(", ")}.</p>` : ""}
    </div>`;
  }

  async #chat(content, ride = this.ride) {
    await ChatMessage.create({ content, speaker: { alias: ride?.networkName || "Transit" } });
  }

  // ---- GM controls (on the ride shown, or the one named) ----

  /** Where a fast travel has got to: { at (elapsed seconds), done }. */
  #ffTarget(ride, now = performance.now()) {
    const ff = ride.ff;
    const p = Math.min(1, (now - (this.ffSeenAt.get(ride.id) ?? now)) / ff.ms);
    return { at: ff.from + (ff.to - ff.from) * ease(p), done: p >= 1 };
  }

  /** The trip seconds the GM's clock has reached, counting what is not yet written. */
  #elapsedNow(ride) {
    return Math.max(0, game.time.worldTime - ride.start + this.pending);
  }

  /** Fast travel to `to` seconds into the trip over `ms`, then carry on ("ride") or get off ("finish"). */
  async #fastTravel(ride, to, ms, then, { trip = ride.trip, early = false } = {}) {
    const from = this.#elapsedNow(ride);
    // What the clock owes is written first, so the fast travel starts from the world's time.
    if (this.pending >= 1) await this.#advance(Math.floor(this.pending));
    this.pending = 0;
    await this.#save({ ...ride, trip, ff: { from, to: Math.max(from, to), ms, then, early } });
  }

  /** A fast travel already under way (one at a time: it drives the shared clock). */
  #fastTravelling() {
    return [...this.rides.values()].some((r) => r.ff);
  }

  /** Skip to the next stop over 5 seconds, then ride on in real time. */
  async skipToNextStop(id = this.focusId) {
    const ride = this.rides.get(id);
    if (!ride || this.#fastTravelling() || !this.isDriver) return;
    const next = nextStop(ride.trip, this.#elapsedNow(ride));
    if (!next) return;
    const last = next.index === ride.trip.segments.length - 1;
    await this.#fastTravel(ride, next.arrive, SKIP_MS, last ? "finish" : "ride");
  }

  /** Get off at the stop the train stands at, or fast travel to the next one over 5 seconds and get off there. */
  async getOffNextStop(id = this.focusId) {
    const ride = this.rides.get(id);
    if (!ride || this.#fastTravelling() || !this.isDriver) return;
    const elapsed = this.#elapsedNow(ride);
    const standing = standingAt(ride.trip, elapsed);
    if (standing >= 0) return this.#finish(ride, endAfterSegment(ride.trip, standing), { early: standing < ride.trip.segments.length - 1 });
    const next = nextStop(ride.trip, elapsed);
    if (!next) return;
    const trip = endAfterSegment(ride.trip, next.index);
    ui.notifications.info(`Getting off at ${trip.names[trip.to]}.`);
    await this.#fastTravel(ride, next.arrive, SKIP_MS, "finish", { trip, early: next.index < ride.trip.segments.length - 1 });
  }

  /** Fast travel the rest of the way over 15 seconds. */
  async arrive(id = this.focusId) {
    const ride = this.rides.get(id);
    if (!ride || this.#fastTravelling() || !this.isDriver) return;
    await this.#fastTravel(ride, ride.trip.total, ARRIVE_FF_MS, "finish");
  }

  /** Stop the train where it is and put everyone off there, ending the ride (no more time passes). */
  async emergencyStop(id = this.focusId) {
    const ride = this.rides.get(id);
    if (!ride || !game.user.isGM) return;
    // Every GM sees the control, but only the active GM drives and deposits the tokens.
    if (!this.isDriver) {
      game.socket.emit("module.kg-transit", { action: "emergencyStop", rideId: ride.id, userId: game.user.id });
      return;
    }
    const elapsed = ride.ff ? this.#ffTarget(ride).at : this.#elapsedNow(ride);
    // Clear the shared ride immediately; clock hooks must not delay an emergency stop.
    const scene = game.scenes.get(ride.sceneId);
    const net = sceneNetwork(scene);
    const at = scene ? trainPoint(ride.trip, elapsed, stationPositions(net), routeShapes(net)) : null;
    await this.#finish(ride, truncateTrip(ride.trip, elapsed), { early: true, at });
  }

  // ---- driving the clock (active GM only) ----

  #startDriving() {
    if (this.timer) return;
    this.lastTick = performance.now();
    this.lastCommit = this.lastTick;
    this.pending = 0;
    this.timer = setInterval(() => this.#tick(), 250);
  }

  #stopDriving() {
    clearInterval(this.timer);
    this.timer = null;
    this.pending = 0;
  }

  async #tick() {
    if (!this.rides.size || this.busy) return;
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;

    this.busy = true;
    try {
      // A fast travel drives the clock; every other ride moves on with it.
      const ff = [...this.rides.values()].find((r) => r.ff);
      if (ff) return await this.#tickFastTravel(ff, now);
      if (game.paused) return;
      this.pending += dt;
      // Rides whose trip ends within what the clock owes get off, soonest first.
      const ending = [...this.rides.values()]
        .filter((r) => game.time.worldTime - r.start + this.pending >= r.trip.total)
        .sort((a, b) => (a.start + a.trip.total) - (b.start + b.trip.total));
      for (const ride of ending) {
        const owed = ride.trip.total - (game.time.worldTime - ride.start);
        if (owed > 0) { await this.#advance(owed); this.pending = Math.max(0, this.pending - owed); }
        if (this.rides.has(ride.id)) await this.#finish(ride, ride.trip);
      }
      if (this.pending >= COMMIT_EVERY) {
        const step = Math.floor(this.pending);
        this.pending -= step;
        await this.#advance(step);
      }
      for (const ride of this.rides.values()) await this.#moveAlong(ride, game.time.worldTime - ride.start + this.pending, now);
    } finally {
      this.busy = false;
    }
  }

  async #tickFastTravel(ride, now) {
    const elapsed = game.time.worldTime - ride.start;
    const { at: target, done } = this.#ffTarget(ride, now);
    if (done) {
      await this.#advance(ride.ff.to - elapsed);
      if (!this.rides.has(ride.id)) return;
      if (ride.ff.then === "finish") await this.#finish(ride, ride.trip, { early: !!ride.ff.early });
      else {
        // Back to real time from the stop reached.
        this.pending = 0;
        this.lastTick = performance.now();
        await this.#save({ ...ride, ff: null });
      }
      return;
    }
    if (now - this.lastCommit >= 1000 && target - elapsed >= 1) {
      this.lastCommit = now;
      await this.#advance(Math.floor(target - elapsed));
    }
    await this.#moveAlong(ride, target, now);
    // The other rides keep up with the clock it moves.
    for (const other of this.rides.values()) {
      if (other.id === ride.id) continue;
      const left = other.trip.total - (game.time.worldTime - other.start);
      if (left <= 0) await this.#finish(other, other.trip);
      else await this.#moveAlong(other, game.time.worldTime - other.start, now);
    }
  }

  async #advance(seconds) {
    if (seconds > 0) await game.time.advance(Math.round(seconds));
  }

  /** End a ride. `at`: an emergency stop's spot on the map, where everyone gets off instead of a stop. */
  async #finish(ride, trip, { early = false, at = null } = {}) {
    if (!ride || !this.rides.has(ride.id)) return;
    this.rides.delete(ride.id);
    if (!this.rides.size) this.#stopDriving();
    await this.#remove(ride);
    await this.#moveTokens(ride, trip, at);
    if (ride.party) this.trains.delete(ride.id);
    else this.tokens.reset();
    // The last ride to end starts Calendaria's clock again, if it was running when they began.
    if (!this.rides.size && ride.clockWasRunning) globalThis.CALENDARIA?.api?.startClock?.();
    const to = escapeHtml(trip.names[trip.to]);
    const title = at ? `Emergency stop before ${to}` : `${early ? "Off" : "Arrived"} at ${to}`;
    await this.#chat(`<div class="kg-transit-card"><h3><i class="fa-solid fa-train-subway"></i> ${title}</h3>
      <p>${formatClock(game.time.worldTime)}.</p></div>`, ride);
    Hooks.callAll(`${MODULE_ID}.rideEnd`, ride, { station: at ? null : trip.to, early, emergency: !!at });
  }

  #train(ride) {
    if (!ride.party) return this.tokens;
    if (!this.trains.has(ride.id)) this.trains.set(ride.id, new TokenTrain());
    return this.trains.get(ride.id);
  }

  /** Put the ride's tokens off the train: gathered below the stop where the trip ended, or where it stopped. */
  async #moveTokens(ride, trip, at = null) {
    const scene = game.scenes.get(ride.sceneId);
    if (!scene) return;
    if (!at && !stationPositions(sceneNetwork(scene))[trip.to]) {
      ui.notifications.info(`${trip.names[trip.to]} isn't placed on this map; the party stays where it is.`);
      return;
    }
    await this.#train(ride).settle({ ...ride, trip }, trip, ARRIVE_MS, at);
  }

  /** Every so often, move a ride's tokens to where its train is now (active GM only). */
  async #moveAlong(ride, elapsed, now) {
    // A clock write can yield while an emergency stop ends the ride.
    if (!this.rides.has(ride.id)) return;
    const every = ride.ff ? TOKEN_STEP_FAST_MS : TOKEN_STEP_MS;
    if (now - (this.lastTokenStep.get(ride.id) ?? 0) < every) return;
    this.lastTokenStep.set(ride.id, now);
    // Aim where the train will be when this glide ends, so the token keeps pace.
    const ahead = ride.ff ? 0 : every / 1000;
    await this.#train(ride).step(ride, Math.min(ride.trip.total, Math.max(0, elapsed + ahead)), every);
  }
}

/** How long the tokens take to settle on the final stop (ms). */
const ARRIVE_MS = 800;
