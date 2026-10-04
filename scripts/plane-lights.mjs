// A plane's lights at night, over its side view (plane-show.mjs): the cabin windows lit warm,
// the red navigation light on the near (left) wingtip and the white one on the tail, the red
// anti-collision beacons flashing on top and underneath, the white strobes double-flashing on
// the wingtip and tail, and the logo light washing the fin. They fade in through dusk.
//
// Where they go is read from the art once: the windows are the small dark blobs in rows along
// the fuselage (so a GM's own liveries light up too), the beacons sit on the fuselage's top and
// bottom lines, the tail light at the tail cone. Only the wingtip is set by hand, per plane.

/** The near wingtip, as a share of the art's width and height (nose to the left). */
const WINGTIP = {
  "747": [0.742, 0.47],
  dc10: [0.77, 0.585],
  l1011: [0.725, 0.555],
  "767": [0.722, 0.515],
  a300: [0.722, 0.48]
};

/** How dark it is at an hour (with minutes): 0 by day, 1 at night, eased through dusk and dawn. */
export function darkness(hour, minute = 0) {
  const t = hour + minute / 60;
  const ramp = (a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  if (t >= 12) return ramp(17, 19.5);
  return 1 - ramp(5, 7.5);
}

/**
 * Where a plane's lights are, in the art's pixels, and the glow of its lit windows (a canvas
 * the size of the art), from its side view (a canvas). Null when the art cannot be read.
 */
export function readLights(canvas, aircraft) {
  const w = canvas.width, h = canvas.height;
  let data;
  try {
    data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
  const alpha = (x, y) => data[(y * w + x) * 4 + 3];

  // Windows: dark pixels on the plane, joined into blobs; window-sized ones along the fuselage.
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    dark[i] = a > 200 && 0.3 * r + 0.59 * g + 0.11 * b < 110 ? 1 : 0;
  }
  const seen = new Uint8Array(w * h);
  const blobs = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (!dark[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    let n = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i - x) / w;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= w * h || seen[j] || !dark[j]) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    const cy = (y0 + y1) / 2 / h;
    if (n >= 3 && n <= 90 && x1 - x0 < 10 && y1 - y0 < 11 && cy > 0.3 && cy < 0.8) blobs.push({ x0, y0, x1, y1 });
  }
  // Windows come in rows: keep the blobs with another close by at the same height.
  const windows = blobs.filter((b) => blobs.some((o) => o !== b
    && Math.abs((o.y0 + o.y1) - (b.y0 + b.y1)) <= 4 && Math.abs((o.x0 + o.x1) - (b.x0 + b.x1)) <= w * 0.05));

  // The glow: each window warm, then a soft halo around it.
  const glow = document.createElement("canvas");
  glow.width = w;
  glow.height = h;
  const g = glow.getContext("2d");
  const paint = () => {
    for (const b of windows) g.fillRect(b.x0 - 0.5, b.y0 - 0.5, b.x1 - b.x0 + 2, b.y1 - b.y0 + 2);
  };
  g.fillStyle = "rgba(255, 196, 110, 0.55)";
  g.filter = `blur(${Math.max(2, w / 300)}px)`;
  paint();
  g.filter = "none";
  g.fillStyle = "#ffe2a6";
  paint();

  // The fuselage's top and bottom lines (for the beacons) and the tail cone (for the tail light).
  const column = (fx, fromTop) => {
    const x = Math.round(w * fx);
    if (fromTop) { for (let y = 0; y < h; y++) if (alpha(x, y) > 128) return { x, y }; }
    else { for (let y = h - 1; y >= 0; y--) if (alpha(x, y) > 128) return { x, y }; }
    return { x, y: fromTop ? h * 0.4 : h * 0.9 };
  };
  let tail = { x: w * 0.95, y: h * 0.6 };
  // Below the tailplane, whose tips sweep back past the cone at about half height.
  for (let y = Math.round(h * 0.56); y < Math.round(h * 0.74); y++) {
    for (let x = w - 1; x > tail.x; x--) if (alpha(x, y) > 128) { tail = { x, y }; break; }
  }
  const [tx, ty] = WINGTIP[aircraft] ?? WINGTIP["767"];

  // The logo light: the fin, lit from below, fading up (what stands above the top line, aft).
  const finTop = column(0.6, true).y;
  const fin = document.createElement("canvas");
  fin.width = w;
  fin.height = h;
  const f = fin.getContext("2d");
  f.drawImage(canvas, 0, 0);
  f.globalCompositeOperation = "source-in";
  const wash = f.createLinearGradient(0, finTop, 0, 0);
  wash.addColorStop(0, "rgba(255, 244, 220, 0.9)");
  wash.addColorStop(1, "rgba(255, 244, 220, 0)");
  f.fillStyle = wash;
  f.fillRect(w * 0.7, 0, w * 0.3, Math.max(0, finTop - 2));
  f.globalCompositeOperation = "destination-in";
  f.fillRect(w * 0.7, 0, w * 0.3, Math.max(0, finTop - 2));

  return {
    glow, fin,
    wingtip: { x: w * tx, y: h * ty },
    tail: { x: tail.x - 1, y: tail.y },
    top: column(0.42, true),
    belly: column(0.62, false),
    windows: windows.length
  };
}

/** A light: a bright core and a halo, in the art's pixels scaled by k (art to screen). */
function lamp(g, x, y, k, color, size, strength) {
  if (strength <= 0.01) return;
  const r = size * k;
  const halo = g.createRadialGradient(x, y, 0, x, y, r * 6);
  halo.addColorStop(0, color.replace("ALPHA", (0.55 * strength).toFixed(3)));
  halo.addColorStop(1, color.replace("ALPHA", "0"));
  g.fillStyle = halo;
  g.beginPath();
  g.arc(x, y, r * 6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = `rgba(255, 255, 255, ${Math.min(1, strength).toFixed(3)})`;
  g.beginPath();
  g.arc(x, y, r * 0.8, 0, Math.PI * 2);
  g.fill();
}

/**
 * Draw the lights over the plane, in the plane's own frame (the caller has moved and tilted the
 * context): the art drawn at (-pw / 2, -ph / 2) with size pw x ph. `dark` 0 to 1, `now` ms.
 */
export function drawLights(g, lights, art, pw, ph, dark, now) {
  if (!lights || dark <= 0.01) return;
  const k = pw / art.width;
  const at = (p) => [-pw / 2 + p.x * k, -ph / 2 + p.y * (ph / art.height)];
  g.save();
  g.globalCompositeOperation = "lighter";
  // The cabin and the fin, lit.
  g.globalAlpha = 0.95 * dark;
  g.drawImage(lights.glow, -pw / 2, -ph / 2, pw, ph);
  g.globalAlpha = 0.35 * dark;
  g.drawImage(lights.fin, -pw / 2, -ph / 2, pw, ph);
  g.globalAlpha = 1;
  // Steady: red on the near wingtip, white on the tail.
  lamp(g, ...at(lights.wingtip), k, "rgba(255, 40, 40, ALPHA)", 2.2, dark);
  lamp(g, ...at(lights.tail), k, "rgba(255, 255, 240, ALPHA)", 1.8, 0.8 * dark);
  // The red beacons: a short flash about once a second, top and bottom a beat apart.
  const pulse = (period, offset, width) => {
    const p = ((now + offset) % period) / period;
    return p < width ? Math.sin((p / width) * Math.PI) : 0;
  };
  lamp(g, ...at(lights.top), k, "rgba(255, 30, 30, ALPHA)", 2.4, dark * pulse(1100, 0, 0.14));
  lamp(g, ...at(lights.belly), k, "rgba(255, 30, 30, ALPHA)", 2.4, dark * pulse(1100, 550, 0.14));
  // The white strobes: a double flash every 1.3 seconds, wingtip and tail together.
  const strobe = pulse(1300, 0, 0.04) + pulse(1300, -160, 0.04);
  lamp(g, ...at(lights.wingtip), k, "rgba(235, 245, 255, ALPHA)", 3.2, dark * strobe);
  lamp(g, ...at(lights.tail), k, "rgba(235, 245, 255, ALPHA)", 2.6, dark * strobe);
  g.restore();
}
