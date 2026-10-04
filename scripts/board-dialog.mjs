import { MODULE_ID, SETTINGS, formatClock, formatDuration, kmPerPixel, sceneNetwork, setting, stationPositions, worldTheme } from "./config.mjs";
import { fareValue, formatMoney, pay, walletValue } from "./fare.mjs";
import { findTrip, linesAt, stationOf } from "./network.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Tokens within this many grid spaces of the station count as "here". */
const NEAR_GRID = 4;

function partyMembers(group) {
  return Array.from(group?.system?.members ?? []).map((m) => m.actor ?? m).filter((a) => a?.id);
}

/**
 * Opened by double-clicking a station. The GM picks riders and a destination, sees the
 * route, time and fares, and boards.
 */
export class BoardDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "kg-transit-board",
    classes: ["kg-transit-board"],
    tag: "form",
    window: { title: "Board", icon: "fa-solid fa-train-subway", resizable: true },
    position: { width: 520, height: "auto" },
    form: { handler: BoardDialog.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: { toggleWaive: BoardDialog.#onToggleWaive }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/board.hbs` }
  };

  constructor({ originId, layer, ride }) {
    super();
    this.scene = canvas.scene;
    this.net = sceneNetwork(this.scene);
    this.kmPerPx = kmPerPixel(this.scene);
    this.originId = originId;
    this.layer = layer;
    this.ride = ride;
    this.destinationId = null;
    this.waived = new Set();
    this.payFrom = "riders";
    this.showToAll = setting(SETTINGS.showToAll);
    this.#findNearby();
  }

  get title() {
    return `Board at ${stationOf(this.net, this.originId)?.name ?? "the station"}`;
  }

  /**
   * Riders default to the scene's party token, if the GM set one in the editor (it rides
   * wherever it stands); otherwise to a party token or characters standing at this station.
   */
  #findNearby() {
    const here = stationPositions(this.net)[this.originId];
    const reach = NEAR_GRID * this.scene.grid.size;
    const near = (token) => here && Math.hypot(token.center.x - here.x, token.center.y - here.y) <= reach;
    this.candidates = game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
    const tokens = canvas.tokens.placeables.filter((t) => t.actor && near(t));
    const designated = this.net.partyTokenId ? canvas.tokens.get(this.net.partyTokenId) : null;
    const partyToken = designated ?? tokens.find((t) => t.actor.type === "group");
    this.party = (partyToken?.actor?.type === "group" ? partyToken.actor : null)
      ?? game.actors.party ?? game.actors.find((a) => a.type === "group") ?? null;
    const riding = tokens.filter((t) => t.actor.type === "group" || t.actor.type === "character");
    if (partyToken && !riding.includes(partyToken)) riding.unshift(partyToken);
    this.tokenIds = riding.map((t) => t.id);
    this.partyTokenId = partyToken?.id ?? null;
    const chosen = new Set();
    if (partyToken?.actor?.type === "group") for (const a of partyMembers(partyToken.actor)) chosen.add(a.id);
    else if (partyToken?.actor?.type === "character") chosen.add(partyToken.actor.id);
    for (const t of tokens) if (t.actor.type === "character") chosen.add(t.actor.id);
    this.selected = chosen;
  }

  #trip() {
    return this.destinationId ? findTrip(this.net, this.originId, this.destinationId, this.kmPerPx, worldTheme()) : null;
  }

  async _prepareContext() {
    const fare = fareValue(this.net.fare);
    const trip = this.#trip();
    const riders = this.candidates.map((actor) => {
      const cash = walletValue(actor.system.currency);
      const checked = this.selected.has(actor.id);
      const waived = this.waived.has(actor.id);
      const short = this.payFrom === "riders" && checked && !waived && cash < fare;
      return { id: actor.id, name: actor.name, img: actor.img, checked, waived, cash: formatMoney(cash), short, free: !fare };
    });
    const paying = riders.filter((r) => r.checked && !r.waived).length;
    const partyCash = this.party ? walletValue(this.party.system.currency) : 0;
    const partyShort = this.payFrom === "party" && partyCash < fare * paying;

    return {
      originLines: linesAt(this.net, this.originId).map((l) => ({ name: l.name, color: l.color })),
      riders,
      groups: this.net.lines.map((line) => ({
        label: line.name,
        options: line.stops.filter((id) => id !== this.originId)
          .map((id) => ({ id, name: stationOf(this.net, id)?.name ?? "Stop", selected: id === this.destinationId }))
      })).filter((g) => g.options.length),
      trip: trip && this.#tripSummary(trip),
      noRoute: !!this.destinationId && !trip,
      fare: formatMoney(fare),
      hasFare: fare > 0,
      total: formatMoney(fare * paying),
      party: this.party && fare > 0 && { name: this.party.name, cash: formatMoney(partyCash), short: partyShort },
      payFromParty: this.payFrom === "party",
      showToAll: this.showToAll,
      canBoard: !!trip && riders.some((r) => r.checked) && !riders.some((r) => r.short) && !partyShort
    };
  }

  #tripSummary(trip) {
    return {
      legs: trip.legs.map((leg) => ({
        label: leg.label,
        color: trip.lines[leg.line].color,
        from: trip.names[leg.stops[0]],
        to: trip.names[leg.stops.at(-1)],
        stops: leg.stops.length - 1
      })),
      duration: formatDuration(trip.total),
      arrives: formatClock(game.time.worldTime + trip.total)
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll("input, select").forEach((el) => el.addEventListener("change", () => this.#readForm()));
    // While open, clicking a station on the map picks it as the destination.
    const picking = !!this.layer.onPick;
    this.layer.onPick = (id) => {
      if (id === this.originId) return;
      this.destinationId = id;
      this.render();
    };
    if (!picking) this.layer.rescale();
  }

  _onClose(options) {
    super._onClose(options);
    if (this.layer.onPick) {
      this.layer.onPick = null;
      this.layer.rescale();
    }
  }

  #readForm() {
    const form = this.element;
    this.destinationId = form.querySelector("[name=destination]")?.value || null;
    this.selected = new Set([...form.querySelectorAll("[name=rider]:checked")].map((el) => el.value));
    this.payFrom = form.querySelector("[name=payFrom]:checked")?.value ?? "riders";
    this.showToAll = form.querySelector("[name=showTo]:checked")?.value === "all";
    this.render();
  }

  static #onToggleWaive(event, target) {
    const id = target.dataset.actorId;
    if (this.waived.has(id)) this.waived.delete(id);
    else this.waived.add(id);
    this.render();
  }

  static async #onSubmit() {
    const trip = this.#trip();
    if (!trip) return;
    const riders = this.candidates.filter((a) => this.selected.has(a.id));
    if (!riders.length) return;

    const fare = fareValue(this.net.fare);
    const payers = riders.filter((a) => !this.waived.has(a.id));
    const charged = [];
    if (fare > 0 && this.payFrom === "party" && this.party) {
      const result = pay(this.party.system.currency, fare * payers.length);
      if (!result) return ui.notifications.warn(`${this.party.name} can't cover ${formatMoney(fare * payers.length)}.`);
      await this.party.update({ "system.currency": result.after });
      charged.push({ name: this.party.name, value: fare * payers.length });
    } else if (fare > 0) {
      const results = payers.map((actor) => [actor, pay(actor.system.currency, fare)]);
      const broke = results.find(([, r]) => !r);
      if (broke) return ui.notifications.warn(`${broke[0].name} can't pay the fare.`);
      for (const [actor, result] of results) {
        await actor.update({ "system.currency": result.after });
        charged.push({ name: actor.name, value: fare });
      }
    }

    await game.settings.set(MODULE_ID, SETTINGS.showToAll, this.showToAll);
    await this.close();
    await this.ride.start({
      trip,
      networkName: this.net.name,
      cars: this.net.cars,
      riders: riders.map((a) => ({ id: a.id, name: a.name })),
      waived: riders.filter((a) => this.waived.has(a.id)).map((a) => a.name),
      charged,
      showToAll: this.showToAll,
      sceneId: this.scene.id,
      tokenIds: this.tokenIds,
      partyTokenId: this.partyTokenId
    });
  }
}
