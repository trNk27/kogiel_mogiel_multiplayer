# Contributing to Kogiel Mogiel · Couch Party

New games are very welcome. This page explains how to get one from an idea onto the live site.

## Before you start

**Open an issue first** with a short pitch: what happens, what the phone shows, how many players.
That way two people don't build the same game, and we can agree on the idea before you put hours into it.

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
- [ ] `client/src/host/caster.ts` – only for 3D scenes: add your scene to the list
- [ ] `README.md` – a row in the games table, and in the tournament table if your game has a short version

## Things your game should handle

- **Short version**: if `host.short` is true it's part of a tournament, so play fewer rounds.
- **2 to 8 players**, and someone dropping out mid-game (`onRemoved`, `onConnection`).
- **The look**: read *Design language* at the top of the README. Phone buttons at least 48 px,
  short text, icons and colours do the explaining.

## If your pull request has conflicts

Two games added at the same time both add a line in the same spots in the shared files, so GitHub may say
*"This branch has conflicts"*. That's normal and quick to fix: keep **both** lines (theirs and yours).
Press **Resolve conflicts** on the pull request page, or ask and I'll do it.
