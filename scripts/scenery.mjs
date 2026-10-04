// What riders see through the windows. The car interior art (windows keyed out) sits over
// wall planes in perspective, vanishing at the end door. Each side has a near plane
// (buildings, trees, tunnel wall or platform) and, outdoors, a far plane further out (sky
// and skyline) that shows above and between the near layer. Both scroll toward the viewer
// as the train moves; the far plane, being further away, slides past more slowly. The walls
// are drawn on one canvas, a few screen columns at a time. Everything is drawn in the theme
// of the stretch of track or the platform (themes.mjs).

import { SCENERY } from "./catalog.mjs";
import {
  FAR, STAGE_SIZE, STATION_BACKDROPS, TUNNEL_BACKDROPS,
  drawFar, drawNear, drawPlatformAbove, drawStation, drawTunnel, hash, makeCanvas, skyColors
} from "./scenery-art.mjs";
import { DEFAULT_THEME, THEMES } from "./themes.mjs";
import { WeatherLayer } from "./weather.mjs";

/** Interior art size and vanishing point, in art pixels. */
export const STAGE = STAGE_SIZE;
const PERSPECTIVE = 1000;
/** Nothing is drawn deeper than this; the backdrop shows there instead. */
const MAX_DEPTH = 16000;
/** Screen columns drawn per step. */
const COLUMN = 2;
/**
 * The near plane runs along the screen edge at depth 0 (as wide as half the art). The far
 * plane lies further out, and its texture's horizon sits at eye level like the near one.
 */
const PLANES = {
  near: { lateral: STAGE_SIZE.vpX, top: 0 },
  far: { lateral: STAGE_SIZE.vpX + 1500, top: STAGE_SIZE.vpY - FAR.horizon }
};
const FADE_MS = 900;

// ---------------------------------------------------------------- texture cache

const cache = new Map();
/** Textures kept at once (a long trip's worth); the oldest unused ones are dropped. */
const CACHE_SIZE = 14;
/** The far layer is only ever seen shrunk, so it is kept at half resolution. */
const FAR_SCALE = 0.5;

function downscale(canvas, scale) {
  const [c, g] = makeCanvas(Math.round(canvas.width * scale), Math.round(canvas.height * scale));
  g.imageSmoothingQuality = "high";
  g.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

function skyBackdrop(tod, sky) {
  const s = skyColors(tod, sky);
  const horizon = (STAGE.vpY / STAGE.h) * 100;
  return `linear-gradient(${s.top} 0%, ${s.horizon} ${horizon}%, ${s.ground} ${horizon + 0.5}%, ${s.ground} 100%)`;
}

// Keys (parts URI-encoded, joined with ":"):
//   tunnel:<style>:<theme>
//   station:<platform style>:<name>:<color>
//   platform:<theme>:<far>:<tod>:<season>:<variant>:<sky>:<name>:<color>
//   outdoor:<theme>:<near>:<far>:<tod>:<season>:<variant>:<sky>
function drawKey(key) {
  const [kind, ...rest] = key.split(":").map(decodeURIComponent);
  if (kind === "tunnel") {
    const [style, theme] = rest;
    return { near: drawTunnel(style, theme), far: null, sweep: true, backdrop: TUNNEL_BACKDROPS[style] ?? TUNNEL_BACKDROPS.concrete };
  }
  if (kind === "station") {
    const [style, name, color] = rest;
    return { near: drawStation(style, name, color), far: null, sweep: false, backdrop: STATION_BACKDROPS[style] ?? STATION_BACKDROPS.tile };
  }
  if (kind === "platform") {
    const [theme, far, tod, season, variant, sky, name, color] = rest;
    return {
      near: drawPlatformAbove(theme, name, color, tod, season, sky),
      far: drawFar(far, theme, tod, season, Number(variant), sky),
      sweep: false,
      backdrop: skyBackdrop(tod, sky)
    };
  }
  const [theme, near, far, tod, season, variant, sky] = rest;
  return {
    near: drawNear(near, theme, tod, season, Number(variant), sky),
    far: drawFar(far, theme, tod, season, Number(variant), sky),
    sweep: false,
    backdrop: skyBackdrop(tod, sky)
  };
}

const keyOf = (...parts) => parts.map((p) => encodeURIComponent(String(p))).join(":");

/** Draw (once) the textures for a key; resolves to the ready texture. */
function load(key) {
  let entry = cache.get(key);
  if (entry) {
    cache.delete(key);
    cache.set(key, entry);
    return entry.promise;
  }
  entry = {};
  entry.promise = new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
    const drawn = drawKey(key);
    return {
      sweep: drawn.sweep,
      backdrop: drawn.backdrop,
      near: { image: drawn.near, scale: 1, width: drawn.near.width },
      far: drawn.far ? { image: downscale(drawn.far, FAR_SCALE), scale: FAR_SCALE, width: drawn.far.width } : null
    };
  });
  cache.set(key, entry);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return entry.promise;
}

// ---------------------------------------------------------------- choosing the view

/** Time of day from the game clock hour. */
export function timeOfDay(hour) {
  if (hour >= 7 && hour < 17) return "day";
  if ((hour >= 17 && hour < 19) || (hour >= 5 && hour < 7)) return "dusk";
  return "night";
}

/** Season from the month (0 = January): bare trees and snowy roofs December to March. */
export function seasonOf(month) {
  if (month === 11 || month <= 2) return "winter";
  if (month === 9 || month === 10) return "fall";
  return "summer";
}

function conditions({ hour = 12, month = 6, weather } = {}) {
  // Falling snow means snow on the roofs and bare trees, whatever the month.
  return { tod: timeOfDay(hour), season: weather?.precip === "snow" ? "winter" : seasonOf(month), sky: weather?.sky ?? "clear" };
}

function segmentKey(seg, when) {
  const scenery = SCENERY[seg.env] ?? SCENERY["tunnel-concrete"];
  const theme = seg.theme ?? DEFAULT_THEME;
  if (scenery.tunnel) {
    const style = scenery.tunnel === "theme" ? (THEMES[theme] ?? THEMES[DEFAULT_THEME]).tunnel : scenery.tunnel;
    return keyOf("tunnel", style, theme);
  }
  const { tod, season, sky } = conditions(when);
  return keyOf("outdoor", theme, scenery.near, scenery.far, tod, season, hash(`${seg.from}|${seg.to}`) % 3, sky);
}

/** The platform at a stop: underground (tunnel wall) or above ground (canopy over the view). */
function platformKey(trip, stationId, seg, when) {
  const theme = trip.platforms?.[stationId] ?? seg.theme ?? DEFAULT_THEME;
  const name = trip.names[stationId] ?? "Stop";
  const color = trip.lines[seg.line]?.color ?? "#888888";
  if ((trip.platformKinds?.[stationId] ?? "underground") === "underground") {
    return keyOf("station", (THEMES[theme] ?? THEMES[DEFAULT_THEME]).platform, name, color);
  }
  // Above ground the skyline around the station is the one of the stretch the train is on.
  const scenery = SCENERY[seg.env];
  const far = scenery?.far ?? "city";
  const { tod, season, sky } = conditions(when);
  return keyOf("platform", theme, far, tod, season, hash(stationId) % 3, sky, name, color);
}

/** Texture key for the moment: the stretch's surroundings, or the platform when stopping. */
export function sceneryKey(state, trip, when = {}) {
  const seg = trip.segments[state.segmentIndex];
  const atStop = state.phase !== "running" || state.approach > 0.35;
  if (atStop && state.station) return platformKey(trip, state.station, seg, when);
  return segmentKey(seg, when);
}

/** Whether the riders are out in the open (weather shows) for a texture key. */
export function isOutdoors(key) {
  return (key?.startsWith("outdoor:") || key?.startsWith("platform:")) ?? false;
}

/** Every key a trip will need at the given time, in the order it needs them. */
export function tripKeys(trip, when) {
  const keys = [];
  for (const seg of trip.segments) {
    keys.push(platformKey(trip, seg.from, seg, when));
    keys.push(segmentKey(seg, when));
    keys.push(platformKey(trip, seg.to, seg, when));
  }
  return [...new Set(keys)];
}

// ---------------------------------------------------------------- the walls

export class Scenery {
  constructor(stage) {
    this.stage = stage;
    this.key = null;
    this.wanted = null;
    this.front = 0;
    this.texture = null;
    this.previous = null;
    this.fadeStart = 0;
    this.puffs = [];
    this.#build();
  }

  #build() {
    const world = document.createElement("div");
    world.className = "kgt-world";
    this.backdrops = [0, 1].map(() => {
      const el = document.createElement("div");
      el.className = "kgt-backdrop";
      world.append(el);
      return el;
    });
    this.canvas = document.createElement("canvas");
    this.canvas.className = "kgt-walls";
    this.canvas.width = STAGE.w;
    this.canvas.height = STAGE.h;
    this.g = this.canvas.getContext("2d");
    world.append(this.canvas);
    // Rain, snow and fog over the scenery, still under the interior art.
    this.weather = new WeatherLayer();
    world.append(this.weather.fog, this.weather.canvas);
    this.stage.prepend(world);

    this.sweeps = ["left", "right"].map((side) => {
      const el = document.createElement("div");
      el.className = `kgt-sweep ${side}`;
      return el;
    });
    this.world = world;
  }

  /** Layers that go above the interior art (light sweeps, lightning), for the overlay to place. */
  get sweepLayers() {
    return [...this.sweeps, this.weather.flash];
  }

  setWeather(weather, tod) {
    this.weather.set(weather, tod);
    this.tod = tod;
  }

  /**
   * The car interior <img> and its car type. The end door is reused for the car ahead, and a
   * steam car blows engine smoke past the windows. A custom interior gets neither (its door
   * is somewhere else).
   */
  setCar(image, car, builtIn) {
    this.interior = builtIn ? image : null;
    this.car = car;
  }

  /**
   * Draw the rest of the trip's textures ahead of time, one at a time, so the ride never
   * stalls on them. Waits for the first view and the fade-in, then leaves gaps between
   * drawings so the ride keeps animating.
   */
  preload(keys, { delay = 2500, gap = 400 } = {}) {
    let chain = new Promise((r) => setTimeout(r, delay));
    for (const key of keys) chain = chain.then(() => new Promise((r) => setTimeout(r, gap))).then(() => load(key));
    return chain;
  }

  setKey(key) {
    if (key === this.wanted) return;
    this.wanted = key;
    load(key).then((tex) => {
      if (this.wanted === key && this.key !== key) this.#apply(key, tex);
    });
  }

  #apply(key, tex) {
    const first = this.key === null;
    this.key = key;
    this.previous = first ? null : this.texture;
    this.texture = tex;
    this.fadeStart = performance.now();
    this.front = first ? 0 : 1 - this.front;
    const show = this.front;
    const hide = 1 - show;
    for (const el of this.backdrops) el.style.transition = first ? "none" : `opacity ${FADE_MS}ms ease`;
    this.backdrops[show].style.background = tex.backdrop;
    this.backdrops[show].style.opacity = "1";
    this.backdrops[hide].style.opacity = "0";
  }

  /**
   * Draw one wall plane in perspective, a few screen columns at a time. A column at
   * horizontal distance dx from the vanishing point shows the plane at depth
   * z = p * (L / dx - 1), where L is the plane's distance out from the line of sight;
   * the texture is sampled at that depth plus the distance travelled, and scaled by dx / L.
   */
  #drawPlane(layer, { lateral, top }, side, distance, alpha) {
    const g = this.g;
    const { image, scale } = layer;
    const tileW = image.width / scale;
    const tileH = image.height / scale;
    const { vpX, vpY, w } = STAGE;
    g.globalAlpha = alpha;
    const start = side === "left" ? 0 : vpX;
    const end = side === "left" ? vpX : w;
    for (let x = start; x < end; x += COLUMN) {
      const dx = side === "left" ? vpX - (x + COLUMN / 2) : x + COLUMN / 2 - vpX;
      if (dx <= 0) continue;
      const s = Math.min(1, dx / lateral);
      const z = PERSPECTIVE / s - PERSPECTIVE;
      if (z > MAX_DEPTH) continue;
      // Moving forward, scenery comes toward the viewer on both sides; the right wall's
      // texture runs the other way so its signs still read left to right.
      const along = side === "left" ? z + distance : -(z + distance);
      const u = ((along % tileW) + tileW) % tileW;
      const span = Math.max(1, (PERSPECTIVE * lateral / (dx * dx)) * COLUMN);
      const sw = Math.max(1, Math.min(span, tileW - u) * scale);
      g.drawImage(image, u * scale, 0, sw, image.height, x, vpY + (top - vpY) * s, COLUMN, tileH * s);
    }
  }

  #drawWalls(tex, distance, alpha) {
    for (const side of ["left", "right"]) {
      if (tex.far) this.#drawPlane(tex.far, PLANES.far, side, distance, alpha);
      this.#drawPlane(tex.near, PLANES.near, side, distance, alpha);
    }
  }

  /** Scroll the walls to `distance` scenery pixels; `speed` 0 to 1 drives sweeps, smoke and sway. */
  update(distance, speed, now) {
    const g = this.g;
    g.clearRect(0, 0, STAGE.w, STAGE.h);
    if (this.texture) {
      const fade = this.previous ? Math.min(1, (now - this.fadeStart) / FADE_MS) : 1;
      if (fade < 1) this.#drawWalls(this.previous, distance, 1);
      else this.previous = null;
      this.#drawWalls(this.texture, distance, fade);
      g.globalAlpha = 1;
    }
    const dt = Math.min(0.05, Math.max(0, (now - (this.lastFrame ?? now)) / 1000));
    this.lastFrame = now;
    if (this.car?.smoke) this.#drawSmoke(speed, dt);
    this.#drawNextCar(distance, speed, now);

    // Passing tunnel lamps sweep a band of light out across each side of the car.
    const tex = this.texture;
    const phase = tex ? (distance % tex.near.width) / tex.near.width : 0;
    const strength = tex?.sweep ? Math.min(1, speed * 1.2) : 0;
    const [left, right] = this.sweeps;
    const reach = phase * STAGE.vpX * 1.3;
    left.style.opacity = right.style.opacity = String(strength * Math.sin(Math.PI * phase) * 0.55);
    left.style.transform = `translateX(${-reach}px)`;
    right.style.transform = `translateX(${reach}px)`;

    this.#wobble(distance, speed, now);
    this.weather.update(now, dt, speed, isOutdoors(this.key) ? 1 : 0);
  }

  /**
   * Engine smoke and steam: puffs blown back from the locomotive ahead, streaming out past
   * the upper windows on both sides, thickest when the train is pulling away.
   */
  #drawSmoke(speed, dt) {
    const g = this.g;
    const { vpX, vpY, w } = STAGE;
    const accel = Math.max(0, speed - (this.lastSpeed ?? speed)) / Math.max(dt, 0.001);
    this.lastSpeed = speed;
    const rate = (0.6 + speed * 3 + accel * 4) * (speed > 0.02 ? 1 : 0.2);
    this.smokeDebt = (this.smokeDebt ?? 0) + rate * dt * 4;
    while (this.smokeDebt >= 1) {
      this.smokeDebt -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      // Coal smoke (grey to sooty) mixed with white steam.
      const shade = Math.random() < 0.35 ? 215 + Math.random() * 35 : 70 + Math.random() * 90;
      this.puffs.push({ x: vpX + side * (60 + Math.random() * 60), y: vpY - 10 - Math.random() * 110, side, r: 20 + Math.random() * 14, age: 0, life: 3.5 + Math.random() * 2.5, shade });
    }
    const night = this.tod === "night";
    for (const p of this.puffs) {
      p.age += dt;
      const k = p.age / p.life;
      // Drifting back from the engine toward the viewer, speeding up and swelling as they near.
      const out = (30 + 260 * speed) * (0.3 + k * 1.2);
      p.x += p.side * out * dt;
      p.y -= (8 + 24 * k) * dt;
      p.r += (16 + 70 * k) * dt;
      const alpha = Math.max(0, Math.min(1, k * 5) * (1 - k)) * 0.8;
      const tone = night ? Math.round(p.shade * 0.35) : Math.round(p.shade);
      const puff = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      puff.addColorStop(0, `rgba(${tone},${tone},${tone + 4},${alpha})`);
      puff.addColorStop(1, `rgba(${tone},${tone},${tone + 4},0)`);
      g.fillStyle = puff;
      g.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    this.puffs = this.puffs.filter((p) => p.age < p.life && p.x > -200 && p.x < w + 200);
  }

  /**
   * The car ahead, seen through our end door: its end wall and back door (cut from our own
   * art, a little smaller), and through its window a narrow eye-level slice of its lit
   * interior. It rides its own springs, so it sways and bobs a little out of step with ours,
   * and being ahead it takes each rail joint a moment sooner.
   */
  #drawNextCar(distance, speed, now) {
    const img = this.interior;
    const car = this.car;
    if (!img?.complete || !img.naturalWidth || !car?.door) return;
    const n = (this.next ??= { y: 0, vy: 0, r: 0, vr: 0, joint: 0, last: now });
    const dt = Math.min(0.05, Math.max(0, (now - n.last) / 1000));
    n.last = now;
    const joint = Math.floor((distance + CAR_PX) / RAIL_PX);
    if (joint !== n.joint) {
      n.joint = joint;
      n.vy += (8 + 14 * speed) * (0.8 + Math.random() * 0.4);
      n.vr += (Math.random() - 0.5) * (1 + 2 * speed);
    }
    n.vy += (-SPRING.bounce * 0.8 * n.y - SPRING.damp * n.vy) * dt;
    n.y += n.vy * dt;
    n.vr += (-SPRING.roll * n.r - SPRING.damp * 0.8 * n.vr) * dt;
    n.r += n.vr * dt;
    const sway = Math.sin(now / 820 + 1.3) * 2.6 * speed + n.r * 2.5;

    const g = this.g;
    const s = NEXT_CAR_SCALE;
    const { door, win } = car;
    const cx = win.x + win.w / 2;
    const cy = win.y + win.h / 2;
    const doorX = -(cx - door.x) * s;
    const doorY = -(cy - door.y) * s;
    g.save();
    g.beginPath();
    g.rect(door.x, door.y, door.w, door.h);
    g.clip();
    g.translate(cx + sway, cy + n.y);
    g.rotate(n.r * 0.004);
    const wall = g.createLinearGradient(-130, 0, 130, 0);
    wall.addColorStop(0, "#2a2826");
    wall.addColorStop(0.5, "#5e5850");
    wall.addColorStop(1, "#2a2826");
    g.fillStyle = wall;
    g.fillRect(-130, -190, 260, 380);
    g.strokeStyle = "#141210";
    g.lineWidth = 10;
    g.strokeRect(-122, -182, 244, 364);
    const wx = doorX + (win.x - door.x) * s;
    const wy = doorY + (win.y - door.y) * s;
    const ww = win.w * s;
    const wh = win.h * s;
    g.save();
    g.beginPath();
    g.rect(wx, wy, ww, wh);
    g.clip();
    // Through two eye-level windows only a slice of that car shows: lights, seat tops, far end.
    const tiny = wh / INTERIOR_SHOWN;
    g.drawImage(img, wx + ww / 2 - STAGE.vpX * tiny, wy + wh * 0.62 - STAGE.vpY * tiny, STAGE.w * tiny, STAGE.h * tiny);
    g.restore();
    g.drawImage(img, door.x, door.y, door.w, door.h, doorX, doorY, door.w * s, door.h * s);
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(doorX, doorY, door.w * s, door.h * s);
    g.restore();
  }

  /**
   * Soft suspension: two damped springs (bounce and roll) kicked by rail joints passing
   * at the train's speed and by random bumps, plus a lean when speeding up or braking.
   */
  #wobble(distance, speed, now) {
    const w = (this.wobble ??= { y: 0, vy: 0, r: 0, vr: 0, lean: 0, last: now, joint: 0, speed: 0 });
    const dt = Math.min(0.05, Math.max(0, (now - w.last) / 1000));
    w.last = now;
    if (!dt) return;
    const joint = Math.floor(distance / RAIL_PX);
    if (joint !== w.joint) {
      w.joint = joint;
      const kick = 10 + 16 * speed;
      w.vy += kick * (0.8 + Math.random() * 0.4);
      w.vr += (Math.random() - 0.5) * kick * 0.06;
      setTimeout(() => { if (this.wobble) this.wobble.vy += kick * 0.6; }, 140);
    }
    if (Math.random() < dt * 1.5 * speed) {
      w.vy += (Math.random() - 0.3) * 22 * speed;
      w.vr += (Math.random() - 0.5) * 1.6 * speed;
    }
    w.vy += (-SPRING.bounce * w.y - SPRING.damp * w.vy) * dt;
    w.y += w.vy * dt;
    w.vr += (-SPRING.roll * w.r - SPRING.damp * 0.8 * w.vr) * dt;
    w.r += w.vr * dt;
    const accel = (speed - w.speed) / dt;
    w.speed = speed;
    w.lean += (Math.max(-1, Math.min(1, accel * 6)) - w.lean) * Math.min(1, dt * 2);
    const sway = Math.sin(now / 900) * 2.2 * speed;
    this.stage.style.setProperty("--sway-x", `${(sway + w.r * 3).toFixed(2)}px`);
    this.stage.style.setProperty("--sway-y", `${(w.y + w.lean * 4).toFixed(2)}px`);
    this.stage.style.setProperty("--roll", `${(w.r * 0.12).toFixed(3)}deg`);
  }
}

/** How much smaller the car ahead's door looks, and how much of its interior shows. */
const NEXT_CAR_SCALE = 0.6;
const INTERIOR_SHOWN = 450;
/** How far ahead the next car runs, and the scenery pixels between rail joints. */
const CAR_PX = 900;
const RAIL_PX = 1100;
const SPRING = { bounce: 55, roll: 30, damp: 4.5 };
