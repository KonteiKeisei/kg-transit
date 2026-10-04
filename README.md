# KG Transit

Build subway, tram and steam railway lines on any Foundry scene, place their stops on the map, and let your party ride them. A ride runs game time in real time: the party sits in the car while the city, countryside or tunnels stream past the windows, the weather from Calendaria falls outside, and their token travels the line on the map until the train pulls in.

- **Requires:** Foundry VTT v13 and the **Calendaria** module. Fares and party features use the **dnd5e** system (5.3.3).
- **Ships with:** four themes (Modern, Industrial, Fantasy, Future), a subway car and a steam coach interior, 17 kinds of scenery, underground and above-ground platforms, and a sample network to start from.
- **Real cities:** on a **[KG Cities](https://github.com/KonteiKeisei/kg-cities)** scene, the city's real rail network is set up for you, as it ran in the scene's era (the 1980s or today). See [Real cities](#real-cities-kg-cities).
- **Sounds that ship with it:** the subway ride loop (used by the city networks), the jet engines and the airport terminal's ambiance. For your own networks you choose the sound for each car in the module settings.
- **Guides:** the [KG Transit wiki](https://github.com/KonteiKeisei/kg-transit/wiki) walks through building networks for fantasy, modern and futuristic settings.

> **Works with [KG Cities](https://github.com/KonteiKeisei/kg-cities).** KG Cities is a good module on its own: it turns real US cities into Foundry scenes from OpenStreetMap, in the 1980s or today. With KG Transit beside it, those scenes come alive: each city scene gets **its real metro set up automatically** for its era, and the city's airports become **flights between cities**, curb to curb, with the airport terminal, the jet bridge and the plane. Neither module needs the other; together they make a whole country you can travel. See [Real cities](#real-cities-kg-cities) and [Air travel between cities](#12-air-travel-between-cities).

---

## Contents

1. [Install](#install)
2. [Real cities (KG Cities)](#real-cities-kg-cities)
3. [Set the scene's scale first](#1-set-the-scenes-scale-first)
4. [Open the network editor](#2-open-the-network-editor)
5. [Lines](#3-lines)
6. [Stops and placing them](#4-stops-and-placing-them)
7. [Transfer stations](#5-transfer-stations)
8. [Scenery between stops](#6-scenery-between-stops)
9. [Themes](#7-themes)
10. [Platforms: underground or above ground](#8-platforms-underground-or-above-ground)
11. [Network settings: name, badge, fare, party token](#9-network-settings)
12. [Riding](#10-riding)
13. [During a ride](#11-during-a-ride)
14. [Air travel between cities](#12-air-travel-between-cities)
15. [Module settings](#module-settings)
16. [How travel time is worked out](#how-travel-time-is-worked-out)
17. [Weather, time of day and seasons](#weather-time-of-day-and-seasons)
18. [Troubleshooting](#troubleshooting)
19. [For developers](#for-developers)

---

## Install

1. In Foundry's **Add-on Modules > Install Module**, paste this manifest URL and click **Install**:
   `https://github.com/KonteiKeisei/kg-transit/releases/latest/download/module.json`
   (or download `kg-transit.zip` from the [latest release](https://github.com/KonteiKeisei/kg-transit/releases/latest) and extract it into `Data/modules`).
2. Install and enable **Calendaria** as well. KG Transit will not run without it.
3. Enable **KG Transit** in your world's module settings.
4. In **Configure Settings > KG Transit**, pick a ride sound for each car (optional, see [Module settings](#module-settings)).
5. Optional, for real city scenes, automatic metros and flights: install **[KG Cities](https://github.com/KonteiKeisei/kg-cities)** the same way, from its manifest URL:
   `https://github.com/KonteiKeisei/kg-cities/releases/latest/download/module.json`

## Real cities (KG Cities)

**[KG Cities](https://github.com/KonteiKeisei/kg-cities)** makes scenes of real US cities from OpenStreetMap, set in the 1980s or today. KG Transit recognises those scenes and gives each one the city's own rail network: the real lines in their real colours, every station in its real place on the map, transfers where the lines meet, tunnels, elevated track and bridges where they really are, and the fare of the time.

- **It happens by itself.** The first time the GM views a city scene that has no network yet, the network is set up and turned on, and a message says so. (Turn this off with **Set up city networks** in the module settings; the **Transit network** button then sets it up when you first open the editor.)
- **The era decides the network.** A 1980s scene gets the network as it ran in its year (1986 unless KG Cities says otherwise): lines and stations not yet opened are left out, and lines and stations that had other names then get them. A modern scene gets today's network.
- **No scale to set.** City scenes are drawn at real scale, so travel times are right from the start.
- **Everything stays editable.** Rename, recolour, re-theme, add or remove stops as with any network. The editor shows which city and year the network came from; **Reset to city network** puts the original back (keeping your party token).
- **Sound and car art.** City networks use the shipped subway ride sound. In the network settings, each car type can have this network's own **Sound** and **Interior** image, for city-specific cars: drop in your own art (1672 x 941, transparent windows) and every ride on that city's network uses it.

| City | Modern | 1980s (1986) |
|---|---|---|
| Boston | MBTA: Red (Ashmont and Braintree), Orange, Blue, Green B, C, D, E, Mattapan | The exact 1986 MBTA, hand-built: the Washington Street Elevated (Orange Line to Forest Hills via Dudley), Green E to Heath Street, 75 cents |
| New York | NYC Subway (every service, branches split), Staten Island Railway, PATH | The stations open in 1986 (no 63rd Street or Archer Avenue lines, no Second Avenue Subway, no Hudson Yards), no W or Z, $1 |
| Washington | Metrorail: Red, Orange, Blue, Yellow, Green, Silver | Red, Orange, Blue and Yellow as far as they had been built; National Airport under its old name |
| Philadelphia | Market–Frankford, Broad Street and Broad–Ridge Spur, Norristown High Speed Line, PATCO | The same lines, period names |
| Baltimore | Metro SubwayLink, Light RailLink | The Metro as built by 1986 (Charles Center to Reisterstown Plaza) |
| Atlanta | MARTA: Red, Gold, Blue, Green | The North–South and East–West lines as far as they ran in 1986 |
| Chicago | CTA 'L': Red, Blue, Brown, Green, Orange, Pink, Purple, Yellow | The routes of the time under their 1986 names; no Orange or Pink line yet |
| San Francisco | BART (all lines), Muni Metro | BART's four routes of the time, Muni Metro J, K, L, M, N |
| Miami | Metrorail (Green, Orange), Metromover loops | Metrorail and the original downtown Metromover loop |
| St. Louis, Detroit, Los Angeles, Las Vegas, Austin | MetroLink; People Mover and QLine; Metro Rail; the Monorail; CapMetro Rail | No rail transit yet in 1986: the editor says when the first line opened. Detroit's People Mover appears from 1987 on. |

**How good is it?** Stations, their positions and the routes come from OpenStreetMap; opening years from Wikidata. Boston 1986 is exact. For the other cities the 1980s network is the modern one with later lines and stations taken out, so service patterns that have changed since (Chicago's routes were rearranged in 1993, for example) follow today's routes. Stations that closed before today are not included, except in Boston. Open the editor to adjust anything for your table.

## 1. Set the scene's scale first

Travel times come from the distance between stops on the map, so the scene needs to know how big its squares are. **Do this before placing stops.**

1. Open the scene's settings (right-click the scene in the navigation bar, **Configure**, then the **Grid** tab).
2. Set **Grid Units** to `mi` (miles). New scenes use `ft`, which makes every trip take a minute.
3. Set **Grid Scale** to how many miles one grid square covers. A city map might be 0.1 mi per square; a regional map 1 mi or more.
4. Save.

Until the grid is in miles, the network editor shows a warning with a **Scene settings** button, and placing a stop reminds you.

## 2. Open the network editor

As GM, select the **Journal Notes** controls on the left of the canvas and click **Transit network** (the train icon). This one control does everything:

- the first time on a scene it turns transit on and opens the editor with a **starter network**: four sample lines, every kind of train, transfers between them, and all stops waiting to be placed;
- after that it opens the editor for that scene.

Each scene has its own network. To hide a network, open the network settings (the summary line near the top) and use **Turn off on this scene**; its lines are kept for when you turn it back on.

Every change in the editor saves straight away.

## 3. Lines

Lines are listed down the left of the editor, each with its type and how many of its stops are placed. Click one to edit it, or **New line** to add one.

Across the top of the selected line:

| Field | What it does |
|---|---|
| **Name** | The line's name, shown on the map, in the ride and in chat (for example "Central Line"). |
| **Colour** (round swatch) | Click to pick any colour for the line. |
| **Type** | The train: **Metro**, **Light rail**, **Tram**, **Express** (all ride in the subway car) or **Steam** (rides in the steam coach, with engine smoke past the windows). The type also sets the speed and how long trains wait at stops. |
| **Theme** | The look of everything on this line. **Inherit** uses the scene's theme (see [Themes](#7-themes)). |
| **Delete** (bin) | Deletes the line. Stops that were only on this line go with it. |

The sample lines are there to be changed: rename them, recolour them, delete what you don't need.

## 4. Stops and placing them

The selected line's route runs down the editor like a line diagram: a track in the line's colour with a circle for each stop, solid once the stop is on the map, faded while it isn't. Each stop has:

- a **grip** (dotted handle): drag it up or down to change the stop's place in the line;
- its **name**: click and type to rename;
- **Place** (blue crosshair): the editor tucks away; click the map where the stop is. Right-click or Esc cancels. Once placed it shows a green pin; click it again to move the stop;
- **Stop options** (sliders icon): transfers to other lines, the stop's theme and its platform (see below);
- **Remove** (x): takes the stop off this line (and deletes it if no other line uses it).

**Add stop** adds a stop to the end of the line, ready to name.

The footer shows how many stops are on the map. **Place next** places every unplaced stop in turn: click the map once per stop, in line order, and press Esc or right-click to stop. While the editor is open you can also **drag station icons** on the map to fine-tune them.

A stop that is not placed can still be ridden to; its timing uses a default, and the party's token waits until the train reaches a placed stop.

## 5. Transfer stations

A transfer station is a stop on more than one line. Riders change trains there automatically.

1. Click the stop's **Stop options** button (sliders icon). A row of toggles opens, one per other line, in each line's colour.
2. Click each line the stop should also be on (click again to take it off). It is added to the end of that line; open that line and drag it into place.

On the map, a transfer station's icon is split between its lines' colours. In the editor, small labels beside a stop's name show which other lines it is on. Change time is set by **Transfer** in the network settings (4 minutes by default).

## 6. Scenery between stops

On the track between each pair of stops is the scenery the riders see on that stretch, and its travel time:

**Underground:** Tunnel (theme), Tunnel: brick, Tunnel: rock cave, Tunnel: cyber. **Tunnel (theme)** is the theme's own tunnel: concrete (Modern), brick (Industrial), rock (Fantasy), cyber (Future). The others always look the same, lit by the theme's lamps.

**Urban:** City, Downtown towers, Old town, Fantasy city, Elevated over the city, Industrial, Dockside.

**Open:** Suburbs, Countryside, Forest, Mountains, Coast, Bridge over water.

Outdoors, each stretch has its own buildings or landscape beside the track and a skyline or horizon behind it, drawn in the stretch's theme: City in Industrial is brick tenements, gas lamps and smokestacks; in Future it is neon towers and holo signs.

The **minutes** box is optional. Leave it empty and the time is worked out from the length of the track on the map (the grey number shows that estimate). Type a number to set it yourself.

**Curved track (travel nodes).** Each stretch between two stops runs straight unless you give it travel nodes. While the editor is open, every line is drawn on the map, the selected line on top with its nodes as small white dots:

- **Double-click the line's track** to add a node there.
- **Drag a node** to bend the track through that spot. The curve flows smoothly through the stops and nodes.
- **Double-click (or right-click) a node** to take it out.
- A stretch with nodes shows a curve label with its count in the editor, and a **Straighten** button (ruler icon) that takes them all out.

The tokens ride along the curves, and travel times count the track's real length. Nodes belong to the stretch between their two stops: reorder or remove a stop and that stretch goes back to straight.

On a KG Cities scene, the lines follow the city's real track as KG Cities draws it. The stretches are traced along it as travel nodes when the network is set up, and once, automatically, for city networks set up before 4.8. **Follow the tracks** in the editor's city bar traces them again, replacing any nodes you moved. Traced nodes are ordinary travel nodes, so you can still drag them about.

## 7. Themes

A theme sets the era and look of everything the riders see, and the style of the station icons and the ride window:

| Theme | Look |
|---|---|
| **Modern** | Concrete and tile, sodium street lamps, billboards, glass towers. Rounded-square station icons. |
| **Industrial** | 1880s to 1920s, a WW1-era feel: brick tenements and mills, smokestacks and gasometers, gas lamps, telegraph poles, painted wall adverts, riveted iron, Victorian tiled stations. Brass and enamel round icons, a sepia ride window. |
| **Fantasy** | Industrial fantasy: rail still runs, but through timber and stone towns, forges, windmills, castles and sailing ships, lit by lanterns, with stone-vaulted stations. Shield icons, a parchment ride window. |
| **Future** | Neon skylines, holo signs, capsule towers, wind turbines and solar fields, glowing cyber tunnels and neon stations. Hexagon icons, a neon ride window. |

A theme can be set at four levels. The most specific one wins:

1. **World**: **Configure Settings > KG Transit > Default theme**. Every scene uses it unless told otherwise.
2. **Scene**: the **Theme** buttons near the top of the network editor. **World default** follows the world setting.
3. **Line**: the **Theme** list beside the line's type. **Inherit** follows the scene.
4. **Stop**: in the stop's options (sliders icon). It covers the stop's platform and the track either side of it, so you can have, say, one Fantasy old-town stop on a Modern line. Between two stops with their own themes, the stop the train is heading for wins.

Lines and stops with their own theme show its icon in the editor, and stops show it as a label beside their name. At a transfer station, the platform looks like the line being boarded. The sample network's Valley Railway is set to Industrial to show a line theme at work.

## 8. Platforms: underground or above ground

Each stop has a platform setting in its options (sliders icon):

- **Auto** (the default): underground when a tunnel reaches the stop, above ground otherwise. The editor shows which one auto picks.
- **Underground**: the train pulls into a station under the street, its name on the wall: tiled (Modern), Victorian brick (Industrial), stone vault (Fantasy) or neon (Future).
- **Above ground**: an open-air platform with a canopy, benches, lamps and the station's name board, and the skyline of that stretch beyond it, with the weather falling outside. Each theme has its own: steel and glass, cast iron and timber with gas lamps, carved timber with lanterns, or glass and light strips.

A stop set to anything but Auto shows it as a label in the editor.

## 9. Network settings

The network's settings are summed up in one line near the top of the editor (name, badge, fare, transfers, theme, party token). Click it to open them:

| Field | What it does |
|---|---|
| **Name** | The network's name; also who "speaks" the ride messages in chat. |
| **Badge** | One or two letters shown on every station icon (for example M, U, R). |
| **Fare** | Amount and coin (cp, sp, ep, gp, pp) per rider per trip, whatever the distance. 0 means free. |
| **Transfer** | Minutes to change trains at a transfer station. |

| **Sound / Interior** (one row per car type) | Optional. This network's own ride sound and car interior image for that car, overriding the module settings. City networks come with the subway sound filled in. Use the file buttons to browse. |
| **Party token** | Optional. Choose a token on this scene (a dnd5e party/group token, or any token). When set, that token rides the line on the map whenever the party boards, wherever it is standing, and its members are ticked as riders. Leave it as **None** and the module uses whatever party or character tokens are standing at the boarding station. |

## 10. Riding

1. **Hover** a station icon to see its name and lines.
2. As GM, **double-click** a station to open **Board**.
3. **Riders** are ticked for you: the party token's members (if set), or the party and characters standing at the station. Untick anyone staying behind. **Waive** lets someone ride free.
4. Pick the **destination** from the list (grouped by line), or click its icon on the map. You'll see the route, any changes, the trip length and the arrival time.
5. If there is a fare, choose who pays: **each rider** or the **party's funds** (the group actor's coins). Change is given in the fewest coins.
6. Choose who sees the ride: **Riders only** (other players get a small banner) or **Everyone**.
7. Click **Board**. A chat card records the trip and fares, and the game unpauses.

## 11. During a ride

- **Time runs in real time**: one game second per real second. Pausing the game pauses the train, the clock and the token. If you move time forward yourself, the train jumps ahead to match.
- **The ride window** opens beside the sidebar for everyone who sees the ride, with the car interior, the scenery outside, the line, the clock and the arrival time. The expand button makes it full screen. Its look follows the theme of where the train is: brass and serif type for Industrial, parchment for Fantasy, neon for Future, with a matching colour wash over the car.
- **On the map**, the ride's tokens travel the line single file, the party token in front, along the track (curved where it has travel nodes), easing in and out of stations. While the train moves, the tokens' art bobs gently on every screen. Players' views follow the party token at a closer zoom and pull back out when the trip ends; the GM's view does the same while one of the ride's tokens is selected.
- **GM buttons** in the ride window (players only get the full screen button):
  - **Skip to next stop**: the train travels on to the next stop over 5 seconds, then the ride carries on in real time.
  - **Get off next stop**: if the train is standing at a stop, everyone gets off there. Otherwise it travels on to the next stop over 5 seconds and they get off there.
  - **Arrive**: the rest of the trip passes over 15 seconds.
  - **Emergency stop** (red): the train stops where it is and everyone gets off there, ending the ride with no more time passing.
- **Getting off**, the tokens gather just below the stop (or where the emergency stop left them) in as tight a circle as they make: the party token in the middle, the rest in evenly spaced rings around it. A chat card records it.
- If Calendaria's real-time clock was running, it is paused for the ride and restarted afterwards.

## 12. Air travel between cities

On a **[KG Cities](https://github.com/KonteiKeisei/kg-cities)** scene, the city's airports of 1986 are drawn on the map in violet: the terminals as buildings, the airfield's edge dashed. Hover one for its card. The cities and their airports: Boston (Logan), New York (JFK, LaGuardia, Newark), Washington (National, Dulles), Baltimore (BWI, which serves Washington too), Philadelphia, Atlanta (Hartsfield), Chicago (O'Hare, Midway), Detroit (Metro, City), St. Louis (Lambert), Miami (Miami, Fort Lauderdale), Austin (Robert Mueller), Las Vegas (McCarran), Los Angeles (LAX, Burbank, Long Beach), San Francisco (SFO, Oakland, San Jose).

**Booking.** As GM, **double-click an airport** to book a flight from it.

1. **Who's flying:** tick the travellers, or **Whole party** for every member of the party at once. **Waive** lets someone fly free.
2. **Destination:** choose a destination city (every other city with an airport), then one of its airports (a city with one airport has it chosen for you). **Checking bags** adds the ticket counter and the baggage carousel.
3. The flight appears: the airline and aircraft of the day for that route (Eastern, Delta, TWA, Pan Am, United, American, Northwest and others; the 747, DC-10, L-1011, A300 and 767), the distance, and every step curb to curb with its time: through the airport (a metal detector and a walk to the gate in 1986, quicker at small airports), boarding, taxi and takeoff, the flight (the jet stream speeds eastbound flights), taxi in, off the plane, baggage claim.
4. **Fare:** the average coach fare of the period for that distance, the government's fare level of 1986 (it changed every six months), converted to coins by the **Plane tickets** setting. Pay from each traveller or the party's funds.
5. **Encounter on the way** (optional): pick one of your scenes and when it happens: in the departing airport, on the plane before takeoff, during the flight, on the plane after landing, or in the arriving airport.
6. **Fly.**

**The flight runs in real time**, like a ride: one game second per real second, from the curb at one end to the curb at the other, so the table can talk and play the trip out. The game unpauses for it, and pausing stops the clock. The trip is seven scenes, each one filling the free part of the canvas (under the scene navigation, beside the scene controls and the sidebar, above the chat's bottom line and any camera dock), with Foundry's interface on top as usual:

1. **The departure terminal** (curb to gate): that airport's own 1980s terminal, still, with the tarmac out of the windows by day or at dusk and the weather falling past the glass (rain with drops running down it, snow, fog, lightning). The terminal's ambiance plays.
2. **The jet bridge** (boarding), the terminal's ambiance quieter.
3. **The cabin, taxiing out**: the cabin full screen, a generic airport out of its windows in perspective. The taxiway's edge, its blue lights and signs come from the front and slide back past the window; across the grass are the runway, hangars, the terminal with planes at its gates, a control tower and the city on the horizon. The plane bumps over the taxiway's joints, the engines idling. The last 20 seconds are the takeoff: full power, the runway rushing by faster and faster with a rising rattle, the nose coming up, then the ground falling away below the windows until there is only sky. After dark the airport is lit and the cabin lights are turned down.
4. **The flight** (in the air): the plane from the side in its airline's tail colour (or its own livery, from your **Plane liveries folder**), buffeted by the weather, with the jets roaring. The sky follows the hour, and after dark the plane flies with its lights on: lit windows, navigation lights, flashing beacons and strobes, the logo light on the fin. The cabin shows in its own window, like the subway ride window: in the corner beside the sidebar and above the chat's bottom line, resizable, with an expand button anyone can use to fill the screen and shrink it back.
5. **The cabin, taxiing in**: the landing rollout slowing on the runway, then taxiing to the gate and rolling to a stop.
6. **The jet bridge** (off the plane).
7. **The arrival terminal** (baggage claim and leaving the airport).

Each change of scene is a fade to black and back up on the next one (only once its art has loaded); steps within a scene change nothing on screen. The status line shows each step and the time it has left ("Boarding · 14 min left"), and the clock and the arrival time stay top right. The map under the flight is out of reach until it ends: no clicks, zooming or hover cards through it.

**The GM's controls** at the top of the flight screen:

- **Speed** ×1, ×2, ×5, ×10, ×30, ×60: the clock (and with it the weather) runs faster, eased in. The plane and the clouds never speed up.
- **Skip to** the next step: Skip to boarding, to taxi, to takeoff, to landing, to the gate, to baggage claim, to arrival (the button always names the step after this one). The clock simply moves there (no time-skip cinematic), the screen changes scene if the step is in another one, and the trip carries on in real time. When an encounter comes before the next step, the button is **Skip to encounter** and stops there, so a skip never passes it.

Behind the flight, from takeoff, the destination city's scene is found (one of that city and era whose map covers the airport) or generated. Halfway through the flight the weather changes to the destination's: Calendaria rolls new weather for the destination scene's climate zone, and from then on the sky, the clouds and the arrival terminal show it (before that, it is the departure city's). At the end the travellers' tokens move to the arrival terminal, the scene opens for everyone with that weather, and every view centres on the party.

**Encounters.** With an encounter, the trip stops at its point: the party's tokens move to your scene and it opens for everyone. When the encounter is done, the GM clicks **Continue flight** at the top of the screen, and the trip carries on from where it stopped.

## Module settings

**Configure Settings > KG Transit:**

| Setting | Scope | What it does |
|---|---|---|
| Set up city networks | World | On a KG Cities scene, set up the city's real network the first time the scene is viewed. |
| Default theme | World | The theme every scene uses unless the scene, a line or a stop picks its own. See [Themes](#7-themes). |
| Subway car: ride sound | World | Sound file looped during rides in the subway car. Empty means silent. |
| Steam coach: ride sound | World | The same for the steam coach. |
| Subway car / Steam coach: interior image | World | Optional replacement interior art. It must be 1672 x 941 px with **transparent windows**, looking down the car at its end door. Empty uses the built-in art. |
| Plane liveries folder | World | Optional. A folder of your own airline liveries named `<airline>-<plane>.webp` or `.png` (for example `united-dc10.webp`). A flight uses its airline's livery when there is one, otherwise the white plane with its tail in the airline's colour. |
| Plane tickets: copper per dollar | World | What a dollar of airfare costs, in copper. 1000 (the default) makes a dollar one platinum piece, as the city fares count it. |
| Ride sound volume | Each player | Volume of the ride sound (and the jet's engines in flight). |
| Terminal ambiance volume | Each player | The airport terminal heard while a flight is on the ground. 50% by default. |
| Station icon size | Each player | Size of the station icons on the map, in screen pixels. |

The ride sound fades in when the ride starts, switches if the riders change between a subway and a steam line, dips at stops, and fades out on arrival.

## How travel time is worked out

For each stretch without a minutes value:

```
time = straight-line map distance (in the scene's grid units, converted to km) / train speed
```

Speeds and stops: Metro 36 km/h and 30 s, Light rail 28 km/h and 25 s, Tram 16 km/h and 20 s, Express 60 km/h and 40 s, Steam 40 km/h and 60 s. Each stretch takes at least 45 seconds. Changing trains adds the network's transfer time.

Grid units understood: mi, km, m, yd, ft (and their full names). Anything else is treated as feet.

## Weather, time of day and seasons

- **Weather** comes from Calendaria's current weather: clear, partly cloudy, cloudy, overcast and stormy skies; rain, sleet and snow at their strengths, streaming past the windows with drops running down the glass; fog; and lightning in thunderstorms. Underground, the weather fades out.
- **Time of day** from the game clock: day, dusk or night (lit windows, street lamps, gas lamps and lanterns in the older themes, neon in the Future theme, stars on clear nights).
- **Season** from the calendar month: autumn colours in October and November, bare trees and snowy roofs from December to March. Falling snow always brings the winter look.

## Troubleshooting

- **Every trip takes about a minute per stop.** The scene's grid is still in feet. See [step 1](#1-set-the-scenes-scale-first).
- **No Transit network button.** It is in the Journal Notes controls, for GMs only.
- **Station icons don't show.** They fade out when zoomed far out; zoom in. Stops that are not placed have no icon: open the editor and click **Place**.
- **"No line connects these stops."** The two stops are on lines with no transfer station between them. Add a transfer (step 5).
- **The token doesn't move.** It needs a party token (set in the editor, or standing at the boarding station), and the stops on the route must be placed on this scene.
- **A stop is underground but should be outside (or the other way round).** Its platform is on Auto, which follows the tunnels. Open the stop's options and set Platform.
- **A city scene has no network.** Check **Set up city networks** is on, or open the editor with the **Transit network** button. The editor says if the city had no rail line in the scene's year. If the scene had a network before (the sample one, say), use **Use city network** in the editor.
- **No sound.** Pick a ride sound for the car in the module settings, and check the Environment volume in Foundry's audio settings.

## For developers

- Run the tests with `npm test` (Node 20 or later).
- Preview the ride and the station icons outside Foundry: `python tools/preview-server.py 8766`, then open `http://localhost:8766/modules/kg-transit/tools/preview.html?from=a&to=l` or `tools/icons-preview.html`. Add `&theme=industrial` (or fantasy, future) to see a theme. `tools/themes-preview.html` shows every theme's scenery, tunnels and platforms side by side, and `tools/editor-preview.html` the network editor. Stop ids are in `scripts/demo-network.mjs`.
- `python tools/key-interior.py` rebuilds the keyed interiors from `assets/*-interior-source.png` (green-screen windows).
- City networks are built from OpenStreetMap and Wikidata by `python tools/cities/build.py` (all cities, or name some: `python tools/cities/build.py boston chicago`). Downloads are cached in `tools/cities/cache/`; `--refresh` fetches them again. `tools/icons-preview.html?city=new-york` draws a city's network over its metro area, and `tools/editor-preview.html?city=boston&era=1980s` opens the editor on it.
- Airports: `node tools/build-airports.mjs [IATA]` builds `data/airports.json` from `tools/airports/airports.json` (outlines and terminals from OpenStreetMap, cached in `.cache/`). `tools/flight-preview.html` plays a flight and the cabin preview outside Foundry, with a stand-in for Calendaria's cinematic. `python tools/flight-art.py tools/flight-src` cuts the plane side views and the cabin out of their source images. Airline liveries (art you have the right to use) go in `tools/flight-src/liveries/<airline>-<aircraft>.png` or `.jpg` (keys from `scripts/flights.mjs`, e.g. `united-dc10.jpg`); `python tools/flight-art.py tools/flight-src liveries --out <folder>` cuts just those into a folder of your own (point the **Plane liveries folder** setting at it), and a flight uses its airline's livery when there is one.
- To change the module with an AI assistant, start with [AGENTS.md](AGENTS.md).

## License and credits

KG Transit is free to use, share and change for noncommercial purposes, under the [PolyForm Noncommercial License 1.0.0](LICENSE): it may not be sold, in whole, in part or as a modified version. That covers the code, the art, the sounds and the writing. The rail network and airport data (`data/cities`, `data/airports.json`) is derived from OpenStreetMap, © OpenStreetMap contributors, under the [Open Database License](DATA-LICENSE.md); opening dates from Wikidata (CC0). Airline liveries are not shipped: yours go in the folder set in the module settings. Airline names and colours belong to their owners; KG Transit is not affiliated with any of them. See [CREDITS.md](CREDITS.md).
