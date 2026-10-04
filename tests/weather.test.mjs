import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO, KM_PER_PX } from "../scripts/demo-network.mjs";
import { CARS, KINDS, SCENERY, carFor, isTunnel } from "../scripts/catalog.mjs";
import { findTrip, normalize } from "../scripts/network.mjs";
import { isOutdoors, seasonOf, timeOfDay, tripKeys } from "../scripts/scenery.mjs";
import { THEMES } from "../scripts/themes.mjs";
import { rideWeather } from "../scripts/weather.mjs";

const net = normalize(DEMO);

test("Calendaria presets map to sky and precipitation", () => {
  assert.equal(rideWeather({ id: "clear" }).sky, "clear");
  assert.equal(rideWeather({ id: "partly-cloudy" }).sky, "partly");
  assert.equal(rideWeather({ id: "overcast" }).sky, "overcast");
  const rain = rideWeather({ id: "rain" });
  assert.equal(rain.precip, "rain");
  assert.ok(rain.intensity > rideWeather({ id: "drizzle" }).intensity);
  assert.equal(rideWeather({ id: "blizzard" }).precip, "snow");
  assert.equal(rideWeather({ id: "thunderstorm" }).lightning, true);
  assert.ok(rideWeather({ id: "fog" }).fog > 0.5);
});

test("unknown presets fall back on their precipitation and cloud effect", () => {
  const custom = rideWeather({ id: "squall", precipitation: { type: "snow", intensity: 0.8 }, wind: { speed: 4 } });
  assert.equal(custom.precip, "snow");
  assert.equal(custom.sky, "storm");
  assert.equal(rideWeather({ id: "gloom", hudEffect: "clouds-heavy" }).sky, "cloudy");
  assert.equal(rideWeather(null).sky, "clear");
});

test("time of day and season", () => {
  assert.equal(timeOfDay(12), "day");
  assert.equal(timeOfDay(18), "dusk");
  assert.equal(timeOfDay(23), "night");
  assert.equal(seasonOf(0), "winter");
  assert.equal(seasonOf(9), "fall");
  assert.equal(seasonOf(6), "summer");
});

test("every scenery choice draws a known near and far layer, or is a tunnel", () => {
  const tunnels = new Set(["theme", ...Object.values(THEMES).map((t) => t.tunnel)]);
  for (const [key, s] of Object.entries(SCENERY)) {
    if (isTunnel(key)) assert.ok(tunnels.has(s.tunnel), key);
    else assert.ok(s.near && s.far, key);
  }
});

test("every train type sits in a known car", () => {
  for (const kind of Object.keys(KINDS)) assert.ok(carFor(kind) === CARS[KINDS[kind].car], kind);
  assert.equal(carFor("steam"), CARS.steam);
});

test("a trip's scenery keys cover its tunnels, platforms and open country", () => {
  const trip = findTrip(net, "a", "d", KM_PER_PX);
  const keys = tripKeys(trip, { hour: 21, month: 0, weather: rideWeather({ id: "snow" }) });
  assert.ok(keys.includes("tunnel:concrete:modern"));
  // Tunnels reach Northgate, so its platform is underground; Riverside is out in the open.
  assert.ok(keys.some((k) => k.startsWith("station:tile:Northgate:")));
  assert.ok(keys.some((k) => k.startsWith("platform:modern:city:night:winter:") && k.includes(":Riverside:")));
  assert.ok(keys.some((k) => k.startsWith("outdoor:modern:city:city:night:winter:") && k.endsWith(":overcast")));
  assert.ok(keys.filter(isOutdoors).length >= 2);
});

test("the theme reaches the tunnels, platforms and scenery", () => {
  const trip = findTrip(net, "a", "d", KM_PER_PX, "future");
  const keys = tripKeys(trip, {});
  assert.ok(keys.includes("tunnel:cyber:future"));
  assert.ok(keys.some((k) => k.startsWith("station:neon:Northgate:")));
  assert.ok(keys.some((k) => k.startsWith("platform:future:")));
  assert.ok(keys.some((k) => k.startsWith("outdoor:future:city:")));
});

test("a brick tunnel stays brick whatever the theme", () => {
  const trip = findTrip(net, "c", "g", KM_PER_PX, "future");
  assert.ok(tripKeys(trip, {}).includes("tunnel:brick:future"));
});