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
 * The ride lives in a world setting, so every client (including ones that join or reload
 * mid-ride) sees the same thing. Only the active GM moves world time: one game second per
 * real second, paused while the game is paused. The GM can fast travel (ride.ff: { from, to,
 * ms, then }): from one moment of the trip to another over `ms`, then carry on in real time
 * ("ride") or get off ("finish").
 */
export class RideController {
  constructor() {
    this.ride = null;
    this.overlay = new RideOverlay(this);
    this.timer = null;
    this.pending = 0;
    this.busy = false;
    this.lastTick = 0;
    this.lastCommit = 0;
    this.worldSeenAt = performance.now();
    this.ffSeenAt = null;
    this.shown = 0;
    this.tokens = new TokenTrain();
    this.camera = new CameraFollow();
    this.bounce = new TokenBounce(this);
    this.lastTokenStep = 0;
  }

  init() {
    Hooks.on("updateWorldTime", () => { this.worldSeenAt = performance.now(); });
    this.onRideChanged(setting(SETTINGS.activeRide));
  }

  get isDriver() {
    return game.user.isGM && game.users.activeGM?.isSelf;
  }

  onRideChanged(ride) {
    ride = ride?.id ? ride : null;
    if (ride?.ff && !this.ride?.ff) this.ffSeenAt = performance.now();
    if (!ride || ride.id !== this.ride?.id) this.shown = 0;
    // The camera follows a new ride, keeps up with a changed one, and pulls out when it ends.
    if (ride && ride.id !== this.ride?.id) this.camera.start(ride);
    else if (ride) this.camera.ride = ride;
    else if (this.ride) this.camera.end();
    if (ride) this.bounce.start();
    else this.bounce.stop();
    this.ride = ride;
    this.overlay.sync(ride);
    if (ride && this.isDriver) this.#startDriving();
    else this.#stopDriving();
  }

  /** Elapsed trip seconds to draw now: the world clock, smoothed between the GM's writes. */
  displayElapsed(now = performance.now()) {
    const ride = this.ride;
    if (!ride) return 0;
    const total = ride.trip.total;
    if (ride.ff) return this.#ffTarget(ride.ff, now).at;
    const base = game.time.worldTime - ride.start;
    const lead = game.paused ? 0 : Math.min(MAX_LEAD, (now - this.worldSeenAt) / 1000);
    const estimate = Math.min(total, base + lead);
    // Smooth over small backward corrections when a write lands; follow big jumps.
    this.shown = estimate < this.shown && this.shown - estimate < MAX_LEAD ? this.shown : estimate;
    return this.shown;
  }

  async start({ trip, networkName, cars = {}, riders, waived, charged, showToAll, sceneId, tokenIds, partyTokenId = null }) {
    const viewers = game.users
      .filter((u) => !u.isGM && riders.some((r) => game.actors.get(r.id)?.testUserPermission(u, "OWNER")))
      .map((u) => u.id);
    const calendaria = globalThis.CALENDARIA?.api;
    const clockWasRunning = !!calendaria?.isClockRunning?.();
    if (clockWasRunning) calendaria.stopClock();

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
      clockWasRunning,
      ff: null
    };
    await this.#chat(this.#boardCard(ride, waived, charged), ride);
    Hooks.callAll(`${MODULE_ID}.rideStart`, ride);
    await game.settings.set(MODULE_ID, SETTINGS.activeRide, ride);
    // The train only moves while the game runs, so boarding unpauses it for everyone.
    if (game.paused) game.togglePause(false, { broadcast: true });
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

  // ---- GM controls ----

  /** Where a fast travel has got to: { at (elapsed seconds), done }. */
  #ffTarget(ff, now = performance.now()) {
    const p = Math.min(1, (now - (this.ffSeenAt ?? now)) / ff.ms);
    return { at: ff.from + (ff.to - ff.from) * ease(p), done: p >= 1 };
  }

  /** The trip seconds the GM's clock has reached, counting what is not yet written. */
  #elapsedNow(ride = this.ride) {
    return Math.max(0, game.time.worldTime - ride.start + this.pending);
  }

  /** Fast travel to `to` seconds into the trip over `ms`, then carry on ("ride") or get off ("finish"). */
  async #fastTravel(ride, to, ms, then, { trip = ride.trip, early = false } = {}) {
    const from = this.#elapsedNow(ride);
    // What the clock owes is written first, so the fast travel starts from the world's time.
    if (this.pending >= 1) await this.#advance(Math.floor(this.pending));
    this.pending = 0;
    await game.settings.set(MODULE_ID, SETTINGS.activeRide, { ...ride, trip, ff: { from, to: Math.max(from, to), ms, then, early } });
  }

  /** Skip to the next stop over 5 seconds, then ride on in real time. */
  async skipToNextStop() {
    const ride = this.ride;
    if (!ride || ride.ff || !this.isDriver) return;
    const next = nextStop(ride.trip, this.#elapsedNow(ride));
    if (!next) return;
    const last = next.index === ride.trip.segments.length - 1;
    await this.#fastTravel(ride, next.arrive, SKIP_MS, last ? "finish" : "ride");
  }

  /** Get off at the stop the train stands at, or fast travel to the next one over 5 seconds and get off there. */
  async getOffNextStop() {
    const ride = this.ride;
    if (!ride || ride.ff || !this.isDriver) return;
    const elapsed = this.#elapsedNow(ride);
    const standing = standingAt(ride.trip, elapsed);
    if (standing >= 0) return this.#finish(endAfterSegment(ride.trip, standing), { early: standing < ride.trip.segments.length - 1 });
    const next = nextStop(ride.trip, elapsed);
    if (!next) return;
    const trip = endAfterSegment(ride.trip, next.index);
    ui.notifications.info(`Getting off at ${trip.names[trip.to]}.`);
    await this.#fastTravel(ride, next.arrive, SKIP_MS, "finish", { trip, early: next.index < ride.trip.segments.length - 1 });
  }

  /** Fast travel the rest of the way over 15 seconds. */
  async arrive() {
    const ride = this.ride;
    if (!ride || ride.ff || !this.isDriver) return;
    await this.#fastTravel(ride, ride.trip.total, ARRIVE_FF_MS, "finish");
  }

  /** Stop the train where it is and put everyone off there, ending the ride (no more time passes). */
  async emergencyStop() {
    const ride = this.ride;
    if (!ride || !this.isDriver) return;
    const elapsed = ride.ff ? this.#ffTarget(ride.ff).at : this.#elapsedNow(ride);
    if (elapsed - (game.time.worldTime - ride.start) >= 1) await this.#advance(Math.floor(elapsed - (game.time.worldTime - ride.start)));
    const scene = game.scenes.get(ride.sceneId);
    const net = sceneNetwork(scene);
    const at = scene ? trainPoint(ride.trip, elapsed, stationPositions(net), routeShapes(net)) : null;
    await this.#finish(truncateTrip(ride.trip, elapsed), { early: true, at });
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
    const ride = this.ride;
    if (!ride || this.busy) return;
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    const total = ride.trip.total;
    const elapsed = game.time.worldTime - ride.start;

    this.busy = true;
    try {
      if (ride.ff) {
        const { at: target, done } = this.#ffTarget(ride.ff, now);
        if (done) {
          await this.#advance(ride.ff.to - elapsed);
          if (ride.ff.then === "finish") await this.#finish(ride.trip, { early: !!ride.ff.early });
          else {
            // Back to real time from the stop reached.
            this.pending = 0;
            this.lastTick = performance.now();
            await game.settings.set(MODULE_ID, SETTINGS.activeRide, { ...ride, ff: null });
          }
        } else {
          if (now - this.lastCommit >= 1000 && target - elapsed >= 1) {
            this.lastCommit = now;
            await this.#advance(Math.floor(target - elapsed));
          }
          await this.#moveAlong(ride, target, now);
        }
        return;
      }
      if (game.paused) return;
      this.pending += dt;
      if (elapsed + this.pending >= total) {
        await this.#advance(total - elapsed);
        await this.#finish(ride.trip);
      } else {
        if (this.pending >= COMMIT_EVERY) {
          const step = Math.floor(this.pending);
          this.pending -= step;
          await this.#advance(step);
        }
        await this.#moveAlong(ride, game.time.worldTime - ride.start + this.pending, now);
      }
    } finally {
      this.busy = false;
    }
  }

  async #advance(seconds) {
    if (seconds > 0) await game.time.advance(Math.round(seconds));
  }

  /** End the ride. `at`: an emergency stop's spot on the map, where everyone gets off instead of a stop. */
  async #finish(trip, { early = false, at = null } = {}) {
    const ride = this.ride;
    if (!ride) return;
    this.#stopDriving();
    await game.settings.set(MODULE_ID, SETTINGS.activeRide, {});
    await this.#moveTokens(ride, trip, at);
    this.tokens.reset();
    if (ride.clockWasRunning) globalThis.CALENDARIA?.api?.startClock?.();
    const to = escapeHtml(trip.names[trip.to]);
    const title = at ? `Emergency stop before ${to}` : `${early ? "Off" : "Arrived"} at ${to}`;
    await this.#chat(`<div class="kg-transit-card"><h3><i class="fa-solid fa-train-subway"></i> ${title}</h3>
      <p>${formatClock(game.time.worldTime)}.</p></div>`, ride);
    Hooks.callAll(`${MODULE_ID}.rideEnd`, ride, { station: at ? null : trip.to, early, emergency: !!at });
  }

  /** Put the ride's tokens off the train: gathered below the stop where the trip ended, or where it stopped. */
  async #moveTokens(ride, trip, at = null) {
    const scene = game.scenes.get(ride.sceneId);
    if (!scene) return;
    if (!at && !stationPositions(sceneNetwork(scene))[trip.to]) {
      ui.notifications.info(`${trip.names[trip.to]} isn't placed on this map; the party stays where it is.`);
      return;
    }
    await this.tokens.settle({ ...ride, trip }, trip, ARRIVE_MS, at);
  }

  /** Every so often, move the tokens to where the train is now (active GM only). */
  async #moveAlong(ride, elapsed, now) {
    const every = ride.ff ? TOKEN_STEP_FAST_MS : TOKEN_STEP_MS;
    if (now - this.lastTokenStep < every) return;
    this.lastTokenStep = now;
    // Aim where the train will be when this glide ends, so the token keeps pace.
    const ahead = ride.ff ? 0 : every / 1000;
    await this.tokens.step(ride, Math.min(ride.trip.total, Math.max(0, elapsed + ahead)), every);
  }
}

/** How long the tokens take to settle on the final stop (ms). */
const ARRIVE_MS = 800;
