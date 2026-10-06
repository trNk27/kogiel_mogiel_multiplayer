# Kogiel Mogiel · Couch Party

Jackbox-style party games for the sofa. A TV, laptop or the **Xbox Series S Edge browser** shows
the game, and 2–8 players join from their phones by scanning a QR code. Nobody installs an app or
makes an account, and it runs entirely on the **free Cloudflare plan**.

The look borrows from a Polish kitchen. Players are little pierogi in Beetroot, Egg Yolk, Pickle,
Dill, Blueberry, Plum and other colours. The screens use folk paper-cut (*wycinanki*) rosettes and
are named after the brand: a glass of kogiel mogiel.

| Game | What happens | Players |
| --- | --- | --- |
| **Trails** | Curve Fever–style. Hold LEFT/RIGHT to steer your line, and avoid walls and trails. Random gaps let you slip through. Every crash gives each survivor +1. First to 10 × (players − 1) wins. Power-ups can be switched on in the lobby: 11 pickups that change speed, line width and gaps (green ones affect you, red ones everyone else, blue ones everyone). | 2–8 |
| **Quiz** | 10 questions from a pool of 100. You have 20 s per question, and a right answer scores 1000 points, dropping to 500 as the timer runs out. No question repeats within a session. | 1–8 |
| **Ballpark** | Everyone guesses a number, then bets on the guess closest to the answer **without going over**. Edge slots pay more. 7 questions per game from a pool of 40. | 1–8 |
| **Pierogi Panic** | Co-op cooking, Overcooked-style. Walk your chef with a joystick on your phone and do everything else with one big button. Roll dough, fold pierogi, boil them, plate up and serve the orders before their tickets run out. Then wash the dirty plates. Rolling, folding, boiling, frying and washing are quick minigames on your phone. Three levels in three kitchens: Babcia's Kitchen (potato & cheese only), The Village Inn (+ sauerkraut and meat) and The Wedding Feast (+ blueberry and fried pierogi). Up to 3 stars per level. The VIP sets the difficulty (how fast orders arrive) and the starting level in the lobby. | 1–8 |
| **Maluch Rally** | Split-screen 3D racing in little Fiat 126p “Maluch” cars, with a low-poly PS2 look. Your phone is a pad: hold your thumb on it, and how high or low it is sets gas or brake while left/right steers. Three races of three laps, each on a different randomly generated track shape (forest ring, kidney, clover, figure eight with a bridge, town circuit, speedway), with a little Polish town along the way. Tracks have tunnels through hills and red steel bridges over a river. Drive through ? boxes for items and **lift your thumb for a moment to use them**: Kompot Boost, Butter Slick, Pickle Missile, Pot Lid shield, Thunderstorm, Maluch Rocket, Cabbage Bomb, Beet Splash, Babcia’s Ghost, Hay Bale and the Barszcz Sprayer. The VIP can switch items off. 15/12/10/8 cup points per race. **Also plays without a TV** (see below): then every phone shows its own car in 3D with a minimap, you steer by tilting or dragging, and up to 8 can race. | 1–4 (TV) · 1–8 (no TV) |
| **To Ty!** | Our take on PlayLink’s *That’s You!* (“to ty” is Polish for “that’s you”). Everyone takes a selfie on their phone, or skips and plays as their pierogi. Then come 7 “Who’s most likely to…?” questions: vote for a player, and you score 100 if you agree with the room (the last question pays double). After questions 3 and 6, everyone doodles on the photo of the player the room picked (“Turn Kasia into a pirate”), and the TV replays the doodles stroke by stroke. Vote for your favourite by letter; each vote is worth 100. | 3–8 |

## How a party works

1. On the TV, open the site and press **Host a party**. That's the only time anyone touches the TV.
2. Phones scan the QR code, or go to `/join` and type the 4-letter code. Then they enter a name and pick a pierogi colour.
3. The **first player to join is the VIP**. The VIP picks the game, toggles options, starts rounds,
   ends a game early (⋯ menu) and can remove players, all from their phone.
4. After each game the TV shows a podium and the **party standings** (3/2/1 points for the top three
   places; in the co-op Pierogi Panic everyone gets 1 point per star, averaged over the levels played). The VIP chooses **Play again** or another game.

### No TV? Play on phones only

On the join page, enter your name and tap **Play without a TV**. Your phone starts the party: it
runs the host in the background (the same code the TV would run) and joins as the first player, so
you're the VIP. Your lobby shows the room code (tap it for a QR code), and friends join at `/join`
as usual. Only games that don't need a shared screen are offered. So far that's **Maluch Rally**,
where every phone renders the race itself:

- **Your phone is the screen.** A full-screen 3D chase view of your own car, with your position,
  lap, speed and a **minimap** (with the river, bridges and tunnel) in the corner.
- **Steering made for a phone you're looking at.** The car speeds up by itself. Choose during the
  countdown: **tilt** (hold the phone like a steering wheel and turn it; works in portrait and
  landscape) or **drag** (put a thumb anywhere on the steering pad and slide it sideways; a wheel
  under your thumb shows how far you're turning). BRAKE slows you down or reverses, and the item
  button fires your item. The speed sits on the right, out of the way of the road.
- **Full screen**: the ⛶ button (top right, or in the countdown) hides the browser bars. iPhones
  don't allow that for web pages, so there the countdown suggests Share → Add to Home Screen.
- Keep the host phone's page open: if it locks or loses signal, the game pauses for everyone until
  it's back (it resumes the room after a reload, like the TV does).

Phones can lock, refresh or drop off Wi-Fi. The player's id lives in `localStorage`, and the TV
keeps their slot and score for **60 seconds**, so reopening the page puts them straight back where
they were. If the TV reloads, it resumes the same room. During games, phones keep the screen awake
(Wake Lock API) and vibrate on events where the phone supports it.

## Architecture

```
 phone ──┐                               ┌── phone
 phone ──┼── WebSocket ── RoomDO (relay) ─┼── phone
         │                 one Durable    │
         └──────────────── Object / room ─┴── TV  (host: runs all game logic)
```

- **Host-authoritative.** All game logic runs in the TV's browser (`client/src/host`, `client/src/games`).
  The Durable Object (`worker/room.ts`) is a thin relay. It tells the host when phones connect or
  disconnect, forwards phone messages tagged with the sender's id, and delivers host messages to
  one, several or all phones.
- **WebSocket Hibernation API** with a SQLite-backed Durable Object class (`new_sqlite_classes`),
  which the free plan requires. Routing data lives in socket tags and attachments, so the object
  can sleep between messages. Keep-alive `ping`s are answered by the runtime's auto-response and
  don't wake the object.
- **Low message volume.** Phones send input only when it changes (for example `steer {l, r}` on
  press or release). The host sends each phone a small "view" describing what to show, only when
  it changes (views are deduplicated per phone), and never game state every frame.
- **One shared typed protocol** in [`shared/protocol.ts`](shared/protocol.ts) is used by the host,
  the phones and the Worker.
- **No database.** The Durable Object stores only the room's code, the host key and a
  last-activity timestamp. An alarm deletes rooms after **30 minutes of inactivity**.
- **Frontend:** Preact + Vite with three pages: `/` (TV), `/join` (phone) and `/dev` (test bench).
  Trails renders on a Canvas 2D at a fixed 60 Hz timestep with an occupancy grid for collisions.
  Sound effects are synthesized with WebAudio, so there are no audio files, and there's a mute
  toggle on the TV and in the VIP's lobby options.
- The TV is a fixed **1920×1080 stage with a 5 % safe-area margin**, scaled to fit any screen.

```
shared/protocol.ts          typed messages, colours, constants
worker/index.ts             HTTP routes: POST /api/rooms, GET /api/rooms/:code, /ws/:code
worker/room.ts              RoomDO – the relay Durable Object
client/index.html           TV (host) entry   → client/src/host
client/join.html            phone entry       → client/src/phone
client/dev.html             /dev test bench   → client/src/dev
client/src/games/*          quiz, trails, ballpark, kitchen (pure logic + TV views)
client/src/phone/kitchen.tsx  Pierogi Panic joystick, action button and minigames
client/src/games/rally/*    Maluch Rally: track generator, car physics, three.js renderer, no-TV race client
client/src/phone/rally.tsx  Maluch Rally thumb pad (with a TV)
client/src/phone/rallyDrive.tsx  Maluch Rally on the phone (no TV): 3D view, tilt/drag steering, minimap
client/src/phone/notvHost.ts     a phone hosting a party without a TV
client/src/phone/toty.tsx   To Ty! selfie camera, voting and doodle canvas
data/trivia.json            100 quiz questions
data/ballpark.json          40 estimation questions
data/toty.json              62 "who's most likely to…" questions (26 with a doodle prompt)
test/*.test.ts              Vitest unit tests (scoring, Trails collisions, data checks)
```

## Local development

Requirements: Node.js 22+.

```bash
npm install
npm run dev          # builds the frontend (in watch mode) and runs `wrangler dev` on http://localhost:8787
```

- TV: <http://localhost:8787/>
- Phone: <http://localhost:8787/join>
- **Test bench:** <http://localhost:8787/dev?n=4> opens the host and 4 simulated phones in iframes.
  The phones join automatically. Click a phone and use ← → (or A / D) to steer in Trails.
- **No-TV test bench:** <http://localhost:8787/dev?notv&n=3>: the first phone starts a party
  without a TV and the others join it. In a race, ← → steer, ↓ brakes and Space fires the item.
  `/join?debug` exposes a phone's race as `window.rally` (`rally.autodrive = true` drives for you).

To try it with real phones on your Wi-Fi, run `npx wrangler dev --ip 0.0.0.0` and open
`http://<your-computer-ip>:8787` on the TV. The QR code uses whatever address the TV is on.

```bash
npm test             # unit tests
npm run typecheck    # TypeScript for client + worker
```

## Deploying from a phone (no computer needed)

Cloudflare can build and deploy straight from this GitHub repo, all from a phone browser:

1. Sign up at <https://dash.cloudflare.com/sign-up> (free, no card).
2. In the dashboard open **Workers & Pages → Create → Import a repository**, connect GitHub,
   and pick `kogiel_mogiel_multiplayer`.
3. Settings:
   - **Project / Worker name:** `couch-party` (must match `name` in `wrangler.jsonc`)
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
   - **Branch:** the branch holding this code
4. Deploy. You get a URL like `https://couch-party.<your-subdomain>.workers.dev`, and every
   push to that branch redeploys automatically.

### One link for everyone

Share that single URL:

- **Laptop, TV or tablet** → the host screen. Press **Host a party**.
- **Phone** → automatically sent to `/join` (the controller). Scan the QR code on the laptop,
  or type the 4-letter code. To host on a phone anyway, use `/?host`.

## Deploying from a computer (free plan, no credit card)

1. Create a free Cloudflare account at <https://dash.cloudflare.com/sign-up>.
2. Log in from the terminal and deploy:

   ```bash
   npx wrangler login
   npm run deploy     # = vite build && wrangler deploy
   ```

3. Wrangler prints your URL, e.g. `https://couch-party.<your-subdomain>.workers.dev`. On first
   deploy it may ask you to pick a `workers.dev` subdomain.
4. Open that URL on the TV (Xbox: Microsoft Edge), press **Host a party**, and scan the QR code
   with a phone.

The free plan covers this comfortably. The Durable Object uses the SQLite backend, which the free
tier requires. A phone's WebSocket messages count as 1/20 of a request each, and idle rooms
hibernate.

## Tuning

Trails' feel is set in `TUNING` in [`client/src/games/trails/sim.ts`](client/src/games/trails/sim.ts):

| Setting | Default | Meaning |
| --- | --- | --- |
| `speed` | 88 units/s | the arena is 800 × 480 units, so crossing it takes about 9 s |
| `turnRate` | 3.4 rad/s | a full circle takes about 1.9 s (turn radius ≈ 26 units) |
| `radius` | 2.5 units | half the line width |
| `gapMin`/`gapMax` | 0.9–1.9 s | time between gaps |
| `gapLength` | 15 units | wide enough for one line to slip through |
| `ghostTime` | 0.55 s | invulnerable, trail-less start after "GO" |

Trails power-ups live in `POWER_KINDS` / `POWER_SECONDS` / `POWER_TUNING` in the same file. Up to
6 are on the arena at once, and a new one appears every 2–4 s:

| Pickup | Ring | Effect | Time |
| --- | --- | --- | --- |
| Faster | green | you move 1.6× faster | 4 s |
| Slower | green | you move 0.6× slower, for tight steering | 5 s |
| Others faster | red | everyone else moves 1.6× faster | 4 s |
| Others slower | red | everyone else moves 0.6× slower | 4 s |
| Thin line | green | your line is half as wide | 6 s |
| Others fat | red | everyone else's line is 2.2× as wide | 5 s |
| Big gaps | green | your gaps are 2.4× longer and come every 0.35–0.75 s | 6 s |
| Others no gaps | red | everyone else leaves a solid line | 6 s |
| Jump | green | you leave no trail and hop over lines (walls still count) | 1.6 s |
| Through walls | green | you wrap around the edges | 6 s |
| Clear arena | blue | wipes every trail | – |

Speed effects multiply; thin/fat and big gaps/no gaps cancel each other. The TV announces each
pickup ("Kasia makes everyone else fat!"). `/?debug` on the TV exposes the running game as
`window.trails`, for testing.

Quiz and Ballpark timings are constants at the top of their `logic.ts` / game files.

### Pierogi Panic

The three levels live in `LEVELS` in
[`client/src/games/kitchen/logic.ts`](client/src/games/kitchen/logic.ts). Each level has a name, the
fillings that can be ordered, the share of fried orders, a round length and a 16 × 9 layout. Each
character of the layout is one tile:

| Tile | Meaning | Tile | Meaning |
| --- | --- | --- | --- |
| `.` | floor | `X` | wall |
| `#` | counter (storage) | `F` | flour sack |
| `1`–`4` | crate: potato, sauerkraut, meat, blueberry | `R` | rolling board |
| `P` | pierogi (folding) board | `S` | stove with a pot |
| `G` | frying pan | `W` | sink |
| `K` | plate rack | `H` | serving hatch |
| `D` | dirty-dish return | `T` | bin |

Edit a layout and the TV redraws the kitchen. Spawn points are picked automatically. The unit tests
check every layout: closed, connected floor, every station reachable, a crate for each filling the
level orders, and pans only where fried orders exist.

`KTUNING` in the same file holds the walking speed (4.2 tiles/s), the ticket time (80 s), how long
cooked pierogi wait before they turn to mush or burn (25 s), and the points (fried pierogi earn 30
extra). The lobby difficulty (`DIFFICULTIES` in `shared/protocol.ts`: Relaxed, Easy, Normal, Hard,
Chaos) scales how often orders arrive and how long tickets last. Star targets follow the number of
orders a team can expect, so they scale with team size and difficulty.

The item and station sprites in `client/public/sprites/kitchen/` were painted with FLUX.2 [pro]
(Black Forest Labs), cut out of their white backgrounds and saved as 192 px WebP (about 750 KB in
total). The chefs were painted the same way: one base chef, back and side views made with FLUX.2
image editing, then the dough recoloured into each player colour so every chef is the same
character. Floors, counter tops and walls are FLUX.2 textures too, with a different floor per
level. The scripts are in [`tools/sprites`](tools/sprites).

Phones send the joystick 20 times a second at most, quantised to 32 directions and two speeds, and
only when it changes. The button and the minigame results are single messages. The TV runs the
simulation at 60 Hz and sends each phone its button label ("Take flour", "Serve!") whenever it
changes.

### Maluch Rally

- **Tracks** (`client/src/games/rally/track.ts`): six shape families. Each one makes control
  points that are joined by a closed Catmull-Rom spline, scaled to a 1.0–1.35 km lap and resampled
  every 2 m:

  | Shape | How it's made |
  | --- | --- |
  | Forest Ring | random radii around a squashed circle |
  | Kidney Bend | a circle with a deep dent on one side |
  | Clover Hills | three or four lobes (`r = R(0.7 + 0.3 cos nθ)`) |
  | Figure Eight | a lemniscate that crosses itself once; one road goes over the other on an 8 m bridge |
  | Town Circuit | a rectangle, L, U or notched block outline with rounded 90° corners, lined with houses |
  | Speedway | a long stadium oval with an S-bend on one straight |

  A candidate is rejected if a corner is tighter than an 18 m radius, or if two parts of the track
  come within 36 m of each other (except at the figure eight's single crossing, which must be at
  50° or more). Every race in a cup uses a different shape.
- **Tunnels and bridges**: most tracks also get a **river**, a straight line across the map that
  the road crosses two (sometimes four) times at 55° or more, well away from the start. Each
  crossing gets a humpback deck with red bow-string arches, and the terrain is carved into a
  channel under it. Most tracks also get a **tunnel**: a 120–160 m stretch where nothing else comes
  close is buried under a grassy hill, with stone portals, ceiling lamps and darker lighting inside.
  The barriers close in smoothly (13 m → 9 m on bridges, 8.6 m in tunnels; `track.wall`). The race starts on the straightest
  stretch, away from the bridge. Physics only ever looks for the road near where the car was last
  frame, so a car on the bridge never jumps to the road below. Cars, butter and pickles only touch
  when they're on the same level.
- **Town** (`town3d.ts`): every track gets a stretch of town (the town circuit gets the whole
  lap). It has houses with gable roofs, a few PRL apartment blocks, a church with a spire, a SKLEP
  corner shop and street lamps. Everything is instanced and flat-shaded.
- **Items** (`sim.ts`, `ITUNING`): three rows of four ? boxes per lap, which come back 3 s after
  being taken. You hold one item at a time. Lifting your thumb off the pad sends `act`, which fires
  it (Space does the same on the dev bench). Leaders are more likely to get defence items, and the
  back of the field gets catch-up items: no Rocket or Thunderstorm for the leader.

  | Item | Effect |
  | --- | --- |
  | Kompot Boost | 2.2 s at up to 56 m/s |
  | Butter Slick | dropped behind you; whoever drives over it spins out for 1.1 s |
  | Pickle Missile | follows the road and homes in on the car directly ahead |
  | Pot Lid | a shield that blocks the next hit (10 s) |
  | Thunderstorm | everyone ahead of you is slowed to 55 % for 3 s |
  | Maluch Rocket | 3.5 s of autopilot at 62 m/s, immune to everything, shoving cars aside |
  | Cabbage Bomb | lobbed down the road; after 0.8 s it goes off and spins everyone within 8 m (you too) |
  | Beet Splash | barszcz on the windscreen of everyone ahead: their view is blotted for 4 s |
  | Babcia’s Ghost | 4.5 s see-through and untouchable (no bumps, no hits), and you steal the item of the nearest car ahead |
  | Hay Bale | dropped behind you; whoever drives into it stops dead |
  | Barszcz Sprayer | three red clouds of barszcz along the road behind you, for 12 s; driving through one covers your windscreen for 3.5 s (each cloud gets each car once) |
- **Physics** (`sim.ts`, `RTUNING`): top speed 42 m/s (≈150 km/h), 20 on the grass verge.
  Steering needs some speed and calms down near top speed. Barriers 13 m from the centre line slow
  you down and let you slide along them. Cars bump each other. Progress is measured along the track,
  so driving backwards over the line never counts as a lap.
- **Rendering** (`render3d.ts`): one three.js canvas with a viewport per player (1 full screen, 2
  stacked, 3–4 in a 2×2 grid; with 3 players the spare slot shows the map and standings). The game
  takes at most 4 players: with more people in the room, the VIP can’t start it. It renders at 45 %
  of 1080p and is scaled up with nearest-neighbour filtering. Flat-shaded low-poly meshes, 4–32 px
  textures, blob shadows and fog give it the PS2 feel.
- The phone sends the stick (−100…100 on both axes, in steps of 5) at most 20 times a second, only
  when it changes, and zero when the thumb lifts.
- `/?debug&shape=figure8` on the TV forces the first track shape and exposes the running game as
  `window.rally`, for testing.
- **Without a TV** (`client.ts`), each phone runs the car physics for its **own** car (so steering
  has no network lag) and reports its position ~15 times a second (`car`). The host phone referees
  with the same simulation, where every car is "remote" and is moved by those reports (dead-reckoned
  for up to 0.25 s). It counts laps, hands out items, moves missiles and cabbages, and decides
  who's hit. It sends each phone what happened to its car (`rfx`), and everyone a snapshot of all
  cars and items ~15 times a second (`rs`, about 300 bytes for 4 cars). Phones draw the other cars
  120 ms in the past, interpolated between snapshots. Every phone builds the same track from the
  seed in its view. A 3-race cup with 4 phones is about 1,500 billed Durable Object requests, well
  within the free plan.

### To Ty!

Selfies are taken in the phone browser (camera via `getUserMedia`, or a photo upload where the
camera isn't available, e.g. on plain `http://` LAN addresses). The phone crops each one to a
320 × 320 JPEG of at most ~56 KB and sends it over the WebSocket. The TV keeps the photos in memory
only, so "Play again" can reuse them, and relays them to the phones once. Views carry just a photo
version number, and a phone that reloads asks for the photos it's missing. Nothing is stored on
Cloudflare: the Durable Object only passes the messages through. Doodles are sent as compact vector
strokes (at most 2,500 points), which the TV draws as SVG.

The relay allows phone messages up to 64 KB (other messages stay tiny) and host messages up to
96 KB. Photos add a few dozen WebSocket messages per game, well within the free plan.

## Adding questions

- `data/trivia.json`: `{ id, category, difficulty, question, options[4], answerIndex }`.
  Options are shuffled when shown.
- `data/toty.json`: `{ id, question, draw? }`. `draw` is the doodle prompt for the player the room
  picked, with `{name}` standing in for their name. Questions 3 and 6 of each game always have one.
- `data/ballpark.json`: `{ id, question, answer, unit }`. Use `"unit": "year"` for years, so they
  display without thousands separators and with no decimal key.

Keep questions timeless (no "current" anything). `npm test` checks the files' shape.
