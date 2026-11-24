# Contributing to Kogiel Mogiel · Couch Party

New games are very welcome. This page explains how to get one from an idea onto the live site.

## Before you start

**Open an issue first** with a short pitch: what happens, what the phone shows, how many players.
That way two people don't build the same game, and we can agree on the idea before you put hours into it.

## Building a game with Claude

This repo includes a Claude skill (`.claude/skills/kogiel-mogiel/`) that follows this whole page for you.
In a Claude Code session on this repo, describe your idea, for example:

> Add a game to Kogiel Mogiel: [what happens, what the TV and phones show, how many players]

Claude builds it, runs the tests, shows you screenshots from `/dev?n=4`, and opens a pull request.

## How changes get in

1. **Fork** this repo (button top right), or, if you've been added as a collaborator, make a **branch** here.
2. Build your game on that fork/branch. Commit as often as you like.
3. Open a **pull request** into `main`. The tests and build run automatically.
4. I review it, maybe ask for changes, then merge.

Everything merged into `main` goes live straight away (see `.github/workflows/deploy.yml`),
so nobody pushes to `main` directly, including me.

## Running it locally

See *Local development* in the README. In short:

```bash
npm install
npm run dev
```

Then open <http://localhost:8787/dev?n=4>: the TV and four simulated phones on one screen.
That's the fastest way to play-test. Use `/dev?notv&n=3` if your game also works without a TV.

Before opening a pull request, run:

```bash
npm test
npm run typecheck
```

## Adding a game: checklist

Pick a short lowercase id for your game, like `clock` or `moles`. Then:

**Your own files** (nobody else touches these):

- [ ] `client/src/games/<id>/` – your game. Look at a similar existing game and copy its shape:
  - `<Name>Game.tsx` – a class implementing `Game` from `client/src/games/types.ts`
  - `logic.ts` – the rules, kept free of drawing code so it can be tested, plus a `howTo(short)` function
  - `icon.tsx` – the game's icon for the menu
  - for 3D arena games, a `scene.ts` (see `client/src/games/arena/` for the shared kit)
- [ ] `test/<id>.test.ts` – tests for `logic.ts` (scoring, round ends, edge cases like one player leaving)
- [ ] `data/<id>.json` – only if your game has a pool of questions/prompts

**Shared files** (one or two lines each; these are where pull requests can clash, see below):

- [ ] `shared/protocol.ts` – add your id to the `GameId` list and an entry to `GAMES`
  (title, tagline, `minPlayers`, and `coop` / `noTv` / `maxPlayers` if they apply)
- [ ] `client/src/games/registry.ts` – import your game and add a `case` to `createGame`
- [ ] `client/src/host/GameIcon.tsx` – import your icon and add a line for it
- [ ] `client/src/host/HostApp.tsx` – import your `howTo` and add a `case` to the how-to switch
- [ ] `client/src/host/caster.ts` – for any 3D or `<canvas>` scene: add your scene to `VIEWS` so second-screen mirroring works
- [ ] `client/src/lib/tracks.ts` – the music: add your id to a `case` in `trackForGame` (`quiz`, `polka`,
  `race` or `lounge`), or to the `null` case if your game makes its own sounds. Games not listed get the arena track.
- [ ] `README.md` – a row in the games table, and in the tournament table if your game has a short version

**The phone screen.** Reuse a ready-made one if you can, then there's nothing more to add:

- `ask` (`client/src/phone/ask.tsx`) – a title, a time bar and one input: type an answer, pick an option,
  a slider, big keys, or a drawing pad. For word, drawing and voting games.
- `pad` (`client/src/phone/arenaPad.tsx`) – a joystick plus up to two buttons. For arena games, where the action is on the TV.

If neither fits, your game gets its own phone screen (like Wybredna Baja or Podmianka). That needs:

- [ ] `shared/protocol.ts` – a variant in `PhoneView` (what the phone shows) and in `PhoneMsg` (what it sends back)
- [ ] a component for it, e.g. `client/src/games/<id>/phone.tsx`
- [ ] `client/src/phone/views.tsx` – import the component and add a `case` to `ViewRouter`

## Things your game should handle

- **Short version**: if `host.short` is true it's part of a tournament, so play fewer rounds.
- **2 to 8 players**, and someone dropping out mid-game (`onRemoved`, `onConnection`).
- **The look**: read *Design language* at the top of the README. Phone buttons at least 48 px,
  short text, icons and colours do the explaining.

## Art styles & Resource Management (`client/src/lib/assets/`)

See [`client/src/lib/assets/README.md`](client/src/lib/assets/README.md) for copy-paste examples and pack lists. Every game uses one of the **three standardized art styles** in `client/src/lib/assets/styles.ts` (`ART_STYLES`):

- `'cartoon'` — Kogiel Mogiel's normal 2D cartoon look: painted WebP sprites (`kitchen`, `swap` packs) preloaded via `resources.preload(...)`, plus cut-paper cards & SVG Pierogi (`client/src/lib/art.tsx`).
- `'3d'` — Flat-shaded PS2-era low-poly 3D via `ArenaStage`, `buildPierogi`, `groundTexture`, `buildBabcia`, and `Puffs` (`client/src/games/arena/`).
- `'pixel'` — Crisp 16-bit `640×360` pixel art (`3×` integer scale to `1920×1080`, `imageSmoothingEnabled = false`) with declarative pixel grids and `$out`/`$deep`/`$shade`/`$base`/`$hi` dynamic player color ramps.

To add sprites for a new game, register a `SpritePack` with `resources.registerPack(...)` (supporting `'image'`, `'pixel'`, `'pixelAnim'`, and 3-slice `'pixelTile3'` entries) and draw via `resources.draw(...)` or `resources.drawTileRow(...)`. Shared animated pixel Pierogi (`pierogi-idle`, `pierogi-run`, `pierogi-jump`, `pierogi-fall`, `pierogi-spin`, `pierogi-win`, `pierogi-frozen`) and icons live in the `'pixel-common'` pack so new pixel-art games can reuse them immediately. Preview all three styles and packs at `/styles`.

### Optional easter egg: hidden Baja

If you (or your AI agent) feel like adding a cute touch to a new game, you're welcome to hide a small, **purely cosmetic** cameo of **Baja** — the little ginger-and-white Pomchi with her quilted brown & tan carrier bag (she never affects gameplay or hitboxes). Ready-made helpers exist for every style (see [`client/src/lib/assets/README.md`](client/src/lib/assets/README.md)):

- `'pixel'` — `BajaPatrol` + `'pixel-common'` sprites (`baja-idle`, `baja-run`, `baja-bag`, `baja-bag-empty`)
- `'3d'` — `BajaCameo3D`, `buildBaja()`, and `buildBajaBag()` in `client/src/games/arena/baja3d.ts`
- `'cartoon'` — reuse `<Baja />` / `<BajaRun />` from `client/src/games/baja/art.tsx` or tuck a small SVG peek into the background

## If your pull request has conflicts

Two games added at the same time both add a line in the same spots in the shared files, so GitHub may say
*"This branch has conflicts"*. That's normal and quick to fix: keep **both** lines (theirs and yours).
Press **Resolve conflicts** on the pull request page, or ask and I'll do it.
