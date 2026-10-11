# Second screens: game state instead of a screen share

A second screen (`/screen`) shows exactly what the host TV shows, so a second group can play in
the same room from far away. It used to get the host tab as WebRTC video. Now the host sends it
**state**, and the second screen draws the TV itself.

## Why

The video path was `host renders → tab capture → H.264 encode → network → jitter buffer → decode →
<video>`. That was about 120–250 ms behind the host, needed ~3 Mbit/s of upload per screen, capped
the picture at 720p30, cost the host CPU time for encoding, needed a click on the host ("Share this
screen") after every reload, and only worked with a desktop browser as the host.

With state, the path is `host changes state → diff (well under 1 ms) → network → small playback
buffer → the screen's own render`. Only the network time and the buffer remain. The buffer adapts:
on a steady connection it's a few ms, and it never goes above 150 ms. Frames are a few hundred
bytes, so a screen needs tens of kbit/s. The picture is sharp at any size, and any browser can be
either side.

## How it works

The TV's interface (`HostApp`) is a function of one object: the room's `HostController`, which
holds the players, the lobby, the tournament and the running game. Games draw their TV views from
their own fields. So the second screen keeps a **replica** of that object graph and renders the
very same `HostApp` from it.

```
host TV                                              second screen
───────                                              ─────────────
HostController ──┐                                   Replica (screen/replica.ts)
  game, players  │ Encoder.diff()  ┌─────────┐        Decoder.apply() → copy of HostController
  scene calls ───┼────────────────▶│  frame  │──────▶ replay calls on its own scenes
  sound calls ───┘ (host/caster.ts)└─────────┘        HostApp isReplica (the same UI)
                                   data channel, or the Durable Object as a fallback
```

### Replicating objects (`client/src/lib/replica/codec.ts`)

- The host's `Encoder` walks everything reachable from the controller and gives each object an id.
  It remembers what it sent last for every object, so each frame has only:
  - new objects, in full;
  - changed fields;
  - changed cells of typed arrays (big grids change a few cells at a time);
  - ids nothing points to any more.
- The screen's `Decoder` applies that **in place**, so a copy keeps its identity for as long as
  the original lives. A 3D scene that holds on to a simulation keeps drawing the right one.
- **Classes survive.** Both sides load the same build. `classes.ts` registers every class exported
  from `client/src/games` and `client/src/host`, by module path and export name, which
  minification doesn't touch. So copies have their methods and getters, and `render()` works on
  them.
- **What isn't sent:**
  - functions;
  - objects of unregistered classes: DOM nodes, canvases, WebGL, audio;
  - "views";
  - fields a class lists in `static replicaSkip`.

  The screen's own values in those fields are left alone. A class can also set up fields for its
  copies with `static replicaInit(copy)`.
- Numbers are rounded to 4 decimals, which keeps frames short and stops float noise from counting
  as a change.
- **Player ids are never sent.** Phones connect with their id alone, so the encoder swaps every
  string equal to a player id for an alias (`~1`, `~2`, …). That covers values, `Map` keys and
  object keys. The screen uses the aliases consistently and never learns a real id. The room's
  host key is in `HostController.replicaSkip`.

### Replaying drawing and sound (`client/src/host/caster.ts`)

Some drawing isn't a function of state. The 3D scenes (three.js) are driven by calls like
`scene.update(sim, dt)` and `scene.handle(events)` every frame. A few games draw on canvases from
their loop (Trails, Pierogi Panic). Sounds play when something happens. For these:

- **Views** (`VIEWS` in `caster.ts`: every 3D scene, the minimap, the Premium showroom) are never
  sent. The screen's copy of the game makes its own when its TV view mounts, exactly as on the
  host. The host records the calls it makes to its views, and the screen replays them on its own.
- **Drawing methods** of games (`DRAWS`: `TrailsGame.draw` and `paintTrail`, `KitchenGame.draw`,
  `updateDom` and `paintStatic`, `GalleryGame.drawCrosshairs`, `muzzle`, `popText` and
  `flashCross`, `RallyGame.drawMap`) are recorded and replayed on the screen's copy of the game.
- **Every sound the host plays** is recorded wherever it's played from, and the screen plays
  exactly those. Its own copy's sound calls are muted, so nothing plays twice. The music follows
  the screen's own copy of the TV.
- A recorded call that runs other recorded methods only counts once: the screen's copy does the
  rest by itself. Calls on objects the screen doesn't know yet are skipped. For example, what a
  scene does in its constructor, the screen's scene does when it's made.
- Arguments go by reference when they're replicated objects (the simulation), and are copied
  otherwise (this frame's event list).

A frame goes out in a microtask right after the task that changed something, so one game frame
makes one TV frame. A heartbeat sends changes at least every 50 ms, for views that read state every
frame without telling anyone. Nothing runs while no second screen is connected.

### Frames and transport

```ts
{ t: 'f' | 'F', n, p, d, x?, k?, ch?, e? }
```

| field | meaning |
|---|---|
| `t` | `F` is a full snapshot and `f` is a diff |
| `n` | sequence number |
| `p`, `d` | the host's `performance.now()` and `Date.now()` |
| `x` | the patch |
| `k` | the calls to replay |
| `ch` | the host re-rendered |
| `e` | the encoder's epoch |

Frames over 40 KB go in parts.

- Each screen first gets a full frame through the Durable Object. When the WebRTC data channel
  opens, it gets a new full frame there, and frames stay on the channel from then on.
- If the channel closes, frames go back through the relay with a full frame.
- A screen that sees a gap in `n`, falls far behind, or reloads says `hello` and gets a full frame.
- A host reload starts a new epoch: the screen starts over and remounts.

### Playback on the screen (`client/src/screen/replica.ts`)

- Frames play on the host's clock, a little behind it. The offset comes from the fastest recent
  delivery. The extra delay is the 95th percentile of recent lateness, plus a few ms and at most
  150 ms, so a late frame still plays on time and one stray frame doesn't hold everything back.
- The page's `performance.now`, `Date.now` and `requestAnimationFrame` timestamps are moved onto
  the host's clock for the frame being shown. Countdowns, timers and animations that compare with
  times stored in the host's state then work unchanged. The clock slews towards the target and
  never jumps backwards.
- 📊 on the screen shows the buffer, the round trip (direct connections), frames per second and
  the data rate. The host's 📡 panel shows each screen's route, data rate, round trip, and the time
  to build a frame.

## Rules for game code

The second screen reuses the TV code as it is, which works as long as:

1. **What the TV shows comes from the game object**, or from objects reachable from it.
   Module-level state isn't sent. To Ty! keeps its selfies in a module map, so the game also holds
   a reference to that map.
2. **Things only the TV page has** (canvases, layers, DOM elements, offscreen buffers) are made
   lazily, or in `attach` from the view, not in the constructor. The screen's copy never runs the
   constructor. Examples are `TrailsGame.trailLayer` and `KitchenGame.staticLayer`.
3. **Drawing that happens in the game loop** goes through a view method or a method listed in
   `DRAWS`. Its arguments are state or plain data, not DOM elements: `GalleryGame.flashCross(i)`
   rather than `restart(cross.el)`.
4. **Views keep their own bookkeeping to themselves.** Don't stash scene objects on state objects.
   Gallery maps targets to models with a `WeakMap` inside the scene.
5. **Anything random that shows** (a visual style, a layout) is decided by the game, not by a view's
   constructor. Maluch Rally picks its look in the game and hands it to the scene. Cosmetic
   randomness (particles, camera shake) doesn't matter.
6. **A view that runs its own loop** checks `replicaMode.on` (`lib/replica/mode.ts`): on a copy, the
   host's replayed calls drive the drawing. Only the Premium title flyover does this.
7. **A new 3D scene class goes in `VIEWS`** in `caster.ts`.

`test/replica.test.ts` covers the codec. The end-to-end checks drove a host, phones and a second
screen in Chromium through every game, the vote walk, a tournament and the results screens, and
compared the two pictures. They also checked joining mid-game, the relay-only path, sound
(the same calls on both sides) and reloads on either side.
