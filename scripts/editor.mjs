import { CARS, DEFAULT_SCENERY, KINDS, PLATFORMS, SCENERY, SUGGESTED_COLORS, isTunnel } from "./catalog.mjs";
import { presetLabel } from "./cities.mjs";
import { applyCityPreset, cityPreset, sceneCity, traceCityTracks } from "./city-setup.mjs";
import { FLAGS, MODULE_ID, escapeHtml, kmPerPixel, saveNetwork, sceneNetwork, worldTheme } from "./config.mjs";
import { COINS, fareValue, formatMoney } from "./fare.mjs";
import { isPlaced, linesAt, newId, normalize, runSeconds } from "./network.mjs";
import { segmentNodes } from "./route-path.mjs";
import { THEMES, isTheme, pickTheme, themeChoices } from "./themes.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const isMiles = (units) => /^(mi|mile|miles)\.?$/i.test(String(units ?? "").trim());

/**
 * The network editor for the current scene. Network settings fold into one summary line;
 * lines are listed on the left; the selected line's route runs down the right as a line
 * diagram, stop by stop, with the scenery and travel time for each stretch on the track
 * between them. A footer counts the stops still to place and places them one after
 * another. Every change saves to the scene straight away.
 */
export class NetworkEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "kg-transit-editor",
    classes: ["kg-transit-editor"],
    tag: "form",
    window: { title: "Transit network", icon: "fa-solid fa-train-subway", resizable: true },
    position: { width: 680, height: 720 },
    actions: {
      toggleNetwork: NetworkEditor.#toggleNetwork,
      addLine: NetworkEditor.#addLine,
      selectLine: NetworkEditor.#selectLine,
      deleteLine: NetworkEditor.#deleteLine,
      addStop: NetworkEditor.#addStop,
      removeStop: NetworkEditor.#removeStop,
      place: NetworkEditor.#place,
      placeNext: NetworkEditor.#placeNext,
      toggleTransfer: NetworkEditor.#toggleTransfer,
      toggleOnLine: NetworkEditor.#toggleOnLine,
      sceneTheme: NetworkEditor.#sceneTheme,
      resetPreset: NetworkEditor.#resetPreset,
      traceTracks: NetworkEditor.#traceTracks,
      straighten: NetworkEditor.#straighten,
      pickFile: NetworkEditor.#pickFile,
      sceneConfig: NetworkEditor.#sceneConfig,
      disable: NetworkEditor.#disable
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/editor.hbs`, scrollable: [".kgt-ed-route", ".kgt-ed-rail"] }
  };

  constructor({ scene, layer }) {
    super();
    this.scene = scene;
    this.layer = layer;
    this.net = sceneNetwork(scene);
    this.lineId = this.net.lines[0]?.id ?? null;
    this.openTransfer = null;
    this.netOpen = false;
    this.city = sceneCity(scene);
    this.save = foundry.utils.debounce(() => saveNetwork(this.scene, this.net), 250);
  }

  get title() {
    return `Transit network: ${this.scene.name}`;
  }

  get line() {
    return this.net.lines.find((l) => l.id === this.lineId) ?? null;
  }

  station(id) {
    return this.net.stations.find((s) => s.id === id);
  }

  /** Stations on any line, in line order, without repeats: the order "Place next" follows. */
  #allStops() {
    const seen = new Set();
    const out = [];
    for (const line of this.net.lines) for (const id of line.stops) if (!seen.has(id)) { seen.add(id); out.push(this.station(id)); }
    return out.filter(Boolean);
  }

  async _prepareContext() {
    const net = this.net;
    const line = this.line;
    const kmPerPx = kmPerPixel(this.scene);
    const sceneryGroups = {};
    for (const [key, s] of Object.entries(SCENERY)) (sceneryGroups[s.group] ??= []).push({ key, label: s.label });
    const partyTokens = this.scene.tokens.contents
      .filter((t) => t.actor)
      .sort((a, b) => (b.actor.type === "group") - (a.actor.type === "group") || a.name.localeCompare(b.name))
      .map((t) => ({ id: t.id, name: t.name, group: t.actor.type === "group", selected: t.id === net.partyTokenId }));
    const party = partyTokens.find((t) => t.selected);

    const world = worldTheme();
    const sceneTheme = pickTheme(net.theme, world);
    const lineTheme = line && pickTheme(line.theme, sceneTheme);
    const stops = line ? line.stops.map((id, i) => {
      const station = this.station(id);
      const seg = line.segments[i];
      const autoLine = { ...line, segments: line.segments.map((s) => ({ ...s, minutes: null })) };
      const own = isTheme(station.theme) ? THEMES[station.theme] : null;
      const platform = PLATFORMS[station.platform] ? station.platform : "auto";
      const autoPlatform = this.#reachedByTunnel(id) ? "underground" : "above";
      return {
        id,
        index: i,
        name: station.name,
        placed: isPlaced(station),
        theme: own && { label: own.label, glyph: own.glyph },
        // Only worth a label when it differs from what auto would pick (city stops are all set).
        platformChip: platform === "auto" || platform === autoPlatform ? null : PLATFORMS[platform].label,
        themes: themeChoices(station.theme, lineTheme),
        platforms: Object.entries(PLATFORMS).map(([key, p]) => ({
          key, selected: key === platform,
          label: key === "auto" ? `Auto (${PLATFORMS[autoPlatform].label.toLowerCase()})` : p.label
        })),
        transferOpen: this.openTransfer === id,
        transferLines: linesAt(net, id).filter((l) => l.id !== line.id).map((l) => ({ name: l.name, color: l.color })),
        otherLines: net.lines.filter((l) => l.id !== line.id).map((l) => ({ id: l.id, name: l.name, color: l.color, checked: l.stops.includes(id) })),
        segment: seg && {
          icon: SCENERY[seg.scenery]?.icon ?? "fa-route",
          groups: Object.entries(sceneryGroups).map(([label, options]) => ({
            label, options: options.map((o) => ({ ...o, selected: o.key === seg.scenery }))
          })),
          minutes: seg.minutes ?? "",
          nodes: segmentNodes(seg, id, line.stops[i + 1]).length,
          auto: Math.max(1, Math.round(runSeconds(net, autoLine, i, kmPerPx) / 60))
        }
      };
    }) : [];

    const all = this.#allStops();
    const placedCount = all.filter(isPlaced).length;
    const next = all.find((s) => !isPlaced(s));

    return {
      net,
      scale: { miles: isMiles(this.scene.grid.units), units: String(this.scene.grid.units || "no units"), distance: this.scene.grid.distance },
      // KG Cities scenes are drawn at real scale, so their distances are right whatever the units.
      city: this.city && {
        label: net.preset ? presetLabel(net.preset) : `${this.city.city}, ${this.city.year}`,
        preset: !!net.preset,
        note: net.preset?.note ?? null,
        canTrace: !!net.preset && !!game.modules.get("kg-cities")?.api?.transit,
        stations: net.stations.length
      },
      cars: Object.entries(CARS).map(([key, car]) => ({
        key, label: car.label, sound: net.cars?.[key]?.sound ?? "", interior: net.cars?.[key]?.interior ?? ""
      })),
      netOpen: this.netOpen,
      fareText: formatMoney(fareValue(net.fare)),
      partyLabel: party?.name ?? "none",
      partyTokens,
      partyMissing: !!net.partyTokenId && !party,
      coins: COINS.map((c) => ({ key: c.key, label: c.label, selected: c.key === net.fare.coin })),
      // The master theme picker: the world default, or one theme for this whole scene.
      sceneThemes: [
        { key: "", label: "World default", hint: `${THEMES[world].label}, from the module settings`, glyph: "fa-globe", active: !isTheme(net.theme) },
        ...Object.entries(THEMES).map(([key, t]) => ({ key, label: t.label, hint: t.hint, glyph: t.glyph, active: key === net.theme }))
      ],
      sceneThemeLabel: THEMES[sceneTheme].label,
      lines: net.lines.map((l) => ({
        id: l.id, name: l.name, color: l.color, active: l.id === this.lineId,
        kind: (KINDS[l.kind] ?? KINDS.metro).label,
        theme: isTheme(l.theme) ? { label: THEMES[l.theme].label, glyph: THEMES[l.theme].glyph } : null,
        stops: l.stops.length,
        placed: l.stops.filter((id) => isPlaced(this.station(id))).length
      })),
      line: line && {
        ...line,
        kinds: Object.entries(KINDS).map(([key, k]) => ({ key, label: k.label, selected: key === line.kind })),
        themes: themeChoices(line.theme, sceneTheme)
      },
      stops,
      progress: { placed: placedCount, total: all.length, percent: all.length ? Math.round((placedCount / all.length) * 100) : 0, next: next?.name ?? null }
    };
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    // The form element lasts across re-renders, so these listen once.
    this.element.addEventListener("change", (event) => this.#onChange(event));
    this.#listenForDrags();
    this.layer.setEditing(true);
    this.layer.onMove = (id, x, y) => {
      const station = this.station(id);
      if (!station) return;
      Object.assign(station, { x, y });
      this.#commit();
    };
    this.layer.onPath = (lineId, index, nodes) => {
      const line = this.net.lines.find((l) => l.id === lineId);
      const seg = line?.segments[index];
      if (!seg) return;
      if (nodes.length) seg.path = { from: line.stops[index], to: line.stops[index + 1], nodes: nodes.map((n) => ({ ...n })) };
      else delete seg.path;
      this.#commit();
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.layer.selectLine?.(this.lineId);
  }

  _onClose(options) {
    super._onClose(options);
    this.placing = false;
    this.layer.cancelPlacing();
    this.layer.selectLine?.(null);
    this.layer.setEditing(false);
    this.layer.onMove = null;
    this.layer.onPath = null;
  }

  /** Save and redraw after any change. */
  #commit({ render = true } = {}) {
    this.net = normalize(this.net);
    this.save();
    if (render) this.render();
  }

  #onChange(event) {
    const el = event.target;
    const field = el.dataset.field;
    if (!field) return;
    const net = this.net;
    const line = this.line;
    const value = el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value;
    switch (field) {
      case "name": net.name = value || "Transit"; break;
      case "badge": net.badge = String(value || "M").slice(0, 2); break;
      case "fareAmount": net.fare.amount = Math.max(0, value ?? 0); break;
      case "fareCoin": net.fare.coin = value; break;
      case "transfer": net.transferMinutes = Math.max(0, value ?? 0); break;
      case "partyToken": net.partyTokenId = value || null; break;
      case "carSound":
      case "carInterior": {
        const car = (net.cars[el.dataset.car] ??= {});
        car[field === "carSound" ? "sound" : "interior"] = String(value ?? "").trim() || null;
        break;
      }
      case "lineName": if (line) line.name = value || "Line"; break;
      case "lineColor": if (line) line.color = value; break;
      case "lineKind": if (line) line.kind = value; break;
      case "lineTheme": if (line) line.theme = isTheme(value) ? value : null; break;
      case "stationName":
      case "stationTheme":
      case "stationPlatform": {
        const station = this.station(el.dataset.station);
        if (!station) break;
        if (field === "stationName") station.name = value || "Stop";
        else if (field === "stationTheme") station.theme = isTheme(value) ? value : null;
        else station.platform = PLATFORMS[value] ? value : "auto";
        break;
      }
      case "scenery": if (line) line.segments[Number(el.dataset.index)].scenery = value; break;
      case "minutes": if (line) line.segments[Number(el.dataset.index)].minutes = value && value > 0 ? value : null; break;
      default: return;
    }
    this.#commit();
  }

  /** Drag a stop by its row to a new place on the line. */
  #listenForDrags() {
    let from = null;
    const row = (event) => event.target.closest?.(".kgt-ed-stop");
    // Rows only drag by their grip, so the name field still selects text normally.
    this.element.addEventListener("pointerdown", (event) => {
      const grip = event.target.closest?.(".kgt-ed-grip");
      if (grip) grip.closest(".kgt-ed-stop").draggable = true;
    });
    this.element.addEventListener("dragstart", (event) => {
      const r = row(event);
      if (!r?.draggable) return;
      from = Number(r.dataset.index);
      event.dataTransfer.effectAllowed = "move";
      r.classList.add("dragging");
    });
    this.element.addEventListener("dragover", (event) => {
      const r = row(event);
      if (from === null || !r) return;
      event.preventDefault();
      for (const el of this.element.querySelectorAll(".kgt-ed-stop.drop")) el.classList.remove("drop");
      r.classList.add("drop");
    });
    this.element.addEventListener("dragend", () => {
      from = null;
      for (const el of this.element.querySelectorAll(".kgt-ed-stop")) {
        el.classList.remove("dragging", "drop");
        el.draggable = false;
      }
    });
    this.element.addEventListener("drop", (event) => {
      const r = row(event);
      const stops = this.line?.stops;
      if (from === null || !r || !stops) return;
      event.preventDefault();
      const to = Number(r.dataset.index);
      if (to !== from) {
        const [moved] = stops.splice(from, 1);
        stops.splice(to, 0, moved);
        this.#commit();
      }
      from = null;
    });
  }

  /** Whether any line reaches the stop through a tunnel (an auto platform is then underground). */
  #reachedByTunnel(id) {
    return this.net.lines.some((l) => {
      const i = l.stops.indexOf(id);
      return i >= 0 && (isTunnel(l.segments[i - 1]?.scenery) || isTunnel(l.segments[i]?.scenery));
    });
  }

  /** Replace the network with the city's own (as it stood in the scene's year), keeping the party token. */
  static async #resetPreset() {
    const preset = await cityPreset(this.scene);
    if (!preset) return ui.notifications.warn("KG Transit has no network for this city.");
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "City network" },
      content: `<p>Replace this scene's network with <strong>${escapeHtml(preset.net.name)}</strong> as it ran in ${preset.info.year}? Your changes to lines and stops on this scene are lost.</p>`
    });
    if (!ok) return;
    this.net = normalize(await applyCityPreset(this.scene, preset, { keepParty: this.net.partyTokenId }));
    this.lineId = this.net.lines[0]?.id ?? null;
    this.openTransfer = null;
    if (preset.reason) ui.notifications.info(preset.reason);
    this.render();
  }

  /** Curve every line along the city's real track (KG Cities), replacing the travel nodes. */
  static async #traceTracks() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Follow the tracks" },
      content: "<p>Curve every line along the city's real track? Travel nodes you have moved or added are replaced.</p>"
    });
    if (!ok) return;
    const traced = await traceCityTracks(this.scene, this.net);
    this.#commit();
    if (traced) ui.notifications.info(`KG Transit: ${traced} stretches now follow the track.`);
    else ui.notifications.warn("KG Cities has no track for this city and era.");
  }

  /** Take a stretch's travel nodes out, so it runs straight. */
  static #straighten(event, target) {
    const seg = this.line?.segments[Number(target.dataset.index)];
    if (!seg) return;
    delete seg.path;
    this.#commit();
  }

  /** Browse for a car's sound or interior image for this network. */
  static #pickFile(event, target) {
    const { car, kind } = target.dataset;
    const field = kind === "audio" ? "sound" : "interior";
    const Picker = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    const picker = new Picker({
      type: kind,
      current: this.net.cars?.[car]?.[field] ?? "",
      callback: (path) => {
        (this.net.cars[car] ??= {})[field] = path || null;
        this.#commit();
      }
    });
    picker.browse?.() ?? picker.render(true);
  }

  static #sceneTheme(event, target) {
    this.net.theme = isTheme(target.dataset.theme) ? target.dataset.theme : null;
    this.#commit();
  }

  static #toggleNetwork() {
    this.netOpen = !this.netOpen;
    this.render();
  }

  static #addLine() {
    const used = new Set(this.net.lines.map((l) => l.color.toLowerCase()));
    const color = SUGGESTED_COLORS.find((c) => !used.has(c)) ?? SUGGESTED_COLORS[this.net.lines.length % SUGGESTED_COLORS.length];
    const line = { id: newId(), name: `Line ${this.net.lines.length + 1}`, color, kind: "metro", stops: [], segments: [] };
    this.net.lines.push(line);
    this.lineId = line.id;
    this.#commit();
    setTimeout(() => this.element.querySelector(".kgt-ed-linetitle")?.select(), 50);
  }

  static #selectLine(event, target) {
    this.lineId = target.dataset.line;
    this.openTransfer = null;
    this.render();
  }

  static async #deleteLine() {
    const line = this.line;
    if (!line) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete line" },
      content: `<p>Delete <strong>${escapeHtml(line.name)}</strong>? Stops only on this line are deleted too.</p>`
    });
    if (!ok) return;
    this.net.lines = this.net.lines.filter((l) => l !== line);
    pruneStations(this.net);
    this.lineId = this.net.lines[0]?.id ?? null;
    this.#commit();
  }

  static #addStop() {
    const line = this.line;
    if (!line) return;
    const station = { id: newId(), name: `Stop ${this.net.stations.length + 1}`, x: null, y: null };
    this.net.stations.push(station);
    line.stops.push(station.id);
    this.#commit();
    setTimeout(() => this.element.querySelector(`[data-field="stationName"][data-station="${station.id}"]`)?.select(), 50);
  }

  static #removeStop(event, target) {
    const line = this.line;
    if (!line) return;
    removeFromLine(line, target.closest("[data-station]").dataset.station);
    pruneStations(this.net);
    this.#commit();
  }

  #warnScale() {
    if (isMiles(this.scene.grid.units) || this.city) return;
    ui.notifications.warn("This scene's grid isn't in miles yet, so travel times will be off. Set Grid Units to mi and the Grid Scale in the scene's settings.");
  }

  /** Tuck the editor away, wait for a click on the map, and put the stop there. */
  static async #place(event, target) {
    const station = this.station(target.closest("[data-station]").dataset.station);
    if (!station) return;
    this.#warnScale();
    ui.notifications.info(`Click the map to place ${station.name}. Esc or right-click to cancel.`);
    await this.minimize();
    const point = await this.layer.pickPoint();
    await this.maximize();
    if (!point) return;
    Object.assign(station, point);
    this.#commit();
  }

  /** Place every unplaced stop in turn: one click each, until all are placed or Esc. */
  static async #placeNext() {
    this.#warnScale();
    this.placing = true;
    await this.minimize();
    while (this.placing) {
      const station = this.#allStops().find((s) => !isPlaced(s));
      if (!station) break;
      ui.notifications.info(`Click the map to place ${station.name}. Esc or right-click to stop.`);
      const point = await this.layer.pickPoint();
      if (!point) break;
      Object.assign(station, point);
      this.#commit({ render: false });
    }
    this.placing = false;
    if (this.rendered) {
      await this.maximize();
      this.render();
    }
  }

  static #toggleTransfer(event, target) {
    const id = target.closest("[data-station]").dataset.station;
    this.openTransfer = this.openTransfer === id ? null : id;
    this.render();
  }

  /** Put the stop on another line too (at its end), or take it off that line. */
  static #toggleOnLine(event, target) {
    const other = this.net.lines.find((l) => l.id === target.dataset.line);
    const id = target.dataset.station;
    if (!other) return;
    if (other.stops.includes(id)) removeFromLine(other, id);
    else {
      other.stops.push(id);
      other.segments.push({ scenery: DEFAULT_SCENERY, minutes: null });
    }
    this.#commit();
  }

  /** Open the scene's own settings, where its grid units and scale are set. */
  static #sceneConfig() {
    this.scene.sheet.render(true);
  }

  static async #disable() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Turn off transit" },
      content: "<p>Hide the network on this scene? Its lines and stops are kept, ready for when you turn it back on.</p>"
    });
    if (!ok) return;
    await this.scene.setFlag(MODULE_ID, FLAGS.enabled, false);
    this.close();
  }
}

function removeFromLine(line, id) {
  const i = line.stops.indexOf(id);
  if (i < 0) return;
  line.stops.splice(i, 1);
  if (line.segments.length) line.segments.splice(Math.min(i, line.segments.length - 1), 1);
}

/** Drop stations no line uses any more. */
function pruneStations(net) {
  net.stations = net.stations.filter((s) => net.lines.some((l) => l.stops.includes(s.id)));
}
