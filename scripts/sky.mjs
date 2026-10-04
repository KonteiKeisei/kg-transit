// The sky around a plane in flight, on a 2D canvas: the colour of the hour, clouds drifting past
// at three depths, rain or snow streaking by at airspeed, fog, lightning. Used behind the cabin
// windows (the booking preview) and around the side view during the flight. Weather is
// KG Transit's ride weather (weather.mjs rideWeather). No Foundry.

/** Sky colours, top to horizon, by the time of day; the cloudier, the greyer. */
const SKIES = {
  day: { clear: ["#3f86d8", "#a9cff2"], grey: ["#7f8a98", "#c1c8d1"], storm: ["#3e4652", "#79818c"] },
  dusk: { clear: ["#33406e", "#f0a36a"], grey: ["#4a4a5e", "#a48a82"], storm: ["#2a2c38", "#5e5660"] },
  night: { clear: ["#070d22", "#1f3360"], grey: ["#11161f", "#2a313d"], storm: ["#07090d", "#191d24"] }
};

export const timeOfDay = (hour) => (hour >= 7 && hour < 18 ? "day" : (hour >= 5 && hour < 7) || (hour >= 18 && hour < 20) ? "dusk" : "night");

/** How rough the air is, 0 (smooth) to 1 (thunderstorm), from the ride weather. */
export function turbulence(wx) {
  const sky = { clear: 0.05, partly: 0.12, cloudy: 0.2, overcast: 0.22, storm: 0.55 }[wx?.sky] ?? 0.08;
  return Math.min(1, sky + (wx?.precip ? 0.15 * (wx.intensity ?? 0.5) : 0) + (wx?.wind ?? 0) * 0.06 + (wx?.lightning ? 0.25 : 0));
}

const mix = (a, b, t) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
};

export class SkyPainter {
  /**
   * canvas: drawn on at its own size. drift: the way the sky moves past, +1 to the right (the
   * plane flies left, nose to the left) or -1. fill: paint the sky colour (false over a backdrop
   * that already has one, such as Calendaria's cinematic).
   */
  constructor(canvas, { drift = 1, fill = true } = {}) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.drift = drift;
    this.fill = fill;
    this.weather = { sky: "clear", precip: null, intensity: 0, fog: 0, wind: 0 };
    this.tod = "day";
    this.clouds = [];
    this.particles = [];
    this.flash = 0;
    this.nextBolt = 0;
  }

  set({ hour = 12, weather } = {}) {
    this.tod = timeOfDay(hour);
    if (weather) this.weather = weather;
  }

  /** The sky's two colours now, top and horizon. */
  palette() {
    const wx = this.weather;
    const grey = wx.sky === "storm" ? "storm" : ["cloudy", "overcast"].includes(wx.sky) ? "grey" : "clear";
    return SKIES[this.tod][grey];
  }

  /** More clouds the cloudier it is; storm clouds dark. */
  #cloudTarget() {
    return { clear: 4, partly: 9, cloudy: 15, overcast: 22, storm: 24 }[this.weather.sky] ?? 6;
  }

  #spawnCloud(w, h, anywhere) {
    const z = [0.35, 0.65, 1][Math.floor(Math.random() * 3)];
    const r = (50 + Math.random() * 110) * z * (h / 600);
    return {
      x: anywhere ? Math.random() * w : this.drift > 0 ? -r * 3 : w + r * 3,
      y: h * (0.15 + Math.random() * 0.8),
      r, z, puffs: Array.from({ length: 4 + Math.floor(Math.random() * 4) }, () => [Math.random() * 2.4 - 1.2, Math.random() * 0.6 - 0.3, 0.55 + Math.random() * 0.5])
    };
  }

  /** speed: 0 to 1 (how fast the sky goes by). */
  draw(now, dt, speed = 1) {
    const { canvas, g } = this;
    const w = canvas.width, h = canvas.height;
    const wx = this.weather;
    g.clearRect(0, 0, w, h);
    const grey = wx.sky === "storm" ? "storm" : ["cloudy", "overcast"].includes(wx.sky) ? "grey" : "clear";
    const pal = SKIES[this.tod][grey];
    if (this.fill) {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, pal[0]);
      grad.addColorStop(1, pal[1]);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }

    // Clouds: far ones small and slow, near ones big and quick.
    const target = this.#cloudTarget();
    while (this.clouds.length < target) this.clouds.push(this.#spawnCloud(w, h, true));
    if (this.clouds.length > target) this.clouds.length = target;
    const lit = this.tod === "day" ? 1 : this.tod === "dusk" ? 0.7 : 0.25;
    const base = wx.sky === "storm" ? 0.35 : grey === "grey" ? 0.7 : 1;
    for (const c of this.clouds) {
      c.x += this.drift * speed * (60 + 340 * c.z) * dt * (w / 1200);
      if (c.x - c.r * 3 > w || c.x + c.r * 3 < 0) Object.assign(c, this.#spawnCloud(w, h, false));
      const v = Math.round(255 * Math.min(1, base * lit + 0.05));
      const shade = this.tod === "dusk" && grey === "clear" ? `rgba(255,${Math.round(v * 0.85)},${Math.round(v * 0.75)},` : `rgba(${v},${v},${Math.min(255, v + 8)},`;
      for (const [dx, dy, k] of c.puffs) {
        const x = c.x + dx * c.r, y = c.y + dy * c.r, r = c.r * k;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `${shade}${0.5 * (0.5 + 0.5 * c.z)})`);
        grad.addColorStop(1, `${shade}0)`);
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Rain or snow, streaking back past the plane.
    const snow = wx.precip === "snow";
    const amount = wx.precip ? Math.max(0.15, wx.intensity ?? 0.5) : 0;
    const want = Math.round(amount * (snow ? 500 : 420) * (w * h) / (1200 * 700));
    while (this.particles.length < want) this.particles.push({ x: Math.random() * w, y: Math.random() * h, z: 0.3 + Math.random() * 0.7 });
    if (this.particles.length > want) this.particles.length = want;
    const vx = this.drift * speed * (snow ? 900 : 1500) * (w / 1200), vy = snow ? 160 : 520;
    g.lineCap = "round";
    for (const p of this.particles) {
      p.x += vx * p.z * dt;
      p.y += vy * p.z * dt;
      if (p.x > w + 30) p.x -= w + 60;
      if (p.x < -30) p.x += w + 60;
      if (p.y > h + 30) p.y -= h + 60;
      if (snow) {
        g.fillStyle = `rgba(245,248,255,${0.4 + 0.5 * p.z})`;
        g.beginPath();
        g.arc(p.x, p.y, 1 + 2.4 * p.z, 0, Math.PI * 2);
        g.fill();
      } else {
        g.strokeStyle = `rgba(205,215,232,${0.15 + 0.35 * p.z})`;
        g.lineWidth = 0.8 + 1.2 * p.z;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - vx * p.z * 0.03, p.y - vy * p.z * 0.03);
        g.stroke();
      }
    }

    // Haze, and lightning: a double flicker every so often.
    if (wx.fog) {
      g.fillStyle = this.tod === "night" ? `rgba(20,24,30,${wx.fog * 0.5})` : `rgba(200,206,214,${wx.fog * 0.45})`;
      g.fillRect(0, 0, w, h);
    }
    if (wx.lightning) {
      if (!this.nextBolt) this.nextBolt = now + 2500 + Math.random() * 6000;
      if (now >= this.nextBolt) {
        this.flash = 1;
        setTimeout(() => { this.flash = 0.8; }, 160);
        this.nextBolt = now + 4000 + Math.random() * 9000;
      }
    }
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.flash > 0) {
      g.fillStyle = `rgba(235,240,255,${this.flash * 0.55})`;
      g.fillRect(0, 0, w, h);
    }
  }
}

/** The colour of the sky at the horizon (for page backdrops that should match). */
export function horizon(hour, weather) {
  const grey = weather?.sky === "storm" ? "storm" : ["cloudy", "overcast"].includes(weather?.sky) ? "grey" : "clear";
  const [top, bottom] = SKIES[timeOfDay(hour)][grey];
  return { top, bottom, mid: mix(top, bottom, 0.5) };
}
