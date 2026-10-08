/**
 * Party-mode vote ("Głosowanie"): pure rules and simulation. No DOM, no three.js.
 *
 * Before each game of a party-mode tournament, everybody's pierogi stands in a little village square
 * with a stall for each game on offer. Walk onto a stall's mat to vote for that game. When time is up,
 * every vote is a ticket in the draw and one ticket wins (as in Ultimate Chicken Horse): the more of
 * you stand on a game, the likelier it is – but nothing is certain.
 *
 * World units are metres, x to the right, z towards the viewer, y up.
 */
import type { Rng } from '../../games/rng';
import { drawVote } from '../tournament';

export const DT = 1 / 60;

/** Walking: the same feel as the arena games. */
export const WALK = 6;
export const WALK_RESPONSE = 11;
export const PLAYER_R = 0.55;
export const PUSH = 18;

/** The square players can walk on (|x| ≤ HALF_W, BACK_Z ≤ z ≤ FRONT_Z). */
export const HALF_W = 11;
export const BACK_Z = -5.2;
export const FRONT_Z = 5.6;
/** The mats in front of the stalls, and how far apart the stalls stand. */
export const MAT_Z = -2.2;
export const MAT_R = 2.0;
export const MAT_GAP = 7;
/** Where players start: a row near the front. */
export const START_Z = 3.8;

/** Time to vote. Once every player stands on a mat, it's cut short to SETTLED_S. */
export const VOTE_S = 15;
export const SETTLED_S = 2.5;
/** The draw: the light hops from ticket to ticket for this long, slowing down. */
export const SPIN_S = 3.6;
/** The winner is shown this long before the game's intro. */
export const CHOSEN_S = 2.6;

export type VotePhase = 'vote' | 'spin' | 'chosen';

/** Mat centre for choice `i` of `n`. */
export function matPos(i: number, n: number): { x: number; z: number } {
  return { x: (i - (n - 1) / 2) * MAT_GAP, z: MAT_Z };
}

/** Which mat (choice index) a player at (x, z) stands on, or null. */
export function matAt(x: number, z: number, n: number): number | null {
  for (let i = 0; i < n; i++) {
    const m = matPos(i, n);
    if (Math.hypot(x - m.x, z - m.z) <= MAT_R) return i;
  }
  return null;
}

/** Where player `i` of `n` starts. */
export function startPos(i: number, n: number): { x: number; z: number } {
  const span = Math.min(2 * HALF_W - 3, (n - 1) * 2.2);
  return { x: n > 1 ? -span / 2 + (span * i) / (n - 1) : 0, z: START_Z };
}

/**
 * The light's path for the draw: it walks along the tickets in order, a few times round, and stops on
 * the winner. Returns the ticket index at each step and when (seconds after the draw starts) it gets there.
 * Steps start quick and slow down towards the end.
 */
export function spinPath(tickets: number, win: number, total = SPIN_S): { at: number[]; idx: number[] } {
  const laps = tickets === 1 ? 0 : Math.max(1, Math.ceil(14 / tickets));
  const steps = laps * tickets + win + 1;
  const idx: number[] = [];
  const at: number[] = [];
  // The k-th step lands at total · (k/steps)^1.8, so the gaps between steps keep growing.
  for (let k = 0; k < steps; k++) {
    idx.push(k % tickets);
    const u = (k + 1) / steps;
    at.push(steps === 1 ? 0.3 : total * Math.pow(u, 1.8) * 0.92);
  }
  return { at, idx };
}

export interface Walker {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Which way they face (radians, 0 = +z). */
  face: number;
  /** Stick, -1..1 each. */
  ix: number;
  iz: number;
  present: boolean;
  /** The mat they stand on now. */
  on: number | null;
}

export class VoteSim {
  phase: VotePhase = 'vote';
  /** Seconds since the vote started. */
  time = 0;
  /** Seconds left to vote. */
  left = VOTE_S;
  /** Seconds since the draw started, or since the winner was shown. */
  phaseT = 0;
  readonly players: Walker[];
  /** The draw, once the vote is closed. */
  tickets: number[] = [];
  /** Who each ticket belongs to (player index, or -1 for a free ticket when nobody voted). */
  owners: number[] = [];
  win = -1;
  path: { at: number[]; idx: number[] } = { at: [], idx: [] };

  constructor(
    count: number,
    /** How many games there are to vote between. */
    readonly choices: number,
    private rng: Rng = Math.random,
    present: readonly boolean[] = [],
  ) {
    this.players = Array.from({ length: count }, (_, i) => {
      const s = startPos(i, count);
      return { x: s.x, z: s.z, vx: 0, vz: 0, face: Math.PI, ix: 0, iz: 0, present: present[i] ?? true, on: null };
    });
  }

  setInput(i: number, x: number, y: number) {
    const p = this.players[i];
    if (!p) return;
    p.ix = x;
    p.iz = y;
  }

  remove(i: number) {
    const p = this.players[i];
    if (p) {
      p.present = false;
      p.on = null;
    }
  }

  /** Votes per player (choice index or null). */
  votes(): (number | null)[] {
    return this.players.map((p) => (p.present ? p.on : null));
  }

  /** How many votes each choice has right now. */
  counts(): number[] {
    const c = Array.from({ length: this.choices }, () => 0);
    for (const v of this.votes()) if (v !== null) c[v]++;
    return c;
  }

  /** The winning choice, once drawn. */
  winner(): number | null {
    return this.win >= 0 ? this.tickets[this.win] : null;
  }

  /** Where the draw's light is now (ticket index), or -1. */
  lit(): number {
    if (this.phase === 'chosen') return this.win;
    if (this.phase !== 'spin') return -1;
    let k = -1;
    for (let s = 0; s < this.path.at.length; s++) if (this.path.at[s] <= this.phaseT) k = s;
    return k < 0 ? -1 : this.path.idx[k];
  }

  /** Close the vote now and draw (also used when time runs out). */
  close() {
    if (this.phase !== 'vote') return;
    const votes = this.votes();
    const d = drawVote(votes, this.choices, this.rng);
    // Tickets come sorted by choice; remember whose they are (in player order within a choice).
    const owners: number[] = [];
    if (votes.some((v) => v !== null)) {
      for (let c = 0; c < this.choices; c++) votes.forEach((v, i) => v === c && owners.push(i));
    } else for (let c = 0; c < this.choices; c++) owners.push(-1);
    this.tickets = d.tickets;
    this.owners = owners;
    this.win = d.win;
    this.path = spinPath(d.tickets.length, d.win);
    this.phase = 'spin';
    this.phaseT = 0;
    for (const p of this.players) p.ix = p.iz = 0;
  }

  /** Has every player who is here picked a mat? */
  settled(): boolean {
    const here = this.players.filter((p) => p.present);
    return here.length > 0 && here.every((p) => p.on !== null);
  }

  step(dt = DT): 'spin' | 'chosen' | 'done' | null {
    this.time += dt;
    this.phaseT += dt;
    this.move(dt);
    if (this.phase === 'vote') {
      this.left -= dt;
      if (this.settled()) this.left = Math.min(this.left, SETTLED_S);
      if (this.left <= 0) {
        this.left = 0;
        this.close();
        return 'spin';
      }
    } else if (this.phase === 'spin') {
      if (this.phaseT >= SPIN_S) {
        this.phase = 'chosen';
        this.phaseT = 0;
        return 'chosen';
      }
    } else if (this.phaseT >= CHOSEN_S) return 'done';
    return null;
  }

  private move(dt: number) {
    const voting = this.phase === 'vote';
    const k = Math.min(1, dt * WALK_RESPONSE);
    for (const p of this.players) {
      if (!p.present) continue;
      const tx = voting ? p.ix * WALK : 0;
      const tz = voting ? p.iz * WALK : 0;
      p.vx += (tx - p.vx) * k;
      p.vz += (tz - p.vz) * k;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      if (Math.hypot(p.vx, p.vz) > 0.6) p.face = Math.atan2(p.vx, p.vz);
    }
    // Soft bumping.
    const n = this.players.length;
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        const A = this.players[a];
        const B = this.players[b];
        if (!A.present || !B.present) continue;
        const dx = B.x - A.x;
        const dz = B.z - A.z;
        const d = Math.hypot(dx, dz);
        const o = 2 * PLAYER_R - d;
        if (o <= 0) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        const push = Math.min(o / 2, o * PUSH * dt);
        A.x -= nx * push;
        A.z -= nz * push;
        B.x += nx * push;
        B.z += nz * push;
      }
    for (const p of this.players) {
      if (!p.present) continue;
      p.x = Math.max(-HALF_W, Math.min(HALF_W, p.x));
      p.z = Math.max(BACK_Z, Math.min(FRONT_Z, p.z));
      // Once the vote closes, where you stand no longer counts.
      if (voting) p.on = matAt(p.x, p.z, this.choices);
    }
  }
}
