# Kogiel Mogiel · Couch Party

Jackbox-style party games for the sofa. A TV, laptop or the **Xbox Series S Edge browser** shows
the game, and 2–8 players join from their phones by scanning a QR code. Nobody installs an app or
makes an account, and it runs entirely on the **free Cloudflare plan**.

The look borrows from a Polish kitchen. Players are little pierogi in Beetroot, Egg Yolk, Pickle,
Dill, Blueberry, Plum and other colours. The screens use folk paper-cut (*wycinanki*) rosettes and
are named after the brand: a glass of kogiel mogiel.

**Design language** (`client/src/styles/base.css`): cut paper on a kitchen table. Cream *paper*
cards with ink text carry what matters, flat dark *slate* panels the rest. Shadows are hard and
never blurred, buttons are chunky keys with an edge underneath, empty slots are dashed cut lines.
Headings, numbers and buttons use Fraunces (soft, heavy); the odd sentence uses Nunito. Yolk means
"do this", beet "careful", dill "good". Text is kept short: icons, colours and three-line
how-tos do the explaining. Phone buttons are at least 48 px, and safe areas (the iPhone home bar,
the notch) are added around controls, never taken out of them.

| Game | What happens | Players |
| --- | --- | --- |
| **Trails** | Curve Fever–style. Hold LEFT/RIGHT to steer your line, and avoid walls and trails. Random gaps let you slip through. Every crash gives each survivor +1. First to 10 × (players − 1) wins. Power-ups can be switched on in the lobby: 11 pickups that change speed, line width and gaps (green ones affect you, red ones everyone else, blue ones everyone). | 2–8 |
| **Quiz** | 10 questions from a pool of 200. You have 20 s per question, and a right answer scores 1000 points, dropping to 500 as the timer runs out. No question repeats within a session. | 1–8 |
| **Ballpark** | Everyone guesses a number, then bets on the guess closest to the answer **without going over**. Edge slots pay more. 7 questions per game from a pool of 140. | 1–8 |
| **Pierogi Panic** | Co-op cooking, Overcooked-style. Walk your chef with a joystick on your phone and do everything else with one big button. Roll dough, fold pierogi, boil them, plate up and serve the orders before their tickets run out. Then wash the dirty plates. Rolling, folding, boiling, frying and washing are quick minigames on your phone. Three levels in three kitchens: Babcia's Kitchen (potato & cheese only), The Village Inn (+ sauerkraut and meat) and The Wedding Feast (+ blueberry and fried pierogi). Up to 3 stars per level. The VIP sets the difficulty (how fast orders arrive) and the starting level in the lobby. | 1–8 |
| **Maluch Rally** | Split-screen 3D racing in little Fiat 126p “Maluch” cars, with a low-poly PS2 look. Your phone is a pad: hold your thumb on it, and how high or low it is sets gas or brake while left/right steers. Three races of three laps on randomly generated tracks. The VIP picks a mixed cup (different tracks, mostly hard ones; a tournament's single race is always on a hard track), a **hard cup** (hairpins, S-bends, narrow barriers) or all three races on one kind of track. **Brake while turning** (pull your thumb down) to drift round tight corners, and let go when the sparks show for a mini-turbo. Tracks have tunnels through hills and red steel bridges over a river. Drive through ? boxes for items and **lift your thumb for a moment** (or, without a TV, tap the item button) to use them: Kompot Boost, Butter Slick, Pickle Missile, Pot Lid shield, Thunderstorm, Maluch Rocket, Cabbage Bomb, Beet Splash, Babcia’s Ghost, Hay Bale and the Barszcz Sprayer. The VIP can switch items off. 15/12/10/8 cup points per race. **Also plays without a TV** (see below): then every phone shows its own car in 3D with a minimap, you steer by tilting or swiping, and up to 8 can race. | 1–4 (TV) · 1–8 (no TV) |
| **To Ty!** | Our take on PlayLink’s *That’s You!* (“to ty” is Polish for “that’s you”). Everyone takes a selfie on their phone, or skips and plays as their pierogi. Then come 7 “Who’s most likely to…?” questions: vote for a player, and you score 100 if you agree with the room (the last question pays double). After questions 3 and 6, everyone doodles on the photo of the player the room picked (“Turn Kasia into a pirate”), and the TV replays the doodles stroke by stroke. Vote for your favourite by letter; each vote is worth 100. | 3–8 |
| **Bazgroły** | Our take on Jackbox’s *Drawful* (“bazgroły” is Polish for scribbles). Everyone gets a weird secret prompt (“A cat filing its taxes”, “Babcia on a motorbike”) and draws it on their phone. Then each drawing goes up on the TV, and everyone else makes up a fake title for it (or taps **Lie for me**). Pick the real title from the lies: finding it scores 1000 for you and 1000 for the artist, and every player who falls for your lie earns you 500. Two rounds with up to 4 players (the second pays double), one round with more. 200 prompts. | 3–8 |
| **Tour de Pierogi** | A button-mashing bike race. Your phone shows two pedals: tap LEFT, RIGHT, LEFT, RIGHT… as fast as you can. Only alternating taps count, so mashing one side gets you nowhere. 100 strokes to the finish line, three heats, 10/8/6/5/4/3/2/1 points per heat. | 1–8 |
| **Fork Fight** | A quick-draw duel. A plate on your phone: when a pierogi lands on it, tap to stab it. Socks, slippers and rubber ducks land too; stab one (or stab an empty plate) and you lose a point. The fastest three forks get 3/2/1. Eight rounds, with more fakes as you go. | 1–8 |
| **Pierogi Parade** | Pierogi of five colours march down a busy market street on the TV. Tap your phone once for every pierogi of the colour you're told to count (with a −1 button for slips). Lamp posts, trees, market stalls, barrels and trams hide them for a moment, some march in tight groups, and balloons, pierogi kites, pigeons, fireworks and the neighbours in the windows try to distract you. Exactly right is 10 points, 1 off 6, 2 off 3, 3 off 1. Three rounds, each longer, faster and busier. | 1–8 |
| **Podmianka** | “The swap”: eight things from a Polish kitchen stand on two shelves. Remember them, then a red curtain closes, and when it opens one of them has been swapped for something new. Tap the new one on your phone; right answers score 1000, dropping to 500 as the 15 s run out. Eight rounds: the look time shrinks from 9 to 5 s, from round 4 the shelves get rearranged too, and from round 5 the swap is a lookalike (jam for pickles, radishes for cabbage). 56 painted objects. | 1–8 |
| **Czołgi** | Our take on Shell Shocked: little tanks in a farmyard: a shell that bounces once, a cabbage mortar that flies over walls, three armour. Last tank rolling wins. | 2–8 |
| **Grzybki** | Our take on Mushroom Mixup. Babcia calls a colour; run to the giant mushroom of that colour before the timer runs out, then everything else sinks into the pond. Shove rivals off, ride the spinning ring, and watch for colour swaps. Last one dry wins the round. | 2–8 |
| **Pushy Pierogi** | Our take on Pushy Penguins: sumo on a frozen pond: glide, Shove and Brace to knock everyone into the water while the ice cracks and curling stones slide through. | 2–8 |
| **Strzelnica** | Our take on Boo-ting Gallery: a fairground shooting gallery: steer a crosshair with the joystick, Fire corks and Reload. Ghosts 1, bats 2, golden ghost 5 – but shoot a babcia cut-out and you lose 3. | 1–8 |
| **Babcia’s Cookbook** | Our take on Booksquirm: a giant page slams down on the book: stand in one of the holes cut in it to survive, and shove rivals out of it. Holes get smaller and pages faster. | 1–8 |
| **Kafelki** | Inspired by Tiles and Tribulations: paint the kitchen floor your colour: walk, roll-dash and splat paint bombs while tiles crack and Babcia's mop sweeps. Most tiles wins. | 2–8 |
| **Fajki** | Polish slang for smokes. In a smoky karczma (a country inn, in the arena games' low-poly 3D look, top view), a tray of cigarettes in everyone's colours spins in the middle of the table. Tap **GRAB** when yours passes in front of you, then smoke it: pull down on your phone at the right pace (follow the ghost ring), hold, let go – *Too fast!* or *Too slow!* puffs smoke less. Grab someone else's colour, or hold too long, and you cough for 3 s. The room fills with smoke as the minute goes on, so the colours get harder to tell apart. Then the pierogi fall one by one into a tower and say cheese: a crown hovers from grin to grin before it drops on the yellowest teeth. | 1–8 |

The six games from Czołgi on are **arena games** inspired by Mario Party minigames: the whole arena is on the TV in Maluch Rally's low-poly look, and every phone becomes the same pad, a joystick and one or two buttons. They need a TV for now.

The VIP can also start a **Tournament**: five random games in a row by default, or in **party mode** five games the players vote for one by one (see below).

## How a party works

1. On the TV, open the site and press **Host a party**. That's the only time anyone touches the TV.
2. Phones scan the QR code, or go to `/join` and type the 4-letter code. Then they enter a name and pick a pierogi colour.
3. The **first player to join is the VIP**. The VIP picks the game, toggles options, starts rounds,
   ends a game early (⋯ menu) and can remove players, all from their phone.
4. After each game the TV shows a podium and the **party standings** (3/2/1 points for the top three
   places; in the co-op Pierogi Panic everyone gets 1 point per star, averaged over the levels played). After a few
   seconds the podium gives way to a **standings screen**: the table starts as it stood before the game, the bars
   grow by what everyone just earned, the rows slide into their new places (▲▼ shows who moved), and a line chart
   shows everyone's total game by game (the last 10 games). The VIP chooses **Play again** or another game.

### Tournament

Pick **Tournament** at the top of the game list. The VIP's phone then shows the tournament settings:

- **Games**: how many games to play, 2 to 10 (default 5). If fewer switched-on games suit the room, the
  tournament plays as many as there are.
- **Party mode**: off by default. Instead of a random line-up, the players vote for every game (see
  *Party mode* below).
- **Short versions**: on by default; switch it off to play every game in full.
- **Games in the draw**: tap a game to switch it on or off (All on / All off). Games that don't suit the
  current number of players are faded. A tournament needs at least two games it can play.

The TV draws that many different games at random from
the competitive ones that suit the room (never Pierogi Panic, which is co-op; Maluch Rally only with
up to 4 players; To Ty! and Bazgroły only with 3 or more) and switched on, and shows the line-up. Each game
is played in its **short version** unless the VIP switched that off:

| Game | Full game | In a tournament |
| --- | --- | --- |
| Trails | first to 10 × (players − 1) | first to 5 × (players − 1) |
| Quiz | 10 questions | 5 questions |
| Ballpark | 7 questions | 3 questions |
| Maluch Rally | 3 races | 1 race |
| To Ty! | 7 questions, 2 doodle rounds, 75 s for selfies | 4 questions, 1 doodle round, 45 s for selfies |
| Bazgroły | 2 rounds (1 with 5+ players) | 1 round |
| Tour de Pierogi | 3 heats | 1 heat |
| Fork Fight | 8 rounds | 4 rounds (starting with more fakes) |
| Pierogi Parade | 3 rounds | 1 medium round |
| Czołgi | 3 rounds of 90 s | 1 round |
| Grzybki | 3 rounds | 1 round |
| Pushy Pierogi | 3 rounds | 1 round |
| Strzelnica | 3 rounds of 30 s | 1 round of 40 s, everything mixed |
| Babcia’s Cookbook | 3 rounds | 1 round |
| Kafelki | 2 rounds of 60 s, tiles added up | 1 round of 45 s |
| Fajki | 60 s | 40 s |

After every game the TV shows that game's podium and the tournament table: **10/7/5/3/2/1 tournament
points** for 1st to 6th place (ties share a place). Then the standings screen animates the tournament
table (with what each player just earned) next to a chart of everyone's tournament points game by game.
The VIP presses **Next game** on their phone to go on, or ends the tournament. After the last game the TV
crowns the champion, shows the whole tournament as a chart, and the tournament counts as one game in the
party standings (3/2/1). If the room changes mid-tournament so that the
next game can't start (say a fifth player joins before Maluch Rally), another game takes its place.
Tournaments need a TV.

#### Party mode

With **Party mode** on, nothing is drawn up front: the line-up on the TV is a row of question marks.
Before every game the TV shows a little 3D village square (the arena games' look) with a market stall
for each of **three games** that suit the room, and every phone becomes the arena pad. Walk your pierogi
onto a stall's mat to vote for that game; you can change your mind until the 15 s are up (once everybody
stands on a mat, it's cut to 2.5 s). Then comes the draw, as in Ultimate Chicken Horse: **every vote is a
ticket**, a light hops from ticket to ticket, slows down and stops on one, and that game is played. Three
votes for Kafelki and one for Quiz give Kafelki a 3 in 4 chance, not a sure win. If nobody votes, each game
gets one ticket. The three games on offer are ones not played yet in this tournament, as long as there
are any; if only two games can be played, the vote is between two, and with one there's no vote.
After each game the VIP's button reads **Vote for the next game**. The vote's rules and timings are in
`client/src/host/vote/logic.ts`, the draw (`drawVote`) and the choice of games (`partyChoices`) in
`client/src/host/tournament.ts`.

### No TV? Play on phones only

On the join page, enter your name and tap **Play without a TV**. Your phone starts the party: it
runs the host in the background (the same code the TV would run) and joins as the first player, so
you're the VIP. Your lobby shows the room code (tap it for a QR code), and friends join at `/join`
as usual. Only games that don't need a shared screen are offered. So far that's **Maluch Rally**,
where every phone renders the race itself:

- **Your phone is the screen.** A full-screen 3D chase view of your own car, with your position,
  lap, speed and a **minimap** (with the river, bridges and tunnel) in the corner.
- **Steering made for a phone you're looking at.** The car speeds up by itself, and BRAKE · DRIFT
  sits under your right thumb (or your left thumb when tilting). Choose during the
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

### Two rooms, one party: second screens

Two groups far apart can play in the same room. The host TV streams its picture and sound to a
**second screen** (another TV, laptop or tablet), and players there join on their phones with
the same room code, just as they would in the host's room. Up to 8 players in total, as always.

1. On the second screen, open `/screen` (or **Show another room's party on this screen** on the
   landing page) and type the room code.
2. On the host TV, press **📡** (top right; it pulses while a screen is waiting) → **Share this
   screen**, and pick this tab with its sound. The host has to be a browser that can share a tab:
   Chrome or Edge on a computer (Firefox and Safari can share the window). The Xbox browser can't,
   but it can be a second screen.
3. Players by the second screen scan the QR code they see in the stream, or go to `/join`.

Under the hood the host TV captures its own tab (`getDisplayMedia`) and sends it to every second
screen over WebRTC: one peer connection per screen, up to 4 screens, at most 4 Mbit/s and 30 fps
each. The Durable Object only relays the signalling (offer, answer, ICE candidates) on a third
socket role, `screen`; the video itself goes straight from TV to TV. Expect a delay of a few
hundred milliseconds on top of the phones' own, which is fine for most games but noticeable in the
fastest ones (Fork Fight, Maluch Rally). Second screens reconnect by themselves after a reload or a
network blip. If the host TV reloads, it has to press **📡 → Share this screen** again (browsers only
start a screen share from a click).

**If a second screen never connects**: WebRTC needs a route between the two networks. STUN
(always on) is enough for most home networks; behind stricter NATs (some mobile hotspots, office
networks) add a Cloudflare TURN server (the first 1,000 GB a month are free): in the dashboard open **Realtime → TURN Server**,
create a key, then set the Worker secrets `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`
(`npx wrangler secret put TURN_KEY_ID`, …). `/api/ice` then hands out short-lived TURN credentials.

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
- **Frontend:** Preact + Vite with four pages: `/` (TV), `/join` (phone), `/screen` (second screen) and `/dev` (test bench).
  Trails renders on a Canvas 2D at a fixed 60 Hz timestep with an occupancy grid for collisions.
  Sound effects are synthesized with WebAudio, so there are no audio files, and there's a mute
  toggle on the TV and in the VIP's lobby options. The music is synthesized too: tracks written out
  note by note in `client/src/lib/tracks.ts` and played by a small scheduler (`client/src/lib/music.ts`).
  The waiting room has its own tune (a lazy accordion mazurka), and games that feel alike share a track:
  *Thinking Cap* (Quiz, Ballpark, Podmianka, To Ty!, Bazgroły), *Polka Pierogi* (Tour de Pierogi,
  Fork Fight, Pierogi Parade, Pierogi Panic), *Barnyard Brawl* (the arena games), *Maluch Turbo*
  (Maluch Rally, Trails) and *Smoke Rings* (Fajki).
- The TV is a fixed **1920×1080 stage with a 5 % safe-area margin**, scaled to fit any screen.

```
shared/protocol.ts          typed messages, colours, constants
worker/index.ts             HTTP routes: POST /api/rooms, GET /api/rooms/:code, GET /api/ice, /ws/:code
worker/room.ts              RoomDO – the relay Durable Object
client/index.html           TV (host) entry   → client/src/host
client/join.html            phone entry       → client/src/phone
client/dev.html             /dev test bench   → client/src/dev
client/screen.html          second screen     → client/src/screen (receiver.ts: the WebRTC side)
client/src/host/mirror.ts   the host TV's side of second screens: tab capture, one peer connection per screen
client/src/games/*          quiz, trails, ballpark, kitchen (pure logic + TV views)
client/src/phone/kitchen.tsx  Pierogi Panic joystick, action button and minigames
client/src/games/rally/*    Maluch Rally: track generator, car physics, three.js renderer, no-TV race client
client/src/phone/rally.tsx  Maluch Rally thumb pad (with a TV)
client/src/phone/rallyDrive.tsx  Maluch Rally on the phone (no TV): 3D view, tilt/drag steering, minimap
client/src/phone/notvHost.ts     a phone hosting a party without a TV
client/src/phone/toty.tsx   To Ty! selfie camera and voting
client/src/phone/doodlePad.tsx  the drawing canvas (To Ty! and Bazgroły)
client/src/games/bazgroly/* Bazgroły: prompts, lies, scoring (logic.ts) and the TV views
client/src/phone/bazgroly.tsx  Bazgroły drawing, fake titles and guessing on the phone
client/src/games/pedal|fork|parade/*  Tour de Pierogi, Fork Fight, Pierogi Parade (pure logic + TV views)
client/src/phone/minigames.tsx   their phone controllers (pedals, the plate, the tap counter)
client/src/phone/arenaPad.tsx    the arena games' phone pad: a joystick and up to two buttons
client/src/games/arena/*    the arena games' shared low-poly 3D kit (kit.ts) and pad input (input.ts)
client/src/games/tanks|mushroom|pushy|gallery|cookbook|tiles/*  Czołgi, Grzybki, Pushy Pierogi, Strzelnica,
                            Babcia’s Cookbook, Kafelki (pure logic.ts, three.js scene.ts, TV view)
client/src/games/smoke/*     Fajki: tray, puff scoring and teeth (logic.ts), the 3D table and tower (scene.ts), TV view (SmokeGame.tsx)
client/src/phone/smoke.tsx   Fajki on the phone: GRAB and the pull-down puff
client/src/host/tournament.ts    picking the tournament's games and its points table, party mode's choices and draw
client/src/host/vote/*      party mode's vote: walking onto a game (logic.ts), the village square (scene.ts), TV view (VoteRoom.tsx)
data/trivia.json            200 quiz questions
data/ballpark.json          140 estimation questions
data/toty.json              162 "who's most likely to…" questions (66 with a doodle prompt)
data/bazgroly.json          200 Bazgroły drawing prompts
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
  The phones join automatically. Click a phone and use ← → (or A / D) to steer in Trails or pedal in
  Tour de Pierogi, and Space to stab in Fork Fight or count in Pierogi Parade (↓ / Backspace takes one off).
  In the arena games, arrows / WASD are the joystick and Space and Shift the two buttons.
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

Quiz and Ballpark timings are constants at the top of their `logic.ts` / game files, and so are the
lengths of the tournament's short versions (`QUIZ_ROUND_LENGTH_SHORT`, `BP_QUESTIONS_SHORT`, `RACES_SHORT`,
`TY_SHORT`, …). The tournament's size and points table are `TOURNAMENT_GAMES` and `TOURNAMENT_POINTS` in
`shared/protocol.ts`.

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

Podmianka's 36 extra objects (`client/public/sprites/swap/`) were made the same way with
`tools/sprites/swap.py`, which reuses the kitchen style prompt, and `process.py … raw-swap`.

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
- **Hard tracks**: Tatra Pass (switchbacks: rows of road up a mountain joined by hairpins), Vistula
  Snake (an oval whose straights are S-bend after S-bend) and Babcia’s Crown (five or six deep
  lobes). They're built the same way but allow corners down to a 12 m radius (normal tracks: 18 m)
  and parts of the road down to 28 m apart, so the barriers sit 10 m from the centre line instead
  of 13. A pass that smooths out any kink tighter than that keeps them valid. In the lobby:
  `cup` (three different normal shapes), `hard` (the three hard shapes) or one shape for all three
  races (`RALLY_TRACKS` in `shared/protocol.ts`).
- **Drifting** (`sim.ts`, `DRIFT`): the brake doubles as drift. Hold it while steering at more than
  14 m/s and the car drifts instead of braking (and keeps the power on); braking in a straight line
  or slowly still brakes. The car
  turns 0.35–1.3× harder than full lock (steering into or out of the drift), points its nose
  0.42 rad into the corner while it travels along its old line, and loses 16 % speed per second.
  0.8 s of drifting (sooner when steering into it) gives blue sparks and a 0.6 s mini-turbo when you
  let go; 1.9 s gives orange sparks and a 1.15 s super turbo. Spinning out loses the drift. With a
  TV the host sends your drift level in your view so the brake button glows; without one, the drift
  state rides along in the car report so other phones see your sparks.
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
  being taken. You hold one item at a time. Lifting your thumb off the pad (without a TV: tapping the item button) sends `act`, which fires
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
- With a TV the phone is a thumb pad: left/right steers, up is gas, down brakes (and drifts once
  you pull past halfway while turning; the brake half glows with the sparks). It sends the stick
  (−100…100 on both axes, in steps of 5) at most 20 times a second, only when it changes, and zero
  when the thumb lifts, which also fires your item.
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

### Bazgroły

A round goes like this (timings at the top of
[`client/src/games/bazgroly/logic.ts`](client/src/games/bazgroly/logic.ts)):

1. **Draw** (80 s): every player gets a different prompt from `data/bazgroly.json` and draws it
   on a blank page with the same canvas as To Ty!. Drawings are vector strokes, like doodles.
2. For each drawing, in random order:
   - **Lie** (45 s): the TV replays the drawing stroke by stroke, and everyone but the artist types
     a fake title (up to 40 characters). A title that matches the real one is turned down
     (“That’s the real title!”). Titles are compared without case, accents, punctuation or
     “a/an/the”, so “The haunted toaster!” matches “A haunted toaster”. **Lie for me** picks another
     prompt from the pool. Identical lies are merged into one option, and every author scores.
   - **Guess** (20 s): the real title and the lies, shuffled. You can’t pick your own lie. If
     there are fewer than three options, prompts from the pool are added as decoys.
   - **Reveal**: the lies that fooled somebody, least popular first, with who wrote them and who
     fell for them, and then the truth. Phones only show their result once the truth is out.
3. Scores: 1000 for finding the truth, 1000 to the artist per player who found it, and 500 per
   player fooled by your lie. With up to 4 players there are two rounds and the second pays
   double; with 5 or more there's one round (everyone's drawing gets shown once).

### Tour de Pierogi, Fork Fight and Pierogi Parade

- **Tour de Pierogi** (`games/pedal/logic.ts`): the phone counts alternating taps itself and sends
  the running total (`pedal {h, n}`) at most every 90 ms. The TV trusts it only up to
  `PEDAL_MAX_RATE` (16 strokes a second since the start, plus a little slack), so an auto-clicker
  can't win. A heat ends 8 s after the first rider finishes, as soon as everyone still connected is
  in, or after 45 s.
- **Fork Fight** (`games/fork/logic.ts`): a round is a list of things that land on the plate and
  when. The phone gets the list ahead of time and shows it on its own clock, then measures your
  reaction from the frame the pierogi is drawn in. Only the result goes to the TV
  (`fork {r, ms}`, or −1 for a stab at an empty plate and −2 for a fake), so Wi-Fi lag doesn't
  decide who's fastest. For the same reason the TV doesn't show the plate during a round ("Eyes on
  your phone!") and reveals what landed afterwards. The pierogi stays 1.5 s; fakes 0.9 s.
- **Pierogi Parade** (`games/parade/logic.ts`): each round is generated up front: the target
  colour, how many of it march (the answer) and the decoys, each with a lane, start time, speed and
  hop. Later rounds cut the marchers into tight groups of up to four (mixing colours), so you have to
  pick the right ones out of a bunch. Pierogi in one lane never catch up with each other, and with
  traffic both ways odd lanes walk right to left. The round also plans its **scene**
  (`scene.tsx` draws it): props standing in front of a lane (lamp posts, trees, market stalls,
  barrels) that hide pierogi walking behind them for a moment, trams that rattle across in front of
  a lane, and things that don't count: balloons in the parade colours, pierogi-shaped kites in the
  sky, pigeons, fireworks and neighbours watching from the windows. Props stay away from the edges,
  so every pierogi is seen walking on and off, and trams are faster than any pierogi, so they never
  hide one for its whole walk. Round 1 has a couple of lamp posts and a few balloons; round 3 has up
  to six props, two or three trams, kites, fireworks and 14–20 targets among 28–38 decoys. The TV
  animates everything with CSS only. Phones keep the count and send it as it changes
  (`count {r, n}`, at most every 150 ms); counting closes 2.5 s after the last pierogi has left.

### Arena games

Czołgi, Grzybki, Pushy Pierogi, Strzelnica, Babcia’s Cookbook and Kafelki share one phone controller
(`client/src/phone/arenaPad.tsx`): a floating joystick that fills most of the screen and up to two
buttons under it. The host sends a `pad` view naming the buttons, with a cooldown deadline (`readyAt`)
the phone animates itself, so cooldowns cost no extra messages. Phones send the stick as `stick {x, y}`
(32 directions × 3 speeds, at most 20 times a second and only when it changes) and buttons as
`btn {b, on}` on press and release. The TV runs each game's simulation at a fixed 60 Hz in a pure,
unit-tested `logic.ts` and draws it with the shared kit in `client/src/games/arena/kit.ts`: one
three.js camera over the whole arena, rendered at 45 % of 1080p and scaled up pixelated, flat-shaded
low-poly meshes, pixel textures, blob shadows and low-poly pierogi characters, like Maluch Rally.
`/?debug` on the TV exposes the running game as `window.tanks`, `window.mushroom` and so on.

### Czołgi
Little toy tanks in a walled farmyard (44 × 26 m) with stone walls, hay stacks, wells, a shed and wooden crates. The whole arena is on the TV; each phone is a joystick plus two buttons. Push the stick to drive and aim at once: the hull turns towards it (it turns on the spot first if you point more than about 100° away) and the turret snaps to it. Let go and the tank stops, with the turret left where it was.

- **Shell** flies at 22 m/s, ricochets once off walls and obstacles and pops on the second contact. One damage. At most two of your shells at a time, half a second between shots. Your own shell can hit you after it has bounced. Two shells that meet both pop.
- **Mortar** (green button) lobs a cabbage over everything to a point 11 m ahead of the turret, landing after one second. A red ring shows where. Everything within 3 m takes a hit (you too), crates are destroyed and tanks are knocked back. Four seconds to reload.
- **Armour** is three hits. At one heart the tank smokes; at zero it explodes into a wreck that stays as an obstacle and the driver pops out. Crates break after two shell hits or one mortar blast. New spawns get two seconds of shield.
- **Rounds** last 90 seconds or until one tank is left. In the last 20 seconds it is sudden death and every hit takes all remaining armour. Each round: +1 for every tank you knock out, plus one for every tank that went out before you, plus 2 for the last tank rolling. Three rounds (a different layout each time); one round in a tournament.
- Layouts come from five templates with random, point-symmetric crates; a flood fill makes sure every spawn can reach every open area. Spawns are evenly spread round the edge, facing the centre.

The simulation is in `client/src/games/tanks/logic.ts` (`TUNING`, pure, 60 Hz), the 3D scene in `scene.ts` and the HUD in `TanksGame.tsx`.

### Grzybki
A forest pond at golden hour. Everyone starts on a tree stump ringed by 6–8 giant mushrooms (6 for 2–4 players, 7 for 5–6, 8 for 7–8). Babcia, on her boat, holds up a colour (also a big banner on the TV and the title on your phone). Run to a mushroom of that colour before the ring runs out! Then the stump and every other mushroom sink, and anyone whose centre isn't on a cap of the called colour falls in the pond and swims to the bank, out for the round.
- **Controls:** the joystick walks (5.5 m/s, a little inertia). **Shove** is a short dash (1.2 s cooldown) that knocks back anyone you bump, so shove rivals off the cap. Walking alone can't take you over an edge; shoves and crowds can.
- **Calls:** 4.5 s for the first, 12 % shorter each time, down to 1.6 s. From call 3 the ring turns and carries you. Now and then the mushrooms swap colours as the colour is called (with 0.45 s extra), and from call 5 two mushrooms may share the called colour. The target can always be reached from where every survivor stands; if not, the call gets longer.
- **Scoring:** a player scores the number of players who fell in before them, and the last one dry gets +2. If everyone left falls in the same call it's a tie with no bonus; a round also ends after 30 calls. 3 rounds, 1 in a tournament. Tuning is in `client/src/games/mushroom/logic.ts`.

### Pushy Pierogi
A sumo brawl on a frozen pond at dusk. The TV shows a round ice floe (10 m radius) in a snowy village with pine trees, a lit wooden hut and falling snow. Everyone is a skating pierogi with a little knitted hat. The stick pushes rather than steers, so you glide and drift, topping out at 7 m/s.
- **Shove** is a dash in the stick direction with a 1.6 s cooldown. A pierogi hit mid-dash goes flying. **Brace** (blue button) plants your feet for 0.8 s: you become very heavy and almost stop, and anyone pushing into you bounces off. It has a 3 s cooldown.
- A pierogi whose centre leaves the ice falls in with a splash and is out for the round.
- After 15 s the outer chunks of the floe crack and flash. 2 s later they break off and sink, outer ring first, until only a small centre disc is left around the 73 s mark.
- Every 9–13 s a curling stone slides across the pond. An arrow on the bank and a red lane on the ice warn you 1.2 s before.
- A round ends when one pierogi is left, or at 90 s, when everyone still standing shares the win. Round points are the number of players who fell in before you, and the winner gets +2. Three rounds; one in a tournament. Tuning is in `client/src/games/pushy/logic.ts`.

### Strzelnica
A night-time fairground shooting gallery seen straight on. Each player steers a crosshair in their colour with the joystick: full deflection crosses the screen in about 2.2 s and gentle pushes are much slower for fine aim. **Fire** shoots a cork (6 per magazine, at most about 7 shots a second); **Reload** takes 0.9 s and is never automatic.
- The TV decides every hit when it processes the shot. It projects each target's visible bounds to screen pixels, so a ghost half hidden behind a hedge only counts above the hedge, and picks the nearest target under the crosshair. If two players hit the same target in the same frame, both score.
- Ghosts are 1 point, bats 2 and the rare golden ghost 5, but shooting a babcia cut-out costs 3 and earns an "Ojej!". Targets glide on two rails, pop up behind hedges, gravestones and waves, or peek out of the haunted cottage's windows, door and attic.
- Three rounds of 30 s, each with its own pattern: gliding ghosts, then pop-ups, windows and bats, then everything faster with more babcias. A round is a seeded list of spawns (`makeSchedule(seed, round, short, players)` in `client/src/games/gallery/logic.ts`); more players mean a denser round (up to 2.4×). In a tournament it is one 40 s round that mixes everything.

### Babcia’s Cookbook
A giant old cookbook lies open on Babcia’s kitchen table and everyone stands on the right-hand page (16 × 11 m). Every few seconds the left-hand page lifts, swings over the spine and slams down. It has holes cut in it (circles, rectangles, a pierogi, a star, a heart), and light shining through them marks lit patches on the page below. A pierogi whose centre is inside a hole when the page lands survives; everyone else is squashed flat and leaves a sticker.
- Controls: joystick walks (6 m/s, a little inertia); **Dash** is a short burst (about 3 m, 1.5 s cooldown) that shoves anyone it touches. Players are soft circles, so a full hole pushes people out.
- First pages: 3–4 big holes, 2.8 s from lift to landing. The swing shortens by 0.085 s a page down to 1.7 s; holes shrink from about 2.2 m to 0.55 m and drop to 1–2 per page; from page 6 a hole sometimes slides while the page swings. Every hole is reachable from every corner of the page within the swing time.
- Points: one per player squashed before you, plus 2 for the last one standing (a tie shares the win). Alone you score the pages you survived. 3 rounds, 1 in a tournament. Logic in `client/src/games/cookbook/logic.ts`.

### Kafelki
A tile-claiming brawl on a big old kitchen floor. Everyone is a pierogi in their colour; walk over a tile to paint it, including tiles somebody else painted. Most tiles at the end of the round wins. The floor is 12×8 tiles for 2–3 players, 16×10 for 4–5 and 20×12 for 6–8.
- **Controls:** the joystick walks (6 m/s). **Roll** is a 0.5 s rolling-pin dash that paints a 3-wide streak and bowls over anyone it hits for 1 s (cooldown 3 s). **Splat** lobs a paint bomb 6 m ahead that lands after 0.7 s and paints a 3×3 blob, stunning anyone on it (cooldown 6 s). Stunned players can't paint.
- **Tribulations:** in the second half of the round a few tiles crack, then crumble into holes for 4 s before coming back as fresh, unclaimed tiles. Walk onto a hole and you fall in and respawn at the edge after 2 s. Babcia's mop sweeps two rows now and then, wiping them to white; it is announced with a striped warning band 1.8 s ahead.
- **Rounds:** 2 rounds of 60 s, tile counts added up. The TV shows a live tile count per player, then a tally where the bars grow from last place to first.
- Tuning is in `client/src/games/tiles/logic.ts` (speeds, cooldowns, stun, crack/hole times, round lengths).

`/?debug` on the TV exposes the room as `window.host`; `host.finish({...})` ends the current game
with made-up scores, which is handy for walking through a tournament.

## Adding questions

- `data/trivia.json`: `{ id, category, difficulty, question, options[4], answerIndex }`.
  Options are shuffled when shown.
- `data/toty.json`: `{ id, question, draw? }`. `draw` is the doodle prompt for the player the room
  picked, with `{name}` standing in for their name. Questions 3 and 6 of each game always have one.
- `data/bazgroly.json`: `{ id, prompt }`. Prompts can be things, scenes or feelings (“Brain freeze”),
  up to 40 characters, without a full stop. They double as decoys and as “Lie for me” titles.
- `data/ballpark.json`: `{ id, question, answer, unit }`. Use `"unit": "year"` for years, so they
  display without thousands separators and with no decimal key.

Keep questions timeless (no "current" anything). `npm test` checks the files' shape.
