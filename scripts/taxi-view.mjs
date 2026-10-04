// The airport out of the cabin windows while the plane taxis, and the takeoff. A 2D canvas behind
// the cabin art (its windows are transparent). No Foundry.
//
// The view is drawn in perspective, as a seat sees it: looking out of the right side of the plane
// and a little forward, so the taxiway and the runway run away towards the front and everything
// beside them (edge lights, signs, markings, hangars, the terminal and its parked planes, the city
// far off) comes out of the distance ahead and sweeps back past the window. World units are
// metres: x to the right of the plane, y up, z forward along its path. The takeoff
// (takeoffState) runs the plane down the runway faster and faster, lifts the nose and climbs, the
// ground dropping away below the windows until there is only sky.

import { SkyPainter, timeOfDay } from "./sky.mjs";

/** How long the takeoff takes, in seconds: the roll, the nose coming up, the climb. */
export const TAKEOFF_SECONDS = 20;
const ROTATE_AT = 13;
/** Ground speeds, in metres a second. */
export const TAXI_SPEED = 8;
const LIFTOFF_SPEED = 80;
/** The landing rollout at the start of taxiing in, in seconds. */
export const ROLLOUT_SECONDS = 12;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };

/**
 * The plane `t` seconds into its takeoff: { speed (m/s), pitch (radians, nose up), climb (0 on
 * the ground to 1 when only sky shows), power (0 idle to 1 full thrust), runway (on the runway) }.
 * Before the takeoff (t < 0) it is taxiing.
 */
export function takeoffState(t) {
  if (t < 0) return { speed: TAXI_SPEED, pitch: 0, climb: 0, power: 0.25, runway: false };
  const roll = clamp01(t / ROTATE_AT);
  const speed = TAXI_SPEED + (LIFTOFF_SPEED - TAXI_SPEED) * roll ** 1.7 + Math.max(0, t - ROTATE_AT) * 3;
  const pitch = smooth((t - ROTATE_AT) / 2.2) * (9 * Math.PI) / 180;
  const climb = smooth((t - ROTATE_AT - 0.8) / (TAKEOFF_SECONDS - ROTATE_AT - 0.8)) ** 1.15;
  return { speed, pitch, climb, power: Math.min(1, 0.25 + t * 0.6), runway: true };
}

/**
 * Taxiing in: the landing rollout slowing to taxi speed over its first seconds, then taxiing,
 * rolling to a stop at the gate as the step ends. `t`: seconds into the step; `left`: seconds to
 * its end (Infinity when unknown).
 */
export function taxiInState(t, left = Infinity) {
  const roll = clamp01(t / ROLLOUT_SECONDS);
  const rolling = t < ROLLOUT_SECONDS;
  const speed = LIFTOFF_SPEED * 0.75 * (1 - smooth(roll)) + TAXI_SPEED * smooth(roll);
  return { speed: speed * (rolling ? 1 : clamp01(left / 8)), pitch: 0, climb: 0, power: rolling ? 0.6 * (1 - roll) + 0.25 : 0.25, runway: rolling };
}

/** The cabin art (cabin.webp, 1589 x 990): the middle of its big window, as a share of the picture. */
const CABIN = { w: 1589, h: 990, windowX: 0.84, windowY: 0.47 };

/**
 * Where the view looks from when the cabin art covers a w x h canvas (object-fit: cover): the big
 * window's middle on the canvas, and a lens to match the picture's scale.
 */
export function cabinFrame(w, h) {
  const k = Math.max(w / CABIN.w, h / CABIN.h);
  return {
    cx: (w - CABIN.w * k) / 2 + CABIN.windowX * CABIN.w * k,
    cy: (h - CABIN.h * k) / 2 + CABIN.windowY * CABIN.h * k,
    f: 0.55 * CABIN.h * k
  };
}

/** A repeatable random number for item i of a row. */
const rand = (i, salt) => {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** How far ahead the view reaches, in metres. */
const FAR = 4000;
/** The window seat: how far right of the plane's middle, and how far the view is turned forward of straight out. */
const SEAT_X = 3;
const LOOK = (50 * Math.PI) / 180;

export class TaxiView {
  /** canvas: drawn on at its own size. planes: side-view plane images for the gates (may be empty). */
  constructor(canvas, planes = []) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.sky = new SkyPainter(canvas, { drift: 1, fill: true });
    this.planes = planes;
    this.z = 0;
    this.hour = 12;
  }

  set({ hour = this.hour, weather } = {}) {
    this.hour = hour;
    this.sky.set({ hour, weather });
  }

  /**
   * One frame: the plane moving at `state` (takeoffState / taxiInState). `frame`: where the view
   * looks from on the canvas, { cx, cy, f } (the big window's middle and the lens), or the
   * window's place when the cabin art fills the canvas (cabinFrame).
   */
  draw(now, dt, state, frame = cabinFrame(this.canvas.width, this.canvas.height)) {
    const { canvas, g } = this;
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return;
    this.z += state.speed * dt;
    this.sky.draw(now, dt, 0.05 + state.speed / 300);
    if (state.climb >= 1) return;

    const tod = timeOfDay(this.hour);
    const night = tod === "night" ? 1 : tod === "dusk" ? 0.45 : 0;
    // The camera: the window seat, its eye rising as the plane climbs; centred on the big window.
    const eye = 6 + 500 * state.climb ** 2.2;
    const { f, cx, cy } = frame;
    const S = Math.sin(LOOK), C = Math.cos(LOOK);
    const z0 = this.z;
    const project = (x, y, z) => {
      const dx = x - SEAT_X, dz = z - z0;
      const depth = dx * S + dz * C;
      if (depth < 1) return null;
      return { x: cx + (f * (dx * C - dz * S)) / depth, y: cy - (f * (y - eye)) / depth, depth };
    };
    this.lens = f;
    const shade = (r, gg, b) => `rgb(${Math.round(r * (1 - 0.8 * night))},${Math.round(gg * (1 - 0.8 * night))},${Math.round(b * (1 - 0.75 * night))})`;

    g.save();
    // Nose up: seen out of the right side the horizon tips down towards the front; climbing, the
    // nose stays up and the ground sinks out of the bottom of the window.
    g.translate(cx, cy);
    g.rotate(-state.pitch * 0.7);
    g.translate(-cx, -cy + f * Math.tan(state.pitch * 0.3 + state.climb ** 1.5 * 0.68));

    // Grass from the horizon down.
    const grass = g.createLinearGradient(0, cy, 0, h * 1.5);
    grass.addColorStop(0, shade(150, 158, 148));
    grass.addColorStop(0.06, shade(104, 128, 84));
    grass.addColorStop(1, shade(80, 110, 60));
    g.fillStyle = grass;
    g.fillRect(-w, cy, w * 3, h * 3);

    this.#city(g, project, night, z0);
    this.#buildings(g, project, night, z0, shade);
    // The other strip of pavement across the grass (the runway while taxiing, a taxiway on the runway).
    const across = state.runway ? { a: 150, b: 172, edge: "90,150,255", line: false } : { a: 120, b: 165, edge: "255,246,220", line: true };
    this.#strip(g, project, across.a, across.b, z0, shade(98, 98, 100));
    if (across.line) this.#dashes(g, project, (across.a + across.b) / 2, 36, 60, z0, shade(232, 232, 226));
    this.#lightRow(g, project, across.a - 1, 60, z0, across.edge, night, state, 0.5);
    this.#lightRow(g, project, across.b + 1, 60, z0, across.edge, night, state, 0.5);
    // The pavement the plane is on, to its edge line and lights: yellow and blue on a taxiway,
    // white on the runway, with its markings rushing by.
    const edge = state.runway ? 24 : 16;
    this.#strip(g, project, -60, edge, z0, shade(122, 122, 120));
    this.#strip(g, project, edge - 0.35, edge + 0.35, z0, state.runway ? "rgba(240,240,236,0.95)" : "rgba(232,196,40,0.95)");
    if (state.runway) this.#dashes(g, project, 12, 30, 90, z0, shade(236, 236, 232), 1.6);
    this.#lightRow(g, project, edge + 2, state.runway ? 60 : 30, z0, state.runway ? "255,248,226" : "90,150,255", night, state, 0.4);
    this.#signs(g, project, edge + 5, z0, state.runway);
    g.restore();
  }

  /** Item indexes of a row spaced `gap` metres apart, from just behind the window to the far distance. */
  #range(gap, z0, salt, fn) {
    const first = Math.floor((z0 - 80) / gap), last = Math.ceil((z0 + FAR) / gap);
    // Far to near, so nearer things paint over farther ones.
    for (let i = last; i >= first; i--) fn(i, i * gap + (salt ? rand(i, salt) * gap * 0.5 : 0));
  }

  /** A strip of ground from x = a to x = b, running ahead from beside the window. */
  #strip(g, project, a, b, z0, fill) {
    // Start where both edges are in front of the camera.
    const start = z0 + Math.max(...[a, b].map((x) => (2 - (x - SEAT_X) * Math.sin(LOOK)) / Math.cos(LOOK)));
    const pts = [project(a, 0, start), project(a, 0, z0 + FAR), project(b, 0, z0 + FAR), project(b, 0, start)];
    if (pts.some((p) => !p)) return;
    g.fillStyle = fill;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.fill();
  }

  /** Painted dashes along x, `len` metres long every `gap`. */
  #dashes(g, project, x, len, gap, z0, fill, wide = 0.9) {
    g.fillStyle = fill;
    this.#range(gap, z0, 0, (i, z) => {
      const p = [project(x - wide / 2, 0, z), project(x - wide / 2, 0, z + len), project(x + wide / 2, 0, z + len), project(x + wide / 2, 0, z)];
      if (p.some((q) => !q)) return;
      g.beginPath();
      p.forEach((q, k) => (k ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
      g.fill();
    });
  }

  /** A row of lights at x, glowing at night, streaking as they rush past. */
  #lightRow(g, project, x, gap, z0, rgb, night, state, height) {
    this.#range(gap, z0, 0, (i, z) => {
      const p = project(x, height, z);
      if (!p) return;
      const r = Math.max(0.8, Math.min(7, (0.16 * this.lens) / p.depth));
      // The streak: where the light was a moment ago (it moves back, away from the front).
      const back = project(x, height, z + Math.min(state.speed * 0.05, 8));
      if (night > 0.2) {
        const glow = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 6);
        glow.addColorStop(0, `rgba(${rgb},${0.55 * night})`);
        glow.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = glow;
        g.fillRect(p.x - r * 6, p.y - r * 6, r * 12, r * 12);
      }
      g.strokeStyle = `rgba(${rgb},${0.75 + 0.25 * night})`;
      g.lineWidth = r * 2;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(back?.x ?? p.x, back?.y ?? p.y);
      g.lineTo(p.x + 0.01, p.y);
      g.stroke();
    });
  }

  /** Signs beside the pavement: black and yellow taxiway signs, distance left on the runway. */
  #signs(g, project, x, z0, runway) {
    this.#range(450, z0, 21, (i, z) => {
      if (rand(i, 20) < 0.4) return;
      const a = project(x, 0, z), b = project(x, 1.4, z), c = project(x, 1.4, z + 2.4);
      if (!a || !b || !c) return;
      const tall = a.y - b.y, wide = Math.abs(c.x - b.x) || tall * 1.6;
      if (tall < 1) return;
      g.fillStyle = runway ? "#151515" : "#e8c428";
      g.fillRect(Math.min(b.x, c.x), b.y - tall * 0.2, Math.max(wide, tall * 1.6), tall * 0.9);
      g.fillStyle = runway ? "#ffffff" : "#151515";
      g.font = `bold ${Math.max(6, Math.round(tall * 0.6))}px Arial, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(runway ? String(1 + (Math.abs(i) % 9)) : ["A", "B", "C", "K", "M"][Math.abs(i) % 5] + (Math.abs(i) % 3 + 1),
        Math.min(b.x, c.x) + Math.max(wide, tall * 1.6) / 2, b.y + tall * 0.25);
    });
  }

  /** The city far off on the horizon: towers in a bluish haze, a few windows lit at night. */
  #city(g, project, night, z0) {
    const x = 6000;
    this.#range(160, z0 - 4000, 3, (i, z) => {
      if (rand(i, 1) < 0.3) return;
      const tall = 30 + rand(i, 2) ** 2.2 * 220, len = 40 + rand(i, 3) * 80;
      const a = project(x, 0, z), b = project(x, tall, z + len);
      if (!a || !b) return;
      g.fillStyle = night ? "rgba(26,30,44,0.95)" : "rgba(122,136,158,0.75)";
      g.fillRect(Math.min(a.x, b.x), b.y, Math.abs(b.x - a.x) + 1, a.y - b.y);
    });
  }

  /** Hangars, the terminal with planes parked at its gates, a control tower now and then. */
  #buildings(g, project, night, z0, shade) {
    const x = 420;
    this.#range(300, z0, 0, (i, z) => {
      const kind = rand(i, 10);
      const box = (len, tall, fill) => {
        const a = project(x, 0, z), b = project(x, tall, z + len);
        if (!a || !b) return null;
        g.fillStyle = fill;
        g.fillRect(Math.min(a.x, b.x), b.y, Math.abs(b.x - a.x) + 1, a.y - b.y);
        return { left: Math.min(a.x, b.x), top: b.y, wide: Math.abs(b.x - a.x), tall: a.y - b.y };
      };
      if (kind < 0.3) {
        // A hangar, its big doors darker.
        const r = box(90 + rand(i, 11) * 60, 22 + rand(i, 12) * 10, shade(176, 178, 176));
        if (r) { g.fillStyle = shade(118, 122, 124); g.fillRect(r.left + r.wide * 0.12, r.top + r.tall * 0.3, r.wide * 0.76, r.tall * 0.7); }
      } else if (kind < 0.8) {
        // The terminal: long and low, a band of glass, lit at night.
        const r = box(220, 14 + rand(i, 13) * 6, shade(196, 190, 176));
        if (r) {
          g.fillStyle = night > 0.4 ? "rgba(255,220,150,0.85)" : shade(70, 96, 120);
          g.fillRect(r.left, r.top + r.tall * 0.3, r.wide, r.tall * 0.32);
        }
        // A plane parked at a gate, on the apron in front.
        const plane = this.planes.length ? this.planes[Math.floor(rand(i, 14) * this.planes.length)] : null;
        const p = plane && rand(i, 15) < 0.75 ? project(x - 60, 0, z + 110) : null;
        if (p) {
          const pw = (55 * this.lens) / p.depth, ph = (pw * plane.height) / plane.width;
          g.save();
          if (night) g.filter = `brightness(${(1 - 0.6 * night).toFixed(2)})`;
          g.drawImage(plane, p.x - pw / 2, p.y - ph * 0.92, pw, ph);
          g.restore();
        }
      } else if (kind < 0.9) {
        // The control tower: a shaft and a glass cab.
        const a = project(x, 0, z), top = project(x, 45, z), cabTop = project(x, 52, z);
        if (!a || !top || !cabTop) return;
        const s = this.lens / a.depth;
        g.fillStyle = shade(186, 184, 178);
        g.fillRect(a.x - 3 * s, top.y, 6 * s, a.y - top.y);
        g.fillStyle = night > 0.4 ? "rgba(160,220,200,0.9)" : shade(64, 92, 104);
        g.fillRect(a.x - 7 * s, cabTop.y, 14 * s, top.y - cabTop.y);
      }
    });
  }
}
