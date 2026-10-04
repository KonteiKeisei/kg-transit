import { SETTINGS, escapeHtml, sceneEnabled, sceneNetwork, setting, worldTheme } from "./config.mjs";
import { isPlaced, linesAt } from "./network.mjs";
import { THEMES, stationTheme } from "./themes.mjs";

const DOUBLE_CLICK_MS = 350;
/** Canvas zoom at which station icons start to fade, and at which they are gone. */
const FADE_START = 0.25;
const FADE_END = 0.12;

/** Regular polygon points (pointy top) for the future theme's hexagon. */
function hexagon(r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return pts;
}

/**
 * Station icon looks, by THEMES[theme].icon. `shape(g, inset)` draws the outline (within
 * -48..48), inset for the mask of transfer colours.
 */
const ICON_LOOKS = {
  // Modern: rounded square, white disc, bold sans-serif.
  rounded: {
    shape: (g, i) => g.drawRoundedRect(-46 + i, -46 + i, 92 - 2 * i, 92 - 2 * i, 22 - i),
    rim: 0xffffff, rimWidth: 4, disc: 0xffffff, ink: 0x111111, font: "Helvetica, Arial, sans-serif"
  },
  // Industrial: a round enamel plate with a brass rim and a serif letter.
  enamel: {
    shape: (g, i) => g.drawCircle(0, 0, 47 - i),
    rim: 0xc9a45a, rimWidth: 5, disc: 0xf4ecd8, discRim: 0x2b1d12, ink: 0x2b1d12,
    font: "Georgia, 'Times New Roman', serif", weight: "700"
  },
  // Fantasy: a heraldic shield, iron rim, parchment roundel.
  shield: {
    shape: (g, i) => g.drawPolygon([-44 + i, -46 + i, 44 - i, -46 + i, 44 - i, 4, 0, 48 - i * 1.4, -44 + i, 4]),
    rim: 0x3a2a1a, rimWidth: 5, disc: 0xf3e2bd, discRim: 0x3a2a1a, discR: 27, discY: -6, ink: 0x2a1a0c,
    font: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif", weight: "700"
  },
  // Future: a hexagon edged in cyan, dark core with a glowing letter.
  hex: {
    shape: (g, i) => g.drawPolygon(hexagon(48 - i)),
    rim: 0x7ff6ff, rimWidth: 4, disc: 0x0b1020, discRim: 0x7ff6ff, discR: 29, ink: 0x7ff6ff,
    font: "Consolas, 'Cascadia Mono', 'Courier New', monospace", weight: "700"
  }
};

/**
 * Station icons on the canvas: a badge in the line colour (split between colours at transfer
 * stations), shaped by the station's theme, with a disc and the network's badge letter. Hover names the stop;
 * the GM double-clicks to board. While the network editor is open the GM can drag stations,
 * and a "place" request turns the next canvas click into that station's position.
 */
export class StationLayer {
  constructor() {
    this.container = null;
    this.icons = new Map();
    this.tooltip = null;
    this.editing = false;
    this.drag = null;
    this.lastClick = { id: null, time: 0 };
    /** While the Board dialog is open, a single click picks a destination. */
    this.onPick = null;
    this.onBoard = null;
    /** While the editor is open: called with (id, x, y) when a station is dragged. */
    this.onMove = null;
    this.placing = null;
  }

  draw() {
    this.destroy();
    const scene = canvas.scene;
    if (!scene || !sceneEnabled(scene)) return;
    this.net = sceneNetwork(scene);

    this.container = new PIXI.Container();
    this.container.eventMode = "passive";
    this.container.sortableChildren = true;
    this.container.zIndex = 1000;
    canvas.interface.addChild(this.container);

    for (const station of this.net.stations) {
      if (!isPlaced(station)) continue;
      const lines = linesAt(this.net, station.id);
      if (!lines.length) continue;
      const icon = this.#buildIcon(station, lines);
      icon.position.set(station.x, station.y);
      this.container.addChild(icon);
      this.icons.set(station.id, icon);
    }
    this.rescale();
  }

  destroy() {
    this.hideTooltip();
    this.container?.destroy({ children: true });
    this.container = null;
    this.icons.clear();
    this.drag = null;
  }

  setEditing(editing) {
    this.editing = editing;
    this.rescale();
  }

  /**
   * Keep icons a constant size on screen as the canvas zooms, and fade them out when zoomed
   * far out. While editing, placing or picking a destination they always show.
   */
  rescale() {
    if (!this.container) return;
    this.hideTooltip();
    const zoom = canvas.stage.scale.x || 1;
    const px = setting(SETTINGS.iconSize);
    for (const icon of this.icons.values()) icon.scale.set(px / zoom / 100);
    const always = this.editing || !!this.onPick || !!this.placing;
    const alpha = always ? 1 : Math.max(0, Math.min(1, (zoom - FADE_END) / (FADE_START - FADE_END)));
    this.container.alpha = alpha;
    this.container.visible = alpha > 0;
    this.container.eventMode = alpha > 0.2 ? "passive" : "none";
  }

  #buildIcon(station, lines) {
    const { Color } = foundry.utils;
    const icon = new PIXI.Container();
    icon.eventMode = "static";
    icon.cursor = "pointer";
    icon.hitArea = new PIXI.Rectangle(-50, -50, 100, 100);

    // Drawn at 100 x 100 units centred on the station; scaled by rescale(). The shape and
    // trim follow the station's theme.
    const look = ICON_LOOKS[THEMES[stationTheme(this.net, lines[0], station, worldTheme())].icon] ?? ICON_LOOKS.rounded;
    const colors = lines.map((l) => Color.from(l.color).valueOf());
    const g = new PIXI.Graphics();
    g.lineStyle(look.rimWidth, look.rim, 0.95);
    g.beginFill(colors[0]);
    look.shape(g, 0);
    g.endFill();
    icon.addChild(g);
    if (colors.length > 1) {
      // Two lines: split on the diagonal. More: one vertical band per line.
      const bands = new PIXI.Graphics();
      if (colors.length === 2) {
        bands.beginFill(colors[1]).drawPolygon([48, -48, 48, 48, -48, 48]).endFill();
      } else {
        const w = 96 / colors.length;
        colors.forEach((c, i) => bands.beginFill(c).drawRect(-48 + i * w, -48, w + 0.5, 96).endFill());
      }
      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      look.shape(mask, 2);
      mask.endFill();
      bands.mask = mask;
      icon.addChild(bands, mask);
    }
    const disc = new PIXI.Graphics();
    if (look.discRim) disc.lineStyle(3, look.discRim, 1);
    disc.beginFill(look.disc).drawCircle(0, look.discY ?? 0, look.discR ?? 31).endFill();
    icon.addChild(disc);
    const badge = new PIXI.Text(String(this.net.badge || "M").slice(0, 2), {
      fontFamily: look.font, fontWeight: look.weight ?? "900", fontSize: 40, fill: look.ink
    });
    badge.position.set(0, look.discY ?? 0);
    badge.anchor.set(0.5);
    badge.resolution = 3;
    icon.addChild(badge);

    icon.on("pointerover", () => this.showTooltip(station.id));
    icon.on("pointerout", () => this.hideTooltip());
    icon.on("pointerdown", (event) => this.#onPointerDown(station.id, icon, event));
    return icon;
  }

  #onPointerDown(id, icon, event) {
    if (event.button !== 0 || this.placing) return;
    event.stopPropagation();
    if (!game.user.isGM) return;
    if (this.editing) return this.#startDrag(id, icon, event);
    if (this.onPick) return this.onPick(id);
    const now = Date.now();
    if (this.lastClick.id === id && now - this.lastClick.time < DOUBLE_CLICK_MS) {
      this.lastClick = { id: null, time: 0 };
      this.hideTooltip();
      this.onBoard?.(id);
    } else {
      this.lastClick = { id, time: now };
    }
  }

  #startDrag(id, icon, event) {
    const stage = canvas.stage;
    const start = event.getLocalPosition(this.container);
    this.drag = { id, icon, offset: { x: icon.x - start.x, y: icon.y - start.y }, moved: false };
    this.hideTooltip();
    const move = (e) => {
      if (!this.drag) return;
      const p = e.getLocalPosition(this.container);
      this.drag.icon.position.set(p.x + this.drag.offset.x, p.y + this.drag.offset.y);
      this.drag.moved = true;
    };
    const up = () => {
      stage.off("pointermove", move);
      stage.off("pointerup", up);
      stage.off("pointerupoutside", up);
      const drag = this.drag;
      this.drag = null;
      if (drag?.moved) this.onMove?.(drag.id, Math.round(drag.icon.x), Math.round(drag.icon.y));
    };
    stage.on("pointermove", move);
    stage.on("pointerup", up);
    stage.on("pointerupoutside", up);
  }

  /**
   * Wait for the GM to click a spot on the canvas, for placing a station. Resolves with
   * { x, y }, or null if they press Escape or right-click.
   */
  pickPoint() {
    this.cancelPlacing();
    return new Promise((resolve) => {
      const stage = canvas.stage;
      const view = canvas.app.view;
      const previousCursor = view.style.cursor;
      view.style.cursor = "crosshair";
      const finish = (result) => {
        stage.removeEventListener("pointerdown", down, { capture: true });
        document.removeEventListener("keydown", key, true);
        view.style.cursor = previousCursor;
        this.placing = null;
        this.rescale();
        resolve(result);
      };
      // Captured on the stage before anything else sees it, so the click does not also
      // select a token or start Foundry's drag-select.
      const down = (event) => {
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (event.button === 2) return finish(null);
        if (event.button !== 0) return;
        const p = event.getLocalPosition(canvas.stage);
        finish({ x: Math.round(p.x), y: Math.round(p.y) });
      };
      const key = (event) => {
        if (event.key === "Escape") { event.preventDefault(); finish(null); }
      };
      stage.addEventListener("pointerdown", down, { capture: true });
      document.addEventListener("keydown", key, true);
      this.placing = { finish };
      this.rescale();
    });
  }

  cancelPlacing() {
    this.placing?.finish(null);
  }

  showTooltip(id) {
    if (this.drag || !this.net) return;
    const station = this.net.stations.find((s) => s.id === id);
    const icon = this.icons.get(id);
    if (!station || !icon) return;
    const lines = linesAt(this.net, id).map((l) => `<span class="kg-transit-dot" style="--line:${l.color}"></span>${escapeHtml(l.name)}`);
    const el = this.tooltip ?? document.createElement("div");
    el.className = "kg-transit-tooltip";
    el.innerHTML = `<strong>${escapeHtml(station.name)}</strong><span class="lines">${lines.join(" ")}</span>`;
    if (!this.tooltip) document.body.append(el);
    this.tooltip = el;
    const rect = canvas.app.view.getBoundingClientRect();
    const global = icon.getGlobalPosition();
    const lift = (setting(SETTINGS.iconSize) * 0.6) + 6;
    el.style.left = `${rect.left + global.x}px`;
    el.style.top = `${rect.top + global.y - lift}px`;
  }

  hideTooltip() {
    this.tooltip?.remove();
    this.tooltip = null;
  }
}
