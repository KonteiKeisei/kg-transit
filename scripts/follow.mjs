import { sceneNetwork, stationPositions } from "./config.mjs";
import { trainPoint } from "./timeline.mjs";

/** How often the GM moves the tokens along the line (ms), normally and when fast-forwarding. */
export const TOKEN_STEP_MS = 1000;
export const TOKEN_STEP_FAST_MS = 400;

const RIDE_ZOOM = 0.35;
const END_ZOOM = 0.1;
const ZOOM_IN_MS = 1500;
const ZOOM_OUT_MS = 2000;

/**
 * The ride's tokens on its scene, the party token first: the one the GM designated for the
 * scene if any, otherwise a group token that boarded.
 */
function rideTokens(ride, scene) {
  const riderIds = new Set(ride.riders.map((r) => r.id));
  const lead = (t) => t.id === ride.partyTokenId || (!ride.partyTokenId && t.actor?.type === "group");
  return ride.tokenIds.map((id) => scene?.tokens.get(id))
    .filter((t) => t && (lead(t) || t.actor?.type === "group" || riderIds.has(t.actorId)))
    .sort((a, b) => lead(b) - lead(a));
}

/** True for the token that rides the line itself (everyone else rings it). */
function isLead(ride, token, index) {
  return index === 0 && (token.id === ride.partyTokenId || (!ride.partyTokenId && token.actor?.type === "group"));
}

/**
 * The GM's side: moves the ride's tokens to where the train is, with Foundry's movement
 * animation lasting until the next step, so they glide continuously. Called from the ride
 * clock, so it stops when the game is paused and catches up when time is moved.
 */
export class TokenTrain {
  constructor() {
    this.last = null;
    this.positions = null;
    this.sceneId = null;
  }

  reset() {
    this.last = null;
    this.positions = null;
    this.sceneId = null;
  }

  async step(ride, elapsed, durationMs) {
    const scene = game.scenes.get(ride.sceneId);
    if (!scene) return;
    if (this.sceneId !== scene.id) {
      this.positions = stationPositions(sceneNetwork(scene));
      this.sceneId = scene.id;
    }
    // A stop not yet placed on the map: the tokens wait until the line reaches a placed one.
    const point = trainPoint(ride.trip, elapsed, this.positions);
    if (!point) return;
    const rect = scene.dimensions.sceneRect;
    const margin = scene.grid.size;
    point.x = Math.min(rect.x + rect.width - margin, Math.max(rect.x + margin, point.x));
    point.y = Math.min(rect.y + rect.height - margin, Math.max(rect.y + margin, point.y));
    if (this.last && Math.hypot(point.x - this.last.x, point.y - this.last.y) < 1) return;
    this.last = point;

    const tokens = rideTokens(ride, scene);
    if (!tokens.length) return;
    const grid = scene.grid.size;
    const updates = tokens.map((t, i) => {
      // The party token rides the line; anyone else travels in a tight ring around it.
      const angle = (i / tokens.length) * Math.PI * 2;
      const ring = isLead(ride, t, i) ? 0 : grid * 0.6;
      return {
        _id: t.id,
        x: Math.round(point.x + Math.cos(angle) * ring - (t.width * grid) / 2),
        y: Math.round(point.y + Math.sin(angle) * ring - (t.height * grid) / 2)
      };
    });
    await scene.updateEmbeddedDocuments("Token", updates, { animation: { duration: durationMs, easing: null } });
  }
}

/**
 * Every client's camera: players (and the GM while a ride token is selected) follow the
 * ride's lead token at ride zoom, and pull back out when the trip ends.
 */
export class CameraFollow {
  constructor() {
    this.ride = null;
    this.following = false;
    this.ticker = () => this.#frame();
  }

  start(ride) {
    this.ride = ride;
    canvas.app?.ticker.add(this.ticker);
  }

  async end() {
    const ride = this.ride;
    const was = this.following;
    this.ride = null;
    this.following = false;
    canvas.app?.ticker.remove(this.ticker);
    if (!ride || !was || canvas.scene?.id !== ride.sceneId) return;
    const lead = this.#lead(ride);
    const at = lead?.center ?? canvas.stage.pivot;
    await canvas.animatePan({ x: at.x, y: at.y, scale: END_ZOOM, duration: ZOOM_OUT_MS });
  }

  #lead(ride) {
    if (canvas.scene?.id !== ride.sceneId) return null;
    return rideTokens(ride, canvas.scene).map((doc) => doc.object).find(Boolean) ?? null;
  }

  #wanted(ride) {
    if (!game.user.isGM) return true;
    const ids = new Set(ride.tokenIds);
    return canvas.tokens.controlled.some((t) => ids.has(t.id));
  }

  #frame() {
    const ride = this.ride;
    if (!ride || !canvas.ready) return;
    const lead = this.#lead(ride);
    const wanted = !!lead && this.#wanted(ride);
    if (!wanted) {
      this.following = false;
      return;
    }
    const { x, y } = lead.center;
    if (!this.following) {
      // Ease in to the ride zoom first; follow every frame once there.
      this.following = true;
      this.zooming = true;
      canvas.animatePan({ x, y, scale: RIDE_ZOOM, duration: ZOOM_IN_MS }).then(() => { this.zooming = false; });
      return;
    }
    if (this.zooming) return;
    const pivot = canvas.stage.pivot;
    if (Math.hypot(pivot.x - x, pivot.y - y) > 0.5) canvas.pan({ x, y });
  }
}
