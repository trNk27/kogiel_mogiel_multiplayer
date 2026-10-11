# Second screens without video: sending game state instead of a screen share

Status: proposal · replaces the `getDisplayMedia` stream in `client/src/host/mirror.ts` for every
game that supports it, and keeps video only as a fallback.

## Why

Today a second screen (`/screen`) gets the host tab as WebRTC video:

```
host renders → tab capture → H.264 encode → network → jitter buffer → decode → <video>
```

Each step adds delay, and several of them we can't control. On a typical setup that comes to about
120–250 ms behind the host (the 📊 box on `/screen` shows the breakdown). It also:

- needs about 3 Mbit/s per second screen, uploaded from the host's connection;
- caps the picture at 720p30, and drops resolution when the host's CPU is busy;
- loads the host's CPU with encoding, which costs the host TV its own frame rate;
- needs a click on the host ("Share this screen" → pick the tab), and only works in desktop
  Chrome/Edge/Firefox;
- often needs a TURN server, because media has to go peer to peer.

Each game already knows everything the TV shows, in a few hundred bytes. The no-TV mode sends
exactly that to phones: `t: 'as'` arena snapshots (`games/arena/net.ts`) and `t: 'rs'` rally
snapshots (`games/rally/client.ts`), drawn by `PushyMirror`, `MushroomMirror` and `RallyClient`.
A second screen is just another viewer of the same game, so it can get the same treatment.

## The idea in one paragraph

The second screen runs the host UI itself, in **replica mode**. The host sends it (1) the
**shell state** (screen, players, lobby, results, tournament, standings) whenever it changes,
and (2) for the running game, either a **TV model** (turn-based games: whatever `render()`
reads) or a stream of **snapshots** (real-time games: positions ~30×/s, interpolated on the
screen, as the no-TV arena does). The second screen renders natively at its own resolution and
60 fps. Sound is sent as events and synthesized locally, since `lib/sound.ts` and `lib/music.ts`
already generate all audio in code. Games without a state mirror yet keep using video.

## Latency budget

| step | video today | state sync |
|---|---|---|
| capture | 16–33 ms | – |
| encode / serialize | 10–30 ms | < 1 ms |
| network (one way) | RTT/2 | RTT/2 (P2P data channel) or via the relay |
| jitter buffer / interpolation | 0–80 ms (adaptive) | turn-based: 0 · real-time: ~1.5 snapshot intervals (≈ 50 ms at 30 Hz) |
| decode | 5–20 ms | – |
| display | next vsync | next vsync |
| **typical total** | **120–250 ms** | **turn-based ≈ RTT/2 · real-time ≈ RTT/2 + 50 ms** |

Bandwidth falls from ~3 Mbit/s to a few KB/s per screen. Then the host has no capture or encode
work at all.

The interpolation delay is what remains. It can be traded down per game (send at 60 Hz, or
extrapolate from velocities, as `RallyClient` already does for 250 ms).

## Transport

Two paths, both already in place:

1. **WebRTC data channels (preferred).** `MirrorHost` already does the offer/answer/ICE dance per
   screen. Instead of `addTrack`, it opens two channels:
   - `state`: reliable and ordered. Shell state, TV models, sound events.
   - `snap`: `{ ordered: false, maxRetransmits: 0 }`. Real-time snapshots. A late snapshot is
     useless, so it's better dropped than retransmitted ahead of a fresher one.

   Data channels traverse the same NATs as video, but a stalled connection costs only a few KB,
   so a TURN relay is cheap when one is needed.
2. **The Durable Object relay (fallback).** When ICE fails, the host sends the same messages over
   its WebSocket. Add `{ t: 'scast'; m }` to `HostToServer` and broadcast it to every
   `screen`-tagged socket, as the `all` case does for phones. This works on any network, with no
   TURN, at the cost of one hop through Cloudflare.

The screen doesn't care which path a message came on. Both deliver the same `ScreenFrame`
messages:

```ts
// shared/protocol.ts
export type ScreenFrame =
  /** Everything outside the game. Sent whole when it changes (it's small); `v` only grows. */
  | { t: 'shell'; v: number; shell: ShellState }
  /** A turn-based game's TV model, sent whole when it changes. */
  | { t: 'tv'; g: GameId; v: number; m: unknown }
  /** A real-time game's snapshot: host clock, packed numbers and the events since the last one. */
  | { t: 'snap'; g: GameId; r: number; at: number; s: number[]; e?: unknown[] }
  /** Sound effects the host just played, by name (see "Sound"). */
  | { t: 'sfx'; at: number; n: string[] };
```

A screen that connects, or reconnects after a blip, gets the latest `shell` and `tv` straight away
(the host keeps the last of each, the way `lastSent` already works for phone views). Then it
needs nothing else to catch up.

## Host side

### Shell state

`ShellState` is plain data taken from `HostController`: `code`, `screen`, the player summaries
(name, colour, connected, party points), `selected`, `options`, `vip`, `gamesPlayed`, `history`,
`tournament` and the music track. `HostController.changed()` already runs on every change. A
`ScreenCaster` subscribes to it, serializes the state, and sends it only when the JSON differs from
the last one sent. That's the same dedupe trick as `refresh()` for phone views.

### Games

Add two optional methods to `Game` (`client/src/games/types.ts`):

```ts
export interface Game {
  // …
  /** Second screens, turn-based: the data `render()` needs, as JSON. Sent when it changes. */
  tvModel?(): unknown;
  /** Second screens, real-time: a packed snapshot (sent ~30×/s while the game runs). */
  tvSnapshot?(): { r: number; s: number[]; e: unknown[] };
}
```

The caster calls `tvModel()` on every `changed()`. It calls `tvSnapshot()` from a 33 ms timer
while `screen.s === 'game'`, and only when a screen is connected. Then a room with no second
screen pays nothing.

**Times must not be `performance.now()` values.** Several views compare deadlines against the
host's clock (for example `feed[].until` in Tanks). Models carry them as host `Date.now()`, and the
screen maps them with the clock offset that `SnapBuffer` already estimates.

### Sound

All TV audio is synthesized (`lib/sound.ts`, `lib/music.ts`), so the screen can play it too with
no audio stream. Music is a track id inside `ShellState`. For effects, `sound` gets a `tap`
hook: every effect method the host calls is also pushed into a list, and the caster flushes it as
`{ t: 'sfx' }` about every 33 ms. The screen calls the same method on its own `sound`. This
replaces the `audio: true` part of the tab capture. It also sounds better, since nothing is
compressed.

## Screen side

### Replica controller

`HostApp.tsx` and its components read the `controller` singleton. Step one is to give them their
data through a Preact context instead (`HostCtx`). Then the same `<Lobby/>`, `<Intro/>`,
`<Results/>`, `<TourEnd/>`, `<Scoreboard/>` and so on can render from either:

- `HostController` on the host TV, or
- `ReplicaController` on a second screen: a read-only object with the same fields, filled from
  `shell` frames, with no-op actions. The host-only UI (📡 panel, VIP/lobby buttons) checks
  `ctx.replica` and hides itself.

`ScreenApp` then renders `<HostApp ctx={replica}/>` in place of the `<video>`. The same
1920×1080 stage gets scaled to the second screen's size, so both TVs lay out the same.

### Game mirrors

A registry, `client/src/screen/tv/registry.ts`, maps `GameId` to a `TvMirror`:

```ts
export interface TvMirror {
  onModel?(m: unknown): void;
  onSnapshot?(r: number, at: number, s: number[], e: unknown[]): void;
  render(): JSX.Element;
  dispose(): void;
}
```

The phase plan below says which games get which kind of mirror. A game with no entry falls back
to video.

**The quick way for turn-based games: reuse the real class.** Most turn-based `render()` methods
only read fields of `this`. The mirror can create the real game class with a `ReplicaHost` whose
methods do nothing, never call `start()`, and `Object.assign(game, model)` on every `tv` frame.
Then `render()` works unchanged. `tvModel()` on the host just picks the fields `render()` reads.
This keeps each game to about 20 lines, and the TV view never has two copies to keep in sync. A
test can render each game both ways and compare the markup.

**Real-time games: reuse the scenes.** `PushyScene`, `MushroomScene`, `RallyScene` and the others
already take state and draw it. The phone mirrors (`PushyMirror`, `MushroomMirror`) do this with
`SnapBuffer` interpolation and the same packed encoders (`pushy/net.ts`, `mushroom/net.ts`). A
second screen mirror is the same class on a 1920×1080 canvas, plus the game's TV HUD, and needs no
new encoding.

## Phases

Each phase can ship by itself, because screens fall back to video per game.

| phase | scope | games |
|---|---|---|
| 0 | `HostCtx` refactor; `ScreenFrame` protocol; data channels + relay fallback in `MirrorHost`/`Receiver`; `ShellState`; sfx tap; per-game video fallback | lobby, intro, results, tournament screens |
| 1 | turn-based games through `tvModel()` and the real-class replica | quiz, ballpark, toty, bazgroly, fork, parade, swap |
| 2 | real-time games that already have snapshot codecs | pushy, mushroom (`as`), rally (`rs`, spectator view of all cars) |
| 3 | real-time games that need a new codec, following `arena/net.ts` | tanks, trails, smoke, kitchen, cookbook, gallery, tiles, pedal, premium, the party-mode vote walk |
| 4 | once everything is covered: make video opt-in (or drop it), and remove the "Share this screen" step | – |

After phase 0, connecting a second screen needs no click on the host. The 📡 panel only lists
screens, and offers "also share video" while any game in the room still needs it.

## Risks and how to handle them

- **Drift between host and replica rendering.** Both use the same components, and a snapshot test
  per game renders host and replica from one model and compares the markup.
- **Non-deterministic visuals** (particles, confetti, `Math.random()` in views). These are fine:
  the screen only needs to look right, not match pixel for pixel. Anything that matters to the
  game (who got hit, the pierogi count) is in the model or the events.
- **Big models** (Toty selfies, Bazgroły drawings). Send images once as their own `{ t: 'blob' }`
  frames on the reliable channel, and refer to them by id in the model, the way phones already get
  photos through `host.message`.
- **Version skew.** Host and screen load the same build from the same origin. Add the build hash to
  `shell`, and if they differ the screen reloads itself.
- **Relay costs.** Snapshots go peer to peer whenever possible. On the relay path they are ~30
  small messages per second per room, which is the same order as no-TV arena games today.

## Where the code goes

- `shared/protocol.ts`: `ScreenFrame`, `ShellState`, the `scast` relay message, and data channel
  labels.
- `worker/room.ts`: relay `scast` to the `screen` sockets.
- `client/src/host/mirror.ts`: data channels per screen; video tracks only when sharing.
- `client/src/host/caster.ts` (new): builds and dedupes `shell`/`tv` frames, runs the snapshot
  timer, flushes sfx.
- `client/src/host/HostApp.tsx`: read through `HostCtx`, hide host-only UI on replicas.
- `client/src/games/types.ts` and each game: `tvModel()` / `tvSnapshot()`.
- `client/src/screen/receiver.ts`: accept data channels, fall back to relay frames, keep the clock
  offset.
- `client/src/screen/replica.ts` (new) and `client/src/screen/tv/*` (new): `ReplicaController`
  and the per-game mirrors.
- `client/src/lib/sound.ts`: the `tap` hook.
