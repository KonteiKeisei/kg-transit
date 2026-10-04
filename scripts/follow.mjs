import { sceneNetwork, stationPositions } from "./config.mjs";
import { pointOnTrip, routeShapes, tripTrack } from "./route-path.mjs";
import { stateAt, trainDistance } from "./timeline.mjs";

/** How often the GM moves the tokens along the line (ms), normally and when fast-forwarding. */
export const TOKEN_STEP_MS = 1000;
export const TOKEN_STEP_FAST_MS = 400;

const RIDE_ZOOM = 0.35;
/** The scene's zoom the view settles at after the ride. */
const END_ZOOM = 1;
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

/**
 * The GM's side: moves the ride's tokens to where the train is, with Foundry's movement
 * animation lasting until the next step, so they glide continuously. They ride single file
 * along the track (curved through its travel nodes), the party token in front. Called from the
 * ride clock, so it stops when the game is paused and catches up when time is moved.
 */
export class TokenTrain {
  constructor() {
    this.reset();
  }

  reset() {
    this.last = null;
    this.sceneId = null;
    this.positions = null;
    this.shapes = null;
  }

  #network(scene) {
    if (this.sceneId === scene.id) return;
    const net = sceneNetwork(scene);
    this.positions = stationPositions(net);
    this.shapes = routeShapes(net);
    this.sceneId = scene.id;
  }

  async step(ride, elapsed, durationMs) {
    const scene = game.scenes.get(ride.sceneId);
    if (!scene) return;
    this.#network(scene);
    // A stop not yet placed on the map: the tokens wait until the line reaches a placed one.
    const track = tripTrack(ride.trip, this.shapes);
    const d = trainDistance(ride.trip, elapsed, track);
    if (d === null) return;
    const lead = pointOnTrip(track, d);
    if (this.last && Math.hypot(lead.x - this.last.x, lead.y - this.last.y) < 1) return;
    this.last = lead;

    const tokens = rideTokens(ride, scene);
    if (!tokens.length) return;
    const grid = scene.grid.size;
    // Each token a little over half of its own and the one ahead's size behind it.
    let behind = 0;
    const updates = tokens.map((t, i) => {
      if (i > 0) behind += ((tokens[i - 1].width + t.width) / 2) * grid * 0.9;
      return place(scene, t, pointOnTrip(track, d - behind) ?? lead);
    });
    await scene.updateEmbeddedDocuments("Token", updates, { animation: { duration: durationMs, easing: null } });
  }

  /**
   * Off the train: the tokens gather just below the stop (or `at`, where an emergency stop left
   * the train) in as tight a circle as they make, the party token in the middle and the rest in
   * rings around it, each ring evenly spaced.
   */
  async settle(ride, trip, durationMs, at = null) {
    const scene = game.scenes.get(ride.sceneId);
    if (!scene) return;
    this.#network(scene);
    const stop = at ?? this.positions[trip.to];
    const tokens = rideTokens(ride, scene);
    if (!stop || !tokens.length) return;
    const grid = scene.grid.size;
    const offsets = huddle(tokens.length);
    const size = Math.max(...tokens.map((t) => Math.max(t.width, t.height))) * grid;
    const reach = Math.max(...offsets.map((o) => o.ring)) * size;
    const centre = { x: stop.x, y: stop.y + reach + size };
    const updates = tokens.map((t, i) => place(scene, t, { x: centre.x + offsets[i].x * size, y: centre.y + offsets[i].y * size }));
    await scene.updateEmbeddedDocuments("Token", updates, { animation: { duration: durationMs } });
  }
}

/** A token's update to stand centred on a point, kept on the scene. */
function place(scene, token, point) {
  const rect = scene.dimensions.sceneRect;
  const grid = scene.grid.size;
  const w = token.width * grid, h = token.height * grid;
  const x = Math.min(rect.x + rect.width - w, Math.max(rect.x, point.x - w / 2));
  const y = Math.min(rect.y + rect.height - h, Math.max(rect.y, point.y - h / 2));
  return { _id: token.id, x: Math.round(x), y: Math.round(y) };
}

/**
 * Hexagonal packing for n tokens, in token sizes from the middle: one in the centre, then
 * rings of 6, 12, 18 ... each evenly spaced around. [{ x, y, ring }].
 */
export function huddle(n) {
  const out = [{ x: 0, y: 0, ring: 0 }];
  for (let ring = 1; out.length < n; ring++) {
    const count = Math.min(6 * ring, n - out.length);
    for (let k = 0; k < count; k++) {
      const angle = -Math.PI / 2 + (k / count) * Math.PI * 2;
      out.push({ x: Math.cos(angle) * ring, y: Math.sin(angle) * ring, ring });
    }
  }
  return out.slice(0, n);
}

/**
 * Every client's own touch: the riding tokens' art bobs gently while the train moves, still
 * when it stands at a stop. Only the picture moves (its pivot), never the token itself.
 */
export class TokenBounce {
  constructor(controller) {
    this.controller = controller;
    this.lifted = new Map();
    this.ticker = () => this.#frame();
    this.on = false;
  }

  start() {
    if (this.on) return;
    this.on = true;
    canvas.app?.ticker.add(this.ticker, null, PIXI.UPDATE_PRIORITY.LOW + 1);
  }

  stop() {
    this.on = false;
    canvas.app?.ticker.remove(this.ticker);
    for (const [mesh, lift] of this.lifted) if (!mesh.destroyed) mesh.pivot.y -= lift;
    this.lifted.clear();
  }

  #frame() {
    const ride = this.controller.ride;
    if (!ride || !canvas.ready || canvas.scene?.id !== ride.sceneId) return;
    const speed = stateAt(ride.trip, this.controller.displayElapsed()).speed ?? 0;
    const grid = canvas.scene.grid.size;
    const now = performance.now() / 1000;
    const seen = new Set();
    rideTokens(ride, canvas.scene).forEach((doc, i) => {
      const mesh = doc.object?.mesh;
      if (!mesh || mesh.destroyed || !mesh.scale.y) return;
      seen.add(mesh);
      // A small hop about twice a second, each token a little out of step with the next.
      const hop = Math.abs(Math.sin((now * 2.1 + i * 0.37) * Math.PI)) * grid * 0.035 * speed;
      const lift = hop / mesh.scale.y;
      mesh.pivot.y += lift - (this.lifted.get(mesh) ?? 0);
      this.lifted.set(mesh, lift);
    });
    for (const [mesh, lift] of this.lifted) {
      if (seen.has(mesh)) continue;
      if (!mesh.destroyed) mesh.pivot.y -= lift;
      this.lifted.delete(mesh);
    }
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
