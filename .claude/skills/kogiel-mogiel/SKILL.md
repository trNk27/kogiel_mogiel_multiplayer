---
name: kogiel-mogiel
description: Turn a game idea into a working new game in this repo (Kogiel Mogiel · Couch Party), play-test it on the /dev bench, and open a pull request into main.
---

# Add a new game to Kogiel Mogiel

The user gives an idea for a party game. You build it so it shows up among the available games, show it working, and open a pull request for Manuel to review. One game per session, one branch per game, one PR per game.

## 1. Understand the idea
From the user's description, pin down:
- What happens in a round, and how the game ends / who wins
- What the **TV** shows, and whether the game also works without a TV
- What the **phones** show and what players tap/type
- Player count (the house standard is 2 to 8)
- A short lowercase id (like `clock` or `moles`) and a title

If one of these is genuinely missing and changes the build, ask ONE short question covering the gaps. Otherwise make sensible choices, build, and list your assumptions when you show the preview.

## 2. Read the house rules
- Read `README.md` (especially *Design language* and *Local development*) and `CONTRIBUTING.md` in full before writing code.
- `CONTRIBUTING.md` is the source of truth: its checklist decides which files to create and which shared files to touch. If it disagrees with this skill, CONTRIBUTING.md wins.
- Check existing games in `client/src/games/` and open issues/PRs (`gh issue list`, `gh pr list`) so you don't duplicate a game. If there's no issue for this idea yet, open one with a short pitch (what happens, what the phone shows, how many players) and link it from the PR.
- Pick a similar existing game and copy its shape rather than inventing a new structure.

## 3. Branch and build
- `git checkout main && git pull`, then create a branch like `game/<id>`. Never commit or push to `main`.
- Your own files: `client/src/games/<id>/` (`<Name>Game.tsx`, `logic.ts` with `howTo(short)`, `icon.tsx`, and `scene.ts` for 3D arena games), `test/<id>.test.ts`, and `data/<id>.json` only if the game has a question/prompt pool.
- Shared files: one or two lines each, exactly as the checklist says (`shared/protocol.ts`, `client/src/games/registry.ts`, `client/src/host/GameIcon.tsx`, `client/src/host/HostApp.tsx`, `client/src/host/caster.ts` for 3D only, and the games table in `README.md`). Don't refactor shared code.
- Handle the short (tournament) version via `host.short`, players dropping out mid-game (`onRemoved`, `onConnection`), and the design rules (phone buttons at least 48 px, short text, icons and colours do the explaining).

## 4. Check it
- `npm install` if needed, then `npm test` and `npm run typecheck`. Fix everything until both pass.

## 5. Show it before sending it
- `npm run dev`, then open `http://localhost:8787/dev?n=4` (adjust `n`; use `/dev?notv&n=3` for games that also work without a TV).
- Take screenshots of the TV and the phones at key moments (start, mid-round, results) with a headless browser (install Playwright if needed) and send them to the user.
- Ask for changes and iterate (re-run tests/typecheck and re-screenshot) until the user is happy.

## 6. Open the pull request
- Commit, push the branch, and open a PR into `main` with `gh pr create`.
- PR description: what the game is, player count, how a round works, any assumptions, the linked issue, and confirmation that `npm test` and `npm run typecheck` pass.
- Tell the user the PR is open; Manuel gets notified and reviews it. Only he can merge, and a merge goes live straight away.

## 7. Review feedback
- If Manuel asks for changes, make them on the **same branch**, re-run tests and typecheck, and push. The PR updates by itself; don't open a new one.

## 8. Merge conflicts
- If the PR says "This branch has conflicts" (usually two games added at once): `git fetch origin && git merge origin/main`, resolve by **keeping both sides** (both games' lines in the shared files), run tests and typecheck, then push.

## Rules
- One game per session/branch/PR.
- Never push to or merge into `main`.
- Don't open the PR while tests or typecheck fail.
