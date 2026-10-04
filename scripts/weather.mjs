// Weather for the ride, read from Calendaria: cloud cover for the sky, rain or snow
// falling past the windows (and running across the glass), fog, and lightning.

import { STAGE_SIZE } from "./scenery-art.mjs";

/**
 * The weather as the ride needs it:
 *   sky: "clear" | "partly" | "cloudy" | "overcast" | "storm"
 *   precip: null | "rain" | "snow", intensity 0 to 1, fog 0 to 1, wind 0 to 5, lightning
 */
const PRESETS = {
  clear: { sky: "clear" },
  "heat-wave": { sky: "clear", fog: 0.2 },
  windy: { sky: "partly", wind: 3 },
  "partly-cloudy": { sky: "partly" },
  cloudy: { sky: "cloudy" },
  overcast: { sky: "overcast" },
  mist: { sky: "overcast", fog: 0.45 },
  fog: { sky: "overcast", fog: 0.75 },
  "rolling-fog": { sky: "overcast", fog: 0.85 },
  drizzle: { sky: "overcast", precip: "rain", intensity: 0.2 },
  sunshower: { sky: "partly", precip: "rain", intensity: 0.3 },
  rain: { sky: "storm", precip: "rain", intensity: 0.6, wind: 2 },
  sleet: { sky: "storm", precip: "rain", intensity: 0.5, wind: 2, sleet: true },
  hail: { sky: "storm", precip: "rain", intensity: 0.7, wind: 3, sleet: true },
  "ice-storm": { sky: "storm", precip: "rain", intensity: 0.8, wind: 4, sleet: true },
  thunderstorm: { sky: "storm", precip: "rain", intensity: 0.9, wind: 4, lightning: true },
  monsoon: { sky: "storm", precip: "rain", intensity: 1, wind: 4 },
  hurricane: { sky: "storm", precip: "rain", intensity: 1, wind: 5 },
  tornado: { sky: "storm", precip: "rain", intensity: 0.8, wind: 5, lightning: true },
  snow: { sky: "overcast", precip: "snow", intensity: 0.5, wind: 1 },
  "permafrost-surge": { sky: "overcast", precip: "snow", intensity: 0.4, wind: 3 },
  blizzard: { sky: "storm", precip: "snow", intensity: 1, wind: 5, fog: 0.35 }
};

const CLEAR = { sky: "clear", precip: null, intensity: 0, fog: 0, wind: 0, lightning: false };

/** Fog colour by time of day: pale by day, dim and dark at night. */
const FOG = {
  day: "linear-gradient(#c3c9cf, #a9b0b6)",
  dusk: "linear-gradient(#8a7a80, #6a5e64)",
  night: "linear-gradient(#20242c, #15181e)"
};

/** Turn a Calendaria weather record (or a preset id) into the ride's weather. */
export function rideWeather(record) {
  if (!record) return CLEAR;
  const id = typeof record === "string" ? record : record.id;
  const known = PRESETS[id];
  if (known) return { ...CLEAR, ...known };
  // Custom or unknown presets: fall back on what the record says about rain and clouds.
  const p = record.precipitation ?? {};
  const type = p.type === "snow" ? "snow" : p.type ? "rain" : null;
  const hud = record.hudEffect ?? "";
  const sky = type ? (p.intensity > 0.5 ? "storm" : "overcast")
    : hud === "clouds-light" ? "partly" : hud === "clouds-heavy" ? "cloudy" : hud === "clouds-overcast" ? "overcast" : "clear";
  return { ...CLEAR, sky, precip: type, intensity: p.intensity ?? 0, wind: record.wind?.speed ?? 0, fog: hud === "fog" ? 0.6 : 0 };
}

/** Calendaria's current weather for the active scene, if Calendaria is running. */
export function currentWeather() {
  try {
    return rideWeather(globalThis.CALENDARIA?.api?.getCurrentWeather?.());
  } catch {
    return CLEAR;
  }
}

/**
 * Rain or snow falling past the windows, drops on the glass, fog and lightning. One canvas
 * in stage coordinates sits over the scenery and under the interior art, so it only shows
 * through the windows; the lightning flash sits over the interior too.
 */
export class WeatherLayer {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "kgt-weather";
    this.canvas.width = STAGE_SIZE.w;
    this.canvas.height = STAGE_SIZE.h;
    this.g = this.canvas.getContext("2d");
    this.fog = document.createElement("div");
    this.fog.className = "kgt-fog";
    this.flash = document.createElement("div");
    this.flash.className = "kgt-flash";
    this.weather = CLEAR;
    this.particles = [];
    this.drops = [];
    this.outdoors = 0;
    this.nextBolt = 0;
    this.flashLevel = 0;
  }

  set(weather, tod = "day") {
    this.weather = weather;
    this.fog.style.background = FOG[tod] ?? FOG.day;
  }

  /** `outdoors` 0 to 1 (eased by the caller), `speed` 0 to 1. */
  update(now, dt, speed, outdoors) {
    const wx = this.weather;
    this.outdoors += (outdoors - this.outdoors) * Math.min(1, dt * 1.5);
    const amount = this.outdoors * (wx.precip ? Math.max(0.12, wx.intensity) : 0);
    const { w, h, vpX } = STAGE_SIZE;
    const g = this.g;
    g.clearRect(0, 0, w, h);

    // Falling rain or snow. Moving forward, it streams outward from the end of the car.
    const target = Math.round(amount * (wx.precip === "snow" ? 1100 : 760));
    while (this.particles.length < target) this.particles.push(this.#spawn(true));
    if (this.particles.length > target) this.particles.length = target;
    const snow = wx.precip === "snow";
    const gust = wx.wind * 40;
    g.lineCap = "round";
    for (const p of this.particles) {
      const out = p.x < vpX ? -1 : 1;
      const vx = (out * speed * (snow ? 520 : 900) + gust) * p.z + (snow ? Math.sin(now / 500 + p.seed) * 30 : 0);
      const vy = (snow ? 90 + 40 * wx.intensity : 1300) * p.z;
      p.x += vx * dt;
      p.y += vy * dt;
      p.age += dt;
      // Out the bottom: back in at the top. Out the side (the train carries it past
      // faster than it falls): back in anywhere, fading in, so every window stays full.
      if (p.y > h) Object.assign(p, this.#spawn(false));
      else if (p.x < -40 || p.x > w + 40) Object.assign(p, this.#spawn(true));
      const fadeIn = Math.min(1, p.age / 0.4);
      if (snow) {
        g.fillStyle = `rgba(250,252,255,${(0.55 + 0.4 * p.z) * fadeIn})`;
        g.beginPath();
        g.arc(p.x, p.y, 1.4 + 3.2 * p.z, 0, Math.PI * 2);
        g.fill();
      } else {
        g.strokeStyle = wx.sleet && p.seed > 4 ? `rgba(235,240,250,${0.5 * p.z * fadeIn})` : `rgba(200,212,230,${(0.18 + 0.3 * p.z) * fadeIn})`;
        g.lineWidth = 0.8 + 1.4 * p.z;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - vx * 0.022, p.y - vy * 0.022);
        g.stroke();
      }
    }

    // Raindrops on the glass, sliding back along the car as it moves.
    const dropTarget = wx.precip === "rain" ? Math.round(this.outdoors * 70 * Math.max(0.3, wx.intensity)) : 0;
    while (this.drops.length < dropTarget) this.drops.push({ x: Math.random() * w, y: Math.random() * h * 0.6 + h * 0.12, r: 1.5 + Math.random() * 3, life: Math.random() });
    if (this.drops.length > dropTarget) this.drops.length = dropTarget;
    for (const d of this.drops) {
      const out = d.x < vpX ? -1 : 1;
      const run = speed * 160 * (0.6 + d.r / 5);
      d.x += out * run * dt;
      d.y += (12 + 20 * speed) * dt;
      if (d.x < 0 || d.x > w || d.y > h * 0.75) Object.assign(d, { x: vpX + (Math.random() - 0.5) * w, y: Math.random() * h * 0.6 + h * 0.12 });
      g.strokeStyle = "rgba(220,230,245,0.28)";
      g.lineWidth = d.r * 0.8;
      g.beginPath();
      g.moveTo(d.x, d.y);
      g.lineTo(d.x - out * run * 0.12, d.y - 3);
      g.stroke();
      g.fillStyle = "rgba(235,242,255,0.55)";
      g.beginPath();
      g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      g.fill();
    }

    // Fog thickens with the weather, only outdoors.
    this.fog.style.opacity = String(this.outdoors * Math.min(0.85, wx.fog + (wx.sky === "storm" ? 0.12 : 0)));

    // Lightning: a double flicker every so often.
    if (wx.lightning && this.outdoors > 0.5) {
      if (!this.nextBolt) this.nextBolt = now + 4000 + Math.random() * 9000;
      if (now >= this.nextBolt) {
        this.flashLevel = 1;
        setTimeout(() => { this.flashLevel = 0.8; }, 180);
        this.nextBolt = now + 5000 + Math.random() * 12000;
      }
    }
    this.flashLevel = Math.max(0, this.flashLevel - dt * 4);
    this.flash.style.opacity = String(this.flashLevel * 0.7);
  }

  #spawn(anywhere) {
    const { w, h } = STAGE_SIZE;
    return {
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : -20 - Math.random() * 80,
      z: 0.3 + Math.random() * 0.7,
      seed: Math.random() * 6.28,
      age: anywhere ? 0 : 1
    };
  }
}
