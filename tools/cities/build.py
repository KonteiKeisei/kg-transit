"""Build the city transit packs in data/cities/ from OpenStreetMap and Wikidata.

    python tools/cities/build.py            build every city (downloads are cached)
    python tools/cities/build.py boston     one city
    python tools/cities/build.py --refresh  ignore the download cache

For each city in CITIES below, the rail routes inside its metro box come from OpenStreetMap
(Overpass API): their stops in order, the track between them (tunnels, viaducts and bridges
give each stretch its scenery) and the stations (stop areas, so transfers share a station).
Station opening years come from Wikidata (or the station's start_date tag), so the module can
show the network as it stood in any year. The tables below add what the map data cannot:
which routes count, line names and colours in earlier eras, when lines opened, fares, and
station renames.

OpenStreetMap data (c) OpenStreetMap contributors, ODbL. Wikidata is CC0.
Downloads go to tools/cities/cache/ (gitignored) so rebuilding is quick and polite.
"""
import json
import math
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CACHE = HERE / "cache"
OUT = ROOT / "data" / "cities"
UA = {"User-Agent": "kg-transit-data-builder/4.0 (Foundry VTT module; +https://github.com/KonteiKeisei/kg-transit)"}
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
PACK_VERSION = 1

# Route type to the module's train type (KINDS in scripts/catalog.mjs).
KIND = {"subway": "metro", "light_rail": "light", "tram": "tram", "monorail": "light", "train": "express"}

# Fares are given in US cents and stored in the Boston coin mapping: pp = $1, gp = 25c,
# ep = 10c, sp = 5c, cp = 1c, as the largest coin that makes the fare exactly.
CENTS = [("pp", 100), ("gp", 25), ("ep", 10), ("sp", 5), ("cp", 1)]

# ---------------------------------------------------------------------------------------------
# What to take for each city.
#   systems: Overpass route types and a network/operator regex; refs: only these route refs
#   (None takes all); skip: route refs to leave out.
#   lines: per route ref (or "*"): opened year, closed year, earlier names/colours
#     ("eras": [{ "until": year, "name": ..., "color": ... }]), a colour if the map has none.
#   fares: [[until year or None, cents]]
#   renames: station name -> [[until year, earlier name]]
#   scenery: [[station A, station B, scenery key]] for stretches the track data gets wrong.
#   eras: network name and badge by era.
# ---------------------------------------------------------------------------------------------
CITIES = {
     "los-angeles": {
        "network": "Metro Rail", "badge": "M",
        "systems": [{"routes": "subway|light_rail", "network": r"^Metro Rail$"}],
        "lines": {"A": {"opened": 1990}, "B": {"opened": 1993}, "C": {"opened": 1995}, "D": {"opened": 1996},
                  "E": {"opened": 2012}, "K": {"opened": 2022}},
        "fares": [[None, 175]],
    },
    "las-vegas": {
        "network": "Las Vegas Monorail", "badge": "M",
        "systems": [{"routes": "monorail", "network": r"(Monorail|Las Vegas)"}],
        "lines": {"*": {"opened": 2004, "color": "#00a1de"}},
        "strip": r"\s+Las Vegas Monorail$",
        "fares": [[None, 500]],
    },
    "austin": {
        "network": "CapMetro Rail", "badge": "C",
        "systems": [{"routes": "train", "network": r"^MetroRail$", "refs": ["550"]}],
        "lines": {"550": {"opened": 2010, "color": "#ed1c24"}},
        "fares": [[None, 125]],
    },
    "miami": {
        "network": "Metrorail & Metromover", "badge": "M",
        "systems": [{"routes": "subway", "network": r"^MDT$"},
                    {"routes": "monorail", "network": r"^MDT$"}],
        "lines": {"Green": {"opened": 1984, "eras": [{"until": 2011, "name": "Metrorail"}]},
                  "Orange": {"opened": 2012},
                  "1": {"opened": 1994}, "2": {"opened": 1986}, "3": {"opened": 1994}},
        "fares": [[1990, 100], [None, 225]],
    },
    "boston": {
        "network": "MBTA", "badge": "T",
        "systems": [{"routes": "subway|light_rail", "network": r"^MBTA$"}],
        "lines": {
            "Red": {"opened": 1912}, "Orange": {"opened": 1901}, "Blue": {"opened": 1904},
            "Green-B": {"opened": 1897}, "Green-C": {"opened": 1897}, "Green-D": {"opened": 1959}, "Green-E": {"opened": 1897},
            "Mattapan": {"opened": 1929},
        },
        "fares": [[1990, 75], [None, 240]],
        "scenery": [["Kendall/MIT", "Charles/MGH", "bridge"], ["Revere Beach", "Beachmont", "coast"], ["Wonderland", "Revere Beach", "coast"]],
        # 1986 comes from the module's hand-built MBTA network (snapshot_boston_1986 below).
    },
    "new-york": {
        "network": "NYC Subway", "badge": "M", "transfer": 3,
        "systems": [
            {"routes": "subway", "network": r"^(NYC Subway|Staten Island Railway)$", "skip": [r"^<"]},
            {"routes": "subway", "network": r"^PATH$"},
        ],
        "lines": {"*": {"opened": 1904}, "W": {"opened": 2001}, "Z": {"opened": 1988}, "SIR": {"opened": 1860},
                  "HOB–33": {"opened": 1908}, "HOB–WTC": {"opened": 1909}, "JSQ–33": {"opened": 1908}, "NWK–WTC": {"opened": 1911},
                  "JSQ–33 via HOB": {"opened": 2001, "color": "#fdb827"}},
        "fares": [[1989, 100], [None, 290]],
        "eras": {"1980s": {"network": "NYC Subway & PATH"}, "modern": {"network": "NYC Subway & PATH"}},
    },
    "washington": {
        "network": "Metrorail", "badge": "M",
        "systems": [{"routes": "subway", "network": r"^Washington Metro$"}],
        "lines": {"R": {"opened": 1976}, "B": {"opened": 1977}, "O": {"opened": 1978}, "Y": {"opened": 1983},
                  "G": {"opened": 1991}, "S": {"opened": 2014}},
        "fares": [[1990, 80], [None, 225]],
        "renames": {"Ronald Reagan Washington National Airport": [[1999, "National Airport"]],
                    "Vienna/Fairfax–GMU": [[1998, "Vienna"]]},
    },
    "philadelphia": {
        "network": "SEPTA & PATCO", "badge": "S",
        "systems": [{"routes": "subway|light_rail", "network": r"^(SEPTA|PATCO)$"}],
        "lines": {"L": {"opened": 1907, "eras": [{"until": 2025, "name": "Market–Frankford Line"}]},
                  "B1": {"opened": 1928}, "B2": {"opened": 1928}, "B3": {"opened": 1932},
                  "M": {"opened": 1907, "eras": [{"until": 2025, "name": "Norristown High Speed Line"}]},
                  "PATCO": {"opened": 1969}},
        "fares": [[1990, 100], [None, 250]],
        "scenery": [["Franklin Square", "City Hall", "bridge"]],
    },
    "baltimore": {
        "network": "Baltimore Metro", "badge": "M",
        "systems": [{"routes": "subway|light_rail", "network": r"(MTA|Maryland|Metro SubwayLink|Light RailLink|MDOT)"}],
        "lines": {"*": {"opened": 1983}, "light_rail": {"opened": 1992}},
        "fares": [[1990, 80], [None, 200]],
    },
    "atlanta": {
        "network": "MARTA", "badge": "M",
        "systems": [{"routes": "subway", "network": r"^MARTA$"}],
        "lines": {"Blue": {"opened": 1979, "eras": [{"until": 2008, "name": "East–West Line", "color": "#0274BA"}]},
                  "Red": {"opened": 1981, "eras": [{"until": 2008, "name": "North–South Line", "color": "#F67705"}]},
                  "Gold": {"opened": 1981, "eras": [{"until": 2008, "name": "North–South Line", "color": "#F67705"}]},
                  "Green": {"opened": 1992, "eras": [{"until": 2008, "name": "Proctor Creek Line"}]}},
        "fares": [[1990, 60], [None, 250]],
        "renames": {"Hamilton E. Holmes": [[1988, "Hightower"]]},
    },
    "st-louis": {
        "network": "MetroLink", "badge": "M",
        "systems": [{"routes": "light_rail", "network": r"^MetroLink$"}],
        "lines": {"Red": {"opened": 1993}, "Blue": {"opened": 2006}},
        "fares": [[None, 250]],
    },
    "detroit": {
        "network": "Detroit People Mover", "badge": "PM",
        "systems": [{"routes": "light_rail|monorail", "network": r"Detroit Transportation"},
                    {"routes": "tram", "network": r"^QLine$"}],
        "lines": {"DPM": {"opened": 1987}, "QLine": {"opened": 2017}},
        "fares": [[1999, 50], [None, 75]],
        "eras": {"modern": {"network": "People Mover & QLine"}},
    },
    "chicago": {
        "network": "CTA 'L'", "badge": "L",
        "systems": [{"routes": "subway", "network": r"^CTA$"}],
        "lines": {"Red": {"opened": 1892, "eras": [{"until": 1992, "name": "Howard / Dan Ryan"}]},
                  "Blue": {"opened": 1895, "eras": [{"until": 1992, "name": "O'Hare–Congress"}]},
                  "Brown": {"opened": 1907, "eras": [{"until": 1992, "name": "Ravenswood"}]},
                  "Green": {"opened": 1892, "eras": [{"until": 1992, "name": "Lake / Jackson Park–Englewood"}]},
                  "Purple": {"opened": 1908, "eras": [{"until": 1992, "name": "Evanston"}]},
                  "Yellow": {"opened": 1964, "eras": [{"until": 1992, "name": "Skokie Swift"}]},
                  "Orange": {"opened": 1993}, "Pink": {"opened": 2006}},
        "fares": [[1990, 90], [None, 250]],
    },
    "san-francisco": {
        "network": "BART & Muni Metro", "badge": "B",
        "systems": [{"routes": "subway", "network": r"^BART$"},
                    {"routes": "light_rail", "network": r"^Muni$"}],
        "lines": {"Yellow": {"opened": 1973, "eras": [{"until": 1995, "name": "Concord–Daly City"}]},
                  "Orange": {"opened": 1972, "eras": [{"until": 1995, "name": "Richmond–Fremont"}]},
                  "Green": {"opened": 1974, "eras": [{"until": 1995, "name": "Fremont–Daly City"}]},
                  "Red": {"opened": 1976, "eras": [{"until": 1995, "name": "Richmond–Daly City"}]},
                  "Blue": {"opened": 1997},
                  "J": {"opened": 1980}, "K": {"opened": 1980}, "L": {"opened": 1980}, "M": {"opened": 1980}, "N": {"opened": 1980},
                  "S": {"opened": 2001}, "T": {"opened": 2007}},
        "fares": [[1990, 100], [None, 250]],
    },
}

NAMED_COLORS = {"red": "#d6312b", "blue": "#1f5fbf", "green": "#1e9a4a", "orange": "#ee8a1d", "yellow": "#f2c418",
                "gray": "#808080", "grey": "#808080", "purple": "#8a3fb6", "brown": "#7a4a2a", "pink": "#e27ea6",
                "skyblue": "#87ceeb", "silver": "#a0a0a0", "white": "#dddddd"}


# ---------------------------------------------------------------------------------------------
# Downloads
# ---------------------------------------------------------------------------------------------

REFRESH = "--refresh" in sys.argv


def fetch_json(url, data=None, cache_name=None, tries=6):
    path = CACHE / cache_name if cache_name else None
    if path and path.exists() and not REFRESH:
        return json.loads(path.read_text(encoding="utf-8"))
    last = None
    for attempt in range(tries):
        target = url[attempt % len(url)] if isinstance(url, list) else url
        try:
            req = urllib.request.Request(target, data=data, headers=UA)
            with urllib.request.urlopen(req, timeout=240) as res:
                body = json.loads(res.read().decode("utf-8"))
            if path:
                CACHE.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(body), encoding="utf-8")
            time.sleep(2)
            return body
        except Exception as ex:  # timeouts and 429/504 from busy servers
            last = ex
            print(f"    retry {attempt + 1}: {ex}")
            time.sleep(8 + attempt * 8)
    raise RuntimeError(f"download failed: {last}")


def overpass(query, cache_name):
    return fetch_json(OVERPASS, urllib.parse.urlencode({"data": query}).encode(), cache_name)


def wikidata_years(qids, cache_name):
    """Opening and closing years for Wikidata items: official opening, else inception."""
    out = {}
    qids = sorted(q for q in qids if re.fullmatch(r"Q\d+", q or ""))
    for i in range(0, len(qids), 150):
        chunk = qids[i:i + 150]
        sparql = ("SELECT ?s ?open ?inc ?close ?end WHERE { VALUES ?s { " + " ".join("wd:" + q for q in chunk) + " } "
                  "OPTIONAL { ?s wdt:P1619 ?open } OPTIONAL { ?s wdt:P571 ?inc } "
                  "OPTIONAL { ?s wdt:P3999 ?close } OPTIONAL { ?s wdt:P576 ?end } }")
        url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(sparql)
        res = fetch_json(url, None, f"{cache_name}-{i // 150}.json")
        for row in res["results"]["bindings"]:
            q = row["s"]["value"].rsplit("/", 1)[-1]
            rec = out.setdefault(q, {"opened": None, "closed": None})
            for key, field in (("open", "opened"), ("inc", "opened"), ("close", "closed"), ("end", "closed")):
                year = _year(row.get(key, {}).get("value"))
                if year is None:
                    continue
                # The earliest opening, and official opening over inception.
                if field == "opened":
                    if rec.get("_src") == "open" and key == "inc":
                        continue
                    if key == "open" and rec.get("_src") != "open":
                        rec["opened"] = year
                        rec["_src"] = "open"
                    elif rec["opened"] is None or year < rec["opened"]:
                        rec["opened"] = year
                        rec["_src"] = rec.get("_src") or key
                elif rec["closed"] is None or year > rec["closed"]:
                    rec["closed"] = year
    return out


def _year(value):
    m = re.match(r"^\+?(\d{4})", str(value or ""))
    return int(m.group(1)) if m else None


# ---------------------------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------------------------

def metres(a, b):
    k = math.pi / 180
    x = (b[1] - a[1]) * math.cos((a[0] + b[0]) / 2 * k)
    y = b[0] - a[0]
    return math.hypot(x, y) * k * 6371000


def box(center, miles):
    lon, lat = center
    dlat = miles[1] * 1609.344 / 111320 / 2
    dlon = miles[0] * 1609.344 / (111320 * math.cos(math.radians(lat))) / 2
    return (lat - dlat, lon - dlon, lat + dlat, lon + dlon)


def slug(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "stop"


def norm_name(text):
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    text = re.sub(r"\b(station|stn|street|st|avenue|ave|av|square|sq|road|rd|boulevard|blvd|the)\b", "", text)
    return re.sub(r"[^a-z0-9]+", "", text)


def way_kind(tags):
    """Track character from a way's tags: tunnel, water bridge, elevated or surface."""
    if tags.get("tunnel") in ("yes", "building_passage", "culvert") or tags.get("location") == "underground":
        return "tunnel"
    try:
        layer = int(str(tags.get("layer", "0")).split(";")[0])
    except ValueError:
        layer = 0
    if layer < 0 and tags.get("covered") != "no" and not tags.get("bridge"):
        return "tunnel"
    if tags.get("bridge") and tags.get("bridge") != "no":
        name = f"{tags.get('bridge:name', '')} {tags.get('name', '')}"
        if re.search(r"bridge", name, re.I) and tags.get("bridge") != "viaduct":
            return "water"
        return "elevated"
    if tags.get("embankment") == "yes" or layer >= 1:
        return "elevated"
    return "surface"


class Chain:
    """A route's track as one polyline, ways joined end to end, each point tagged with its kind."""

    def __init__(self, members, way_tags):
        self.points = []  # (lat, lon, kind)
        ways = [m for m in members if m["type"] == "way" and m.get("geometry") and m.get("role", "") in ("", "forward", "backward")]
        geoms = [[(p["lat"], p["lon"]) for p in w["geometry"] if p] for w in ways]
        for i, (w, g) in enumerate(zip(ways, geoms)):
            if len(g) < 2:
                continue
            kind = way_kind(way_tags.get(w["ref"], {}))
            if self.points:
                end = self.points[-1][:2]
                if metres(end, g[-1]) < metres(end, g[0]):
                    g = g[::-1]
            elif i + 1 < len(geoms) and geoms[i + 1]:
                nxt = geoms[i + 1]
                if min(metres(g[0], nxt[0]), metres(g[0], nxt[-1])) < min(metres(g[-1], nxt[0]), metres(g[-1], nxt[-1])):
                    g = g[::-1]
            self.points.extend((lat, lon, kind) for lat, lon in g)

    def locate(self, pos, start=0):
        """Index of the chain point nearest pos, at or after start when that is close enough."""
        if not self.points:
            return None
        if not hasattr(self, "_xy"):
            # Local planar metres (fine at city scale), so the search needs no trigonometry.
            self._k = math.cos(math.radians(self.points[0][0]))
            self._xy = [(p[1] * self._k * 111320, p[0] * 111320) for p in self.points]
        px, py = pos[1] * self._k * 111320, pos[0] * 111320
        xy = self._xy

        def nearest(lo, hi):
            best, best_d = None, 1e30
            for j in range(lo, hi):
                dx = xy[j][0] - px
                dy = xy[j][1] - py
                d = dx * dx + dy * dy
                if d < best_d:
                    best, best_d = j, d
            return best, best_d

        best, best_d = nearest(start, len(xy))
        if best_d > 400 ** 2:
            best, best_d = nearest(0, len(xy))
        return best if best_d < 800 ** 2 else None

    def mix(self, i, j):
        """Metres of each track kind between two chain indexes."""
        out = {}
        if i is None or j is None:
            return out
        a, b = sorted((i, j))
        for k in range(a, b):
            p, q = self.points[k], self.points[k + 1]
            out[q[2]] = out.get(q[2], 0) + metres(p[:2], q[:2])
        return out


# ---------------------------------------------------------------------------------------------
# One city
# ---------------------------------------------------------------------------------------------

def build_city(city, spec):
    cid = city["id"]
    s, w, n, e = box(city["metro"]["center"], city["metro"]["miles"])
    bbox = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
    types = "|".join(sorted({t for sys_ in spec["systems"] for t in sys_["routes"].split("|")}))
    sel = f'rel["type"="route"]["route"~"^({types})$"]({bbox})'
    print(f"  routes ({types})")
    routes = overpass(f"[out:json][timeout:240];{sel};out body geom;", f"{cid}-routes.json")["elements"]
    print("  stops, ways and stations")
    extra = overpass(
        f"[out:json][timeout:240];{sel}->.r;way(r.r);out tags;node(r.r);out body;"
        f"node(r.r)->.n;rel(bn.n)[\"public_transport\"=\"stop_area\"]->.sa;.sa out body;"
        f"nwr(r.sa)[~\"^(railway|public_transport)$\"~\"^station$\"];out tags center;"
        f"rel(br.sa)[\"public_transport\"=\"stop_area_group\"];out body;"
        f"nwr[\"railway\"=\"station\"]({bbox});out tags center;",
        f"{cid}-extra.json")["elements"]

    way_tags = {el["id"]: el.get("tags", {}) for el in extra if el["type"] == "way" and "center" not in el}
    nodes = {el["id"]: el for el in extra if el["type"] == "node" and "lat" in el}
    station_els = {}
    for el in extra:
        t = el.get("tags", {})
        if t.get("railway") == "station" or t.get("public_transport") == "station":
            key = f"{el['type'][0]}{el['id']}"
            c = el.get("center") or ({"lat": el["lat"], "lon": el["lon"]} if "lat" in el else None)
            if c:
                station_els[key] = {"tags": t, "pos": (c["lat"], c["lon"])}
    grid = {}
    for k, st in station_els.items():
        grid.setdefault((round(st["pos"][0] * 200), round(st["pos"][1] * 200)), []).append((k, st))

    def near_stations(pos):
        # Cells of about 550 m; the 3 x 3 block around pos covers the 300 m search.
        ci, cj = round(pos[0] * 200), round(pos[1] * 200)
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                yield from grid.get((ci + di, cj + dj), [])

    stop_areas = [el for el in extra if el["type"] == "relation" and el.get("tags", {}).get("public_transport") == "stop_area"]
    groups = [el for el in extra if el["type"] == "relation" and el.get("tags", {}).get("public_transport") == "stop_area_group"]

    # Which stop area each stop node belongs to.
    area_of = {}
    for sa in stop_areas:
        for m in sa.get("members", []):
            area_of.setdefault((m["type"], m["ref"]), sa)

    # Keep the routes this city counts.
    def counted(rel):
        t = rel.get("tags", {})
        if t.get("state") in ("proposed", "construction", "disused") or "proposed" in (t.get("name") or "").lower():
            return None
        for sys_ in spec["systems"]:
            if t.get("route") not in sys_["routes"].split("|"):
                continue
            net = t.get("network") or t.get("operator") or ""
            if not re.search(sys_["network"], net) and not re.search(sys_["network"], t.get("operator") or ""):
                continue
            ref = t.get("ref") or t.get("name") or ""
            if sys_.get("refs") and ref not in sys_["refs"]:
                continue
            if any(re.search(p, ref) for p in sys_.get("skip", [])):
                continue
            return ref
        return None

    # ---- stations: one record per stop area / station, merged across lines -------------------
    parent = {}

    def find(k):
        while parent.setdefault(k, k) != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    info = {}  # station key -> {name, pos, wikidata, start, underground votes}

    def station_key(member, pos, name):
        sa = area_of.get((member["type"], member["ref"]))
        if sa:
            for m in sa.get("members", []):
                k = f"{m['type'][0]}{m['ref']}"
                if k in station_els:
                    return k, station_els[k]["tags"], station_els[k]["pos"]
            k = f"r{sa['id']}"
            return k, sa.get("tags", {}), pos
        # No stop area: the nearest railway station with a matching name, else the stop itself.
        best, best_d = None, 300
        for k, st in near_stations(pos):
            d = metres(pos, st["pos"])
            if d < best_d and (not name or norm_name(st["tags"].get("name")) in (norm_name(name), "") or d < 120):
                best, best_d = k, d
        if best:
            return best, station_els[best]["tags"], station_els[best]["pos"]
        return f"{member['type'][0]}{member['ref']}", nodes.get(member["ref"], {}).get("tags", {}) if member["type"] == "node" else {}, pos

    services = []  # (ref, rel, [station keys], [chain idx], chain, [underground flags])
    for rel in routes:
        ref = counted(rel)
        if ref is None:
            continue
        members = rel.get("members", [])
        chain = Chain(members, way_tags)

        def entry(m):
            if m["type"] == "node":
                pos = (m.get("lat") or nodes.get(m["ref"], {}).get("lat"), m.get("lon") or nodes.get(m["ref"], {}).get("lon"))
                tags = nodes.get(m["ref"], {}).get("tags", {})
            else:
                g = [p for p in m.get("geometry", []) if p]
                if not g:
                    return None
                pos = (sum(p["lat"] for p in g) / len(g), sum(p["lon"] for p in g) / len(g))
                tags = {}
            if pos[0] is None:
                return None
            key, stags, spos = station_key(m, pos, tags.get("name"))
            primary = bool(stags.get("name"))
            name = stags.get("name") or tags.get("name") or "Stop"
            rec = info.setdefault(key, {"names": [], "pos": spos, "wikidata": stags.get("wikidata"),
                                        "start": _year(stags.get("start_date")), "under": 0, "over": 0})
            rec["names"].append((primary, name))
            if tags.get("location") == "underground" or str(tags.get("level", "0")).startswith("-") or tags.get("tunnel") == "yes":
                rec["under"] += 1
            return key, pos

        # Stops in member order; stations mapped only by a platform are slotted in where the
        # track passes them (some relations list stops, then platforms, so order comes from those).
        seq = []
        for m in members:
            if m["type"] == "node" and m.get("role", "") in ("stop", "stop_entry_only", "stop_exit_only"):
                e = entry(m)
                if e and (not seq or seq[-1][0] != e[0]):
                    seq.append(e)
        idx, at = [], 0
        for key, pos in seq:
            j = chain.locate(pos, at)
            idx.append(j)
            if j is not None:
                at = j
        have = {k for k, _ in seq}
        for m in members:
            if not m.get("role", "").startswith("platform"):
                continue
            e = entry(m)
            if not e or e[0] in have:
                continue
            j = chain.locate(e[1])
            if j is None and seq:
                continue
            have.add(e[0])
            spot = len(seq)
            if seq and j is not None:
                forward = (idx[0] or 0) <= (idx[-1] or 0)
                for k, jk in enumerate(idx):
                    if jk is not None and ((jk > j) if forward else (jk < j)):
                        spot = k
                        break
            seq.insert(spot, e)
            idx.insert(spot, j)
        if len(seq) < 2:
            continue
        for (key, _), j in zip(seq, idx):
            if j is not None:
                info[key]["under" if chain.points[j][2] == "tunnel" else "over"] += 1
        services.append({"ref": ref, "rel": rel, "keys": [k for k, _ in seq], "idx": idx, "chain": chain})

    # Stop areas grouped into one complex, and same-named stations close together, are one station.
    for g in groups:
        keys = []
        for m in g.get("members", []):
            sa_key = f"r{m['ref']}"
            for k in info:
                if k == sa_key:
                    keys.append(k)
            for sa in stop_areas:
                if sa["id"] == m["ref"]:
                    for mm in sa.get("members", []):
                        k = f"{mm['type'][0]}{mm['ref']}"
                        if k in info:
                            keys.append(k)
        for k in keys[1:]:
            union(keys[0], k)
    by_name = {}
    for k in info:
        by_name.setdefault(norm_name(_own_name(info[k])), []).append(k)
    for same in by_name.values():
        for i, a in enumerate(same):
            for b in same[i + 1:]:
                if metres(info[a]["pos"], info[b]["pos"]) < 450:
                    union(a, b)

    # ---- opening years ------------------------------------------------------------------------
    years = wikidata_years({r["wikidata"] for r in info.values() if r.get("wikidata")}, f"{cid}-wikidata")

    merged = {}
    for k, rec in info.items():
        root = find(k)
        m = merged.setdefault(root, {"names": [], "pos": [], "opened": [], "closed": [], "under": 0, "over": 0})
        m["names"].extend(rec["names"])
        m["pos"].append(rec["pos"])
        y = years.get(rec.get("wikidata") or "", {})
        if y.get("opened") or rec.get("start"):
            m["opened"].append(y.get("opened") or rec.get("start"))
        if y.get("closed"):
            m["closed"].append(y["closed"])
        m["under"] += rec["under"]
        m["over"] += rec["over"]

    ids = {}
    stations = []
    used = set()
    renames = spec.get("renames", {})
    for root, m in merged.items():
        # The station's own name, the most common, else the longest (stop nodes are often short).
        pool = [n for p, n in m["names"] if p] or [n for _, n in m["names"]]
        name = max(set(pool), key=lambda x: (pool.count(x), len(x)))
        name = re.sub(r"\s+(Station|station)$", "", name)
        if spec.get("strip"):
            name = re.sub(spec["strip"], "", name)
        sid = base_id = slug(name)
        n = 1
        while sid in used:
            n += 1
            sid = f"{base_id}-{n}"
        used.add(sid)
        ids[root] = sid
        lat = sum(p[0] for p in m["pos"]) / len(m["pos"])
        lon = sum(p[1] for p in m["pos"]) / len(m["pos"])
        rec = {"id": sid, "name": name, "lat": round(lat, 6), "lon": round(lon, 6),
               "platform": "underground" if m["under"] > m["over"] else "above"}
        if m["opened"]:
            rec["opened"] = min(m["opened"])
        if m["closed"] and not m["opened"] or (m["closed"] and max(m["closed"]) > min(m["opened"] or [0])):
            # A closing date on a station still in the map data is usually an old station on
            # the site; only trust it when it is in the past and nothing reopened it.
            pass
        if name in renames:
            rec["names"] = [{"until": u, "name": nm} for u, nm in renames[name]]
        stations.append(rec)

    # ---- lines: one per distinct service pattern ------------------------------------------------
    by_ref = {}
    for sv in services:
        sv["stops"] = []
        for k in sv["keys"]:
            sid = ids[find(k)]
            if not sv["stops"] or sv["stops"][-1] != sid:
                sv["stops"].append(sid)
        # A loop (Metromover, People Mover) comes back to its first stop; the network keeps each
        # station once per line, so the loop ends at the stop before.
        if len(sv["stops"]) > 2 and sv["stops"][0] == sv["stops"][-1]:
            sv["stops"].pop()
        if len(sv["stops"]) >= 2:
            by_ref.setdefault(sv["ref"], []).append(sv)

    qualifier = re.compile(r"\((?:[^)]*(?:rush|night|weekend|late|peak|special|short|game|event|evening)[^)]*)\)|special|post-game", re.I)
    lines = []
    station_by_id = {s["id"]: s for s in stations}
    center = (city["center"][1], city["center"][0])
    for ref, group in sorted(by_ref.items()):
        base = [sv for sv in group if not qualifier.search(sv["rel"]["tags"].get("name", ""))]
        group = base or group
        kept = []
        for sv in sorted(group, key=lambda x: -len(x["stops"])):
            seq = sv["stops"]
            if any(set(seq) <= set(other["stops"]) or _same_route(seq, other["stops"]) for other in kept):
                continue
            kept.append(sv)
        meta = {**spec["lines"].get("*", {}), **spec["lines"].get(ref, {}), **spec["lines"].get(group[0]["rel"]["tags"].get("route"), {})}
        tags = kept[0]["rel"]["tags"]
        color = _color(tags.get("colour")) or meta.get("color") or "#888888"
        base_name = _line_name(tags, ref)
        # Variants with their own names (the three "S" shuttles) keep them.
        own_names = [_line_name(sv["rel"]["tags"], ref) for sv in kept]
        distinct = len(set(own_names)) == len(kept)
        for sv, own_name in zip(kept, own_names):
            seq = sv["stops"]
            label = base_name
            if len(kept) > 1 and distinct:
                label = own_name
            elif len(kept) > 1:
                ends = {s for o in kept for s in (o["stops"][0], o["stops"][-1]) if o is not sv}
                own = [s for s in (seq[-1], seq[0]) if s not in ends] or [seq[-1]]
                label = f"{base_name} ({station_by_id[own[0]]['name']})"
            segments = []
            for i in range(len(seq) - 1):
                segments.append(_scenery(sv, i, station_by_id, center, spec))
            seq, segments = _visit_once(seq, segments)
            line = {"id": slug(f"{ref}-{label}") if len(kept) > 1 else slug(ref), "name": label, "color": color,
                    "kind": KIND.get(tags.get("route"), "metro"), "stops": seq, "segments": segments}
            for key in ("opened", "closed"):
                if meta.get(key):
                    line[key] = meta[key]
            if meta.get("eras"):
                line["names"] = [{k: v for k, v in era.items() if k in ("until", "name", "color")} for era in meta["eras"]]
                if len(kept) > 1:
                    for era in line["names"]:
                        if "name" in era:
                            era["name"] = f"{era['name']}{label[len(base_name):]}"
            lines.append(line)
    # Lines of different routes that ended up with the same name (PATH's) are told apart by their ends.
    counts = {}
    for line in lines:
        counts[line["name"]] = counts.get(line["name"], 0) + 1
    for line in lines:
        if counts[line["name"]] > 1:
            a, b = station_by_id[line["stops"][0]]["name"], station_by_id[line["stops"][-1]]["name"]
            line["name"] = f"{line['name']} ({a}–{b})"
    _unique_ids(lines)
    used_stations = {s for line in lines for s in line["stops"]}
    stations = [s for s in stations if s["id"] in used_stations]
    return stations, lines


def _visit_once(stops, segments):
    """A route that passes a station again (Metromover's loops) keeps its first visit; the
    stretches either side of a later visit join, keeping the first one's scenery."""
    out, segs, seen = [stops[0]], [], {stops[0]}
    pending = None
    for stop, seg in zip(stops[1:], segments):
        pending = pending or seg
        if stop in seen:
            continue
        seen.add(stop)
        out.append(stop)
        segs.append(pending)
        pending = None
    return out, segs


def _same_route(a, b):
    """The other direction of the same route: the same two ends, at most one station different."""
    return {a[0], a[-1]} == {b[0], b[-1]} and len(set(a) ^ set(b)) <= max(2, len(a) // 10)


def _own_name(rec):
    primary = [n for p, n in rec["names"] if p]
    return (primary or [n for _, n in rec["names"]] or [""])[0]


def _contains(seq, sub):
    """Whether sub is a contiguous run of seq."""
    if len(sub) > len(seq):
        return False
    for i in range(len(seq) - len(sub) + 1):
        if seq[i:i + len(sub)] == sub:
            return True
    return False


def _color(value):
    if not value:
        return None
    value = value.strip()
    if re.fullmatch(r"#?[0-9a-fA-F]{6}", value):
        return "#" + value.lstrip("#").upper()
    return NAMED_COLORS.get(value.lower())


def _line_name(tags, ref):
    name = tags.get("name") or ref
    name = re.split(r"\s*:\s*", name)[0]
    name = re.sub(r"^(MBTA|WMATA|CTA|MARTA|SEPTA|BART|NYCS -|MDT|Metro)\s+", "", name)
    name = re.sub(r"\s*\([^)]*(?:inbound|outbound|other times|all times|rush)[^)]*\)$", "", name, flags=re.I)
    name = re.sub(r"\s+(inbound|outbound|northbound|southbound|eastbound|westbound)\b.*$", "", name, flags=re.I)
    if re.fullmatch(r"[A-Z0-9]{1,2}", ref or "") and re.match(r"^\S+ Train$", name):
        return f"{ref} Train"
    return name.strip() or ref


def _scenery(sv, i, station_by_id, center, spec):
    a, b = sv["stops"][i], sv["stops"][i + 1]
    for x, y, scenery in spec.get("scenery", []):
        names = {station_by_id[a]["name"], station_by_id[b]["name"]}
        if names == {x, y}:
            return scenery
    mix = sv["chain"].mix(_idx_of(sv, i), _idx_of(sv, i + 1))
    total = sum(mix.values())
    if total > 50:
        if mix.get("tunnel", 0) > total * 0.5:
            return "tunnel-concrete"
        if mix.get("water", 0) > 250:
            return "bridge"
        if mix.get("elevated", 0) + mix.get("water", 0) > total * 0.5:
            return "elevated"
    else:
        sa, sb = station_by_id[a], station_by_id[b]
        if sa["platform"] == "underground" and sb["platform"] == "underground":
            return "tunnel-concrete"
    mid = ((station_by_id[a]["lat"] + station_by_id[b]["lat"]) / 2, (station_by_id[a]["lon"] + station_by_id[b]["lon"]) / 2)
    miles = metres(mid, center) / 1609.344
    if miles < 1.2:
        return "downtown"
    if miles < 5:
        return "city"
    return "suburb"


def _idx_of(sv, i):
    # The chain index of the i-th merged stop (stops collapse repeated keys, so map back).
    k = 0
    last = None
    for key, j in zip(sv["keys"], sv["idx"]):
        if key != last:
            if k == i:
                return j
            k += 1
            last = key
    return None


def _unique_ids(lines):
    seen = {}
    for line in lines:
        base = line["id"]
        n = seen.get(base, 0)
        seen[base] = n + 1
        if n:
            line["id"] = f"{base}-{n + 1}"


def fare_coins(cents):
    for coin, value in CENTS:
        if cents % value == 0:
            return {"amount": cents // value, "coin": coin}
    return {"amount": cents, "coin": "cp"}


# ---------------------------------------------------------------------------------------------
# Boston in 1986: a hand-built MBTA network, exact for the year (the Washington Street Elevated,
# the Green Line E cut back to Heath Street, no Silver Line), kept in tools/cities/boston-1986.json.
# ---------------------------------------------------------------------------------------------

def snapshot_boston_1986():
    return json.loads((HERE / "boston-1986.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------------------------

def main():
    index = json.loads((HERE / "index.json").read_text(encoding="utf-8"))
    wanted = [a for a in sys.argv[1:] if not a.startswith("--")]
    OUT.mkdir(parents=True, exist_ok=True)
    summary = []
    for city in index:
        if wanted and city["id"] not in wanted:
            continue
        spec = CITIES.get(city["id"])
        if not spec:
            continue
        print(f"{city['name']}")
        stations, lines = build_city(city, spec)
        fares = [{"until": until, **fare_coins(cents)} if until else fare_coins(cents) for until, cents in spec["fares"]]
        pack = {
            "id": city["id"], "name": city["name"], "state": city["state"], "version": PACK_VERSION,
            "center": city["center"], "metro": city["metro"], "core": city["core"],
            "network": {"name": spec["network"], "badge": spec["badge"], "transferMinutes": spec.get("transfer", 4)},
            "eras": spec.get("eras", {}),
            "fares": fares,
            "stations": stations,
            "lines": lines,
            "snapshots": {},
            "attribution": "Stations and routes: OpenStreetMap contributors (ODbL). Opening dates: Wikidata (CC0).",
        }
        if city["id"] == "boston":
            pack["snapshots"]["1980s"] = snapshot_boston_1986()
        (OUT / f"{city['id']}.json").write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        dated = sum(1 for s in stations if s.get("opened"))
        summary.append(f"{city['id']:15} {len(lines):3} lines {len(stations):4} stations ({dated} dated)")
        print("  " + summary[-1])
    available = sorted(p.stem for p in OUT.glob("*.json") if p.stem != "index")
    (OUT / "index.json").write_text(json.dumps(available), encoding="utf-8")
    print("\n".join(summary))


if __name__ == "__main__":
    main()
