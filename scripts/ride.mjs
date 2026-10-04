import { MODULE_ID, SETTINGS, escapeHtml, formatClock, formatDuration, sceneNetwork, setting, stationPositions } from "./config.mjs";
import { formatMoney } from "./fare.mjs";
import { truncateTrip } from "./network.mjs";
import { CameraFollow, TOKEN_STEP_FAST_MS, TOKEN_STEP_MS, TokenTrain } from "./follow.mjs";
import { RideOverlay } from "./overlay.mjs";

/** World time is written in batches this often while riding (seconds). */
const COMMIT_EVERY = 5;
const FAST_FORWARD_MS = 10_000;
/** Clients estimate the clock between writes, but never run further ahead than this. */
const MAX_LEAD = COMMIT_EVERY + 1;

const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/**
 * The ride lives in a world setting, so every client (including ones that join or reload
 * mid-ride) sees the same thing. Only the active GM moves world time: one game second per
 * real second, paused while the game is paused, or the rest of the trip over 10 seconds
 * when fast-forwarded.
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
    if (ride.ff) {
      const p = Math.min(1, (now - (this.ffSeenAt ?? now)) / FAST_FORWARD_MS);
      return ride.ff.from + (total - ride.ff.from) * ease(p);
    }
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

  async fastForward() {
    const ride = this.ride;
    if (!ride || ride.ff || !this.isDriver) return;
    const from = Math.max(0, game.time.worldTime - ride.start);
    await game.settings.set(MODULE_ID, SETTINGS.activeRide, { ...ride, ff: { from } });
  }

  async getOffNextStop() {
    const ride = this.ride;
    if (!ride || ride.ff || !this.isDriver) return;
    const elapsed = Math.max(0, game.time.worldTime - ride.start + this.pending);
    const trip = truncateTrip(ride.trip, elapsed);
    if (trip.to === ride.trip.to) return;
    ui.notifications.info(`Getting off at ${trip.names[trip.to]}.`);
    await game.settings.set(MODULE_ID, SETTINGS.activeRide, { ...ride, trip });
  }

  async endNow() {
    if (!this.ride || !this.isDriver) return;
    // Ending early drops the riders at the stop they were at or heading for, without the time.
    const elapsed = game.time.worldTime - this.ride.start;
    await this.#finish(truncateTrip(this.ride.trip, elapsed), { early: true });
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
        const p = Math.min(1, (now - (this.ffSeenAt ?? now)) / FAST_FORWARD_MS);
        const target = ride.ff.from + (total - ride.ff.from) * ease(p);
        if (p >= 1) {
          await this.#advance(total - elapsed);
          await this.#finish(ride.trip);
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

  async #finish(trip, { early = false } = {}) {
    const ride = this.ride;
    if (!ride) return;
    this.#stopDriving();
    await game.settings.set(MODULE_ID, SETTINGS.activeRide, {});
    await this.#moveTokens(ride, trip);
    this.tokens.reset();
    if (ride.clockWasRunning) globalThis.CALENDARIA?.api?.startClock?.();
    const to = trip.names[trip.to];
    await this.#chat(`<div class="kg-transit-card"><h3><i class="fa-solid fa-train-subway"></i> ${early ? "Off" : "Arrived"} at ${escapeHtml(to)}</h3>
      <p>${formatClock(game.time.worldTime)}.</p></div>`, ride);
    Hooks.callAll(`${MODULE_ID}.rideEnd`, ride, { station: trip.to, early });
  }

  /** Settle the ride's tokens on the stop where the trip ended. */
  async #moveTokens(ride, trip) {
    const scene = game.scenes.get(ride.sceneId);
    if (!scene) return;
    if (!stationPositions(sceneNetwork(scene))[trip.to]) {
      ui.notifications.info(`${trip.names[trip.to]} isn't placed on this map; the party stays where it is.`);
    }
    await this.tokens.step({ ...ride, trip }, trip.total, ARRIVE_MS);
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
