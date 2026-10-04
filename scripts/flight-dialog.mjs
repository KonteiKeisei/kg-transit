import { MODULE_ID, SETTINGS, formatClock, setting } from "./config.mjs";
import { formatMoney, pay, walletValue } from "./fare.mjs";
import { AIRCRAFT, AIRLINES, ENCOUNTER_POINTS, formatMinutes, minutesUntil, planFlight } from "./flights.mjs";
import { loadAirports, openIn } from "./airports.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function partyMembers(group) {
  return Array.from(group?.system?.members ?? []).map((m) => m.actor ?? m).filter((a) => a?.id);
}

/** A ticket's price in coins: dollars at the world's rate (copper per dollar). */
export const dollarsToCopper = (dollars) => Math.round(dollars * (Number(setting(SETTINGS.dollarRate)) || 1000));

/** The scene's year (KG Cities) and the calendar's month, for the fare in force. */
function when(scene) {
  const c = game.time.calendar?.timeToComponents?.(game.time.worldTime);
  const year = Number(scene?.getFlag("kg-cities", "year")) || 1986;
  return { year, month: Math.min(12, Math.max(1, (c?.month ?? 0) + 1)), hour: c?.hour ?? 12 };
}

/**
 * Opened by clicking an airport on a KG Cities scene (the GM). Pick who flies (the whole party
 * in one click) and where to: every airport of every other city, with the fare of the day and
 * the time it takes, curb to curb.
 */
export class FlightDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    // Not "kg-transit-flight": that is the flight screen's id, and its styles (full screen, no
    // pointer events) would take the dialog over.
    id: "kg-transit-booking",
    classes: ["kg-transit-board", "kg-transit-booking"],
    tag: "form",
    window: { title: "Book a flight", icon: "fa-solid fa-plane", resizable: true },
    position: { width: 560, height: "auto" },
    form: { handler: FlightDialog.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: { toggleWaive: FlightDialog.#onToggleWaive, wholeParty: FlightDialog.#onWholeParty }
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/flight.hbs` } };

  constructor({ airport, scene, flights }) {
    super();
    this.origin = airport;
    this.scene = scene;
    this.flights = flights;
    this.destCity = null;
    this.destination = null;
    this.bags = true;
    this.waived = new Set();
    this.payFrom = "riders";
    this.candidates = game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
    this.party = game.actors.party ?? game.actors.find((a) => a.type === "group") ?? null;
    // At first: the characters with a token on this scene (they are here to fly).
    const here = new Set(scene.tokens.map((t) => t.actorId));
    this.selected = new Set(this.candidates.filter((a) => here.has(a.id)).map((a) => a.id));
    this.when = when(scene);
    // An encounter on the way: a scene of the GM's, at one of the trip's points.
    this.encounter = { on: false, sceneId: null, at: "air" };
  }

  get title() {
    return `Fly from ${this.origin.name}`;
  }

  #plan() {
    const to = this.airports?.find((a) => a.iata === this.destination);
    return to ? planFlight(this.origin, to, { year: this.when.year, month: this.when.month, bags: this.bags }) : null;
  }

  async _prepareContext() {
    this.airports ??= await loadAirports();
    this.cities ??= await game.modules.get("kg-cities")?.api?.cities?.() ?? [];
    const cityName = (id) => this.cities.find((c) => c.id === id)?.name ?? id;
    const plan = this.#plan();
    const fare = plan ? dollarsToCopper(plan.fare) : 0;
    const riders = this.candidates.map((actor) => {
      const cash = walletValue(actor.system.currency);
      const checked = this.selected.has(actor.id);
      const waived = this.waived.has(actor.id);
      return { id: actor.id, name: actor.name, img: actor.img, checked, waived, cash: formatMoney(cash), short: this.payFrom === "riders" && checked && !waived && cash < fare };
    });
    const paying = riders.filter((r) => r.checked && !r.waived).length;
    const partyCash = this.party ? walletValue(this.party.system.currency) : 0;
    const partyShort = this.payFrom === "party" && partyCash < fare * paying;

    // Every other city with an airport open in the year, then that city's airports.
    const year = this.when.year;
    const open = this.airports.filter((a) => openIn(a, year));
    const cities = [...new Set(open.flatMap((a) => a.cities))]
      .filter((id) => !this.origin.cities.includes(id))
      .map((id) => ({ id, name: cityName(id), selected: id === this.destCity }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const airportsOfCity = this.destCity
      ? open.filter((a) => a.cities.includes(this.destCity)).map((a) => ({ iata: a.iata, name: a.name, selected: a.iata === this.destination }))
      : [];

    const to = this.airports.find((a) => a.iata === this.destination);
    return {
      origin: this.origin,
      riders, cities, airportsOfCity, bags: this.bags,
      plan: plan && {
        ...plan,
        airlineName: AIRLINES[plan.airline].name,
        aircraftName: AIRCRAFT[plan.aircraft].name,
        engines: AIRCRAFT[plan.aircraft].engines,
        steps: plan.steps.map((s) => ({ ...s, time: formatMinutes(s.minutes) })),
        duration: formatMinutes(plan.minutes),
        arrives: formatClock(game.time.worldTime + plan.minutes * 60),
        toName: to?.name ?? plan.to,
        fareText: `$${plan.fare} (${formatMoney(fare)})`,
        fareYear: year
      },
      total: formatMoney(fare * paying),
      party: this.party && { name: this.party.name, cash: formatMoney(partyCash), short: partyShort },
      payFromParty: this.payFrom === "party",
      encounter: {
        on: this.encounter.on,
        scenes: game.scenes.filter((s) => s.id !== this.scene.id).sort((a, b) => a.name.localeCompare(b.name))
          .map((s) => ({ id: s.id, name: s.name, selected: s.id === this.encounter.sceneId })),
        points: plan ? ENCOUNTER_POINTS.map((p) => ({ ...p, time: formatMinutes(minutesUntil(plan, p.key)), selected: p.key === this.encounter.at })) : []
      },
      canFly: !!plan && riders.some((r) => r.checked) && !riders.some((r) => r.short) && !partyShort
        && (!this.encounter.on || !!game.scenes.get(this.encounter.sceneId))
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll("input, select").forEach((el) => el.addEventListener("change", () => this.#readForm()));
  }

  #readForm() {
    const form = this.element;
    const city = form.querySelector("[name=destinationCity]")?.value || null;
    if (city !== this.destCity) {
      // A new city: its airport, when it has only one; otherwise the GM picks.
      this.destCity = city;
      const here = (this.airports ?? []).filter((a) => city && a.cities.includes(city) && openIn(a, this.when.year));
      this.destination = here.length === 1 ? here[0].iata : null;
    } else {
      this.destination = form.querySelector("[name=destination]:checked")?.value || null;
    }
    this.bags = !!form.querySelector("[name=bags]")?.checked;
    this.selected = new Set([...form.querySelectorAll("[name=rider]:checked")].map((el) => el.value));
    this.payFrom = form.querySelector("[name=payFrom]:checked")?.value ?? this.payFrom;
    this.encounter.on = !!form.querySelector("[name=encounter]")?.checked;
    this.encounter.sceneId = form.querySelector("[name=encounterScene]")?.value || this.encounter.sceneId;
    this.encounter.at = form.querySelector("[name=encounterAt]")?.value || this.encounter.at;
    this.render();
  }

  static #onToggleWaive(event, target) {
    const id = target.dataset.actorId;
    if (this.waived.has(id)) this.waived.delete(id);
    else this.waived.add(id);
    this.render();
  }

  /** Everyone in the party group, or every player character when there is no group. */
  static #onWholeParty() {
    const members = partyMembers(this.party).map((a) => a.id).filter((id) => this.candidates.some((c) => c.id === id));
    this.selected = new Set(members.length ? members : this.candidates.map((a) => a.id));
    this.render();
  }

  static async #onSubmit() {
    const plan = this.#plan();
    if (!plan) return;
    const riders = this.candidates.filter((a) => this.selected.has(a.id));
    if (!riders.length) return;
    const fare = dollarsToCopper(plan.fare);
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
      if (broke) return ui.notifications.warn(`${broke[0].name} can't pay for the ticket.`);
      for (const [actor, result] of results) {
        await actor.update({ "system.currency": result.after });
        charged.push({ name: actor.name, value: fare });
      }
    }
    const to = this.airports.find((a) => a.iata === plan.to);
    await this.close();
    await this.flights.start({
      plan, from: this.origin, to,
      riders: riders.map((a) => ({ id: a.id, name: a.name })),
      waived: riders.filter((a) => this.waived.has(a.id)).map((a) => a.name),
      charged, sceneId: this.scene.id, era: this.scene.getFlag("kg-cities", "era") ?? "1980s", year: this.when.year,
      encounter: this.encounter.on && game.scenes.get(this.encounter.sceneId) ? { sceneId: this.encounter.sceneId, at: this.encounter.at } : null
    });
  }
}
