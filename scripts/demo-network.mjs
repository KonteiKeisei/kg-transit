// A small sample network: four lines, three transfer stations, every kind of train, and a
// spread of scenery. The theme comes from the world setting, except the Valley Railway, which
// is always Industrial to show a line's own theme. A scene's first network starts as this
// (see starterNetwork), and the tests and browser preview use it as placed here.

/** Map scale for the sample: 100 px is 200 m. */
export const KM_PER_PX = 0.002;

const station = (id, name, x, y) => ({ id, name, x, y });
const seg = (scenery, minutes = null) => ({ scenery, minutes });

export const DEMO = {
  name: "City Transit",
  badge: "M",
  theme: null,
  fare: { amount: 2, coin: "sp" },
  transferMinutes: 4,
  stations: [
    station("a", "Northgate", 600, 400),
    station("b", "Market Square", 1100, 800),
    station("c", "Central", 1600, 1200),
    station("d", "Riverside", 2300, 1500),
    station("e", "Elm Park", 3000, 1700),
    station("f", "Valley Junction", 3700, 1900),
    station("g", "Harbour", 900, 2000),
    station("h", "Fish Quay", 2200, 2400),
    station("i", "Lighthouse Point", 3000, 2800),
    station("j", "Millbrook", 4600, 2000),
    station("k", "Darkwood", 5400, 2300),
    station("l", "High Pass", 6300, 2100),
    station("m", "Castle Gate", 700, 1200),
    station("n", "Guild Row", 1500, 500)
  ],
  lines: [
    { id: "central", name: "Central Line", color: "#d6312b", kind: "metro", stops: ["a", "b", "c", "d", "e", "f"],
      segments: [seg("tunnel-concrete"), seg("tunnel-concrete"), seg("city"), seg("bridge"), seg("suburb")] },
    { id: "harbour", name: "Harbour Line", color: "#1f5fbf", kind: "light", stops: ["c", "g", "h", "i"],
      segments: [seg("tunnel-brick"), seg("dockside"), seg("coast")] },
    { id: "valley", name: "Valley Railway", color: "#7a4a2a", kind: "steam", theme: "industrial", stops: ["f", "j", "k", "l"],
      segments: [seg("countryside"), seg("forest"), seg("mountains", 12)] },
    { id: "oldtown", name: "Old Town Tram", color: "#1e9a4a", kind: "tram", stops: ["m", "b", "n"],
      segments: [seg("fantasy"), seg("fantasy")] }
  ]
};

/**
 * A new scene's network: the sample lines and stops, with every stop waiting to be placed
 * on this scene's map. Rename, recolour or delete anything to make it your own.
 */
export function starterNetwork() {
  const net = structuredClone(DEMO);
  for (const s of net.stations) Object.assign(s, { x: null, y: null });
  net.partyTokenId = null;
  return net;
}
