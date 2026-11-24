import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import {
  BAJA_ROUNDS,
  BAJA_ROUNDS_SHORT,
  BAJA_TRIES,
  BUILD_MS,
  CAT_FOOLED_BONUS,
  CAT_FROM_ROUND,
  CAT_MIN_PLAYERS,
  ROWS,
  TREATS,
  VOTE_RIGHT,
  catPoints,
  clueText,
  dealClues,
  hits,
  makeCraving,
  mostVoted,
  mulberry32,
  owners,
  partsFor,
  plateEmoji,
  reactionFor,
  reactionText,
  shuffle,
  teamPoints,
  treatClue,
  type Clue,
  type Rng,
} from './logic';
import { Baja, BajaRun, Cat, Offering, type Mood } from './art';
import './baja.css';

const INTRO_MS = 9000;
const SNIFF_MS = 1400;
const REACT_MS = 3200;
const EAT_MS = 4200;
const REVEAL_MS = 6000;
const VOTE_MS = 25_000;
const CAT_MS = 7000;
/** Picks sent right at the deadline get this long to arrive. */
const LATE_MS = 600;

type Phase = 'intro' | 'build' | 'taste' | 'reveal' | 'vote' | 'cat' | 'end';

function bark(times = 2) {
  for (let i = 0; i < times; i++) sound.note(880, 0.07, { type: 'square', vol: 0.07, delay: i * 0.16, slide: 1250 });
}

interface Result {
  big: string;
  text: string;
  good: boolean;
  pts: number;
}

export class BajaGame implements Game {
  readonly id = 'baja' as const;
  readonly rounds: number;
  round = 0;
  key = 0;
  phase: Phase = 'intro';
  endsAt = 0;
  scores: Record<string, number> = {};
  parts = 3;
  craving: number[] = [];
  own: string[] = [];
  plate: (number | null)[] = [];
  ready = new Set<string>();
  clues: Record<string, Clue[]> = {};
  treats: Record<string, number> = {};
  /** Treats given this craving, for the TV: who, and when. */
  treatLog: { id: string; at: number }[] = [];
  cat: string | null = null;
  tryN = 1;
  history: { plate: number[]; hits: number }[] = [];
  fedOn: number | null = null;
  tasteStage: 'sniff' | 'react' = 'sniff';
  votes: Record<string, string> = {};
  private results = new Map<string, Result>();
  private rng: Rng;
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
    seed = Math.floor(Math.random() * 1e9),
  ) {
    this.rng = mulberry32(seed);
    this.rounds = host.short ? BAJA_ROUNDS_SHORT : BAJA_ROUNDS;
    for (const id of ids) {
      this.scores[id] = 0;
      this.treats[id] = TREATS;
    }
  }

  start() {
    this.nextRound();
  }

  dispose() {
    this.clear();
  }

  private clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private at(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, Math.max(0, ms)));
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  private present = (id: string) => !!this.host.player(id)?.connected;

  get catRound() {
    return this.cat !== null;
  }

  // ---- Flow -----------------------------------------------------------------------

  private nextRound() {
    this.clear();
    this.round++;
    if (this.round > this.rounds || this.ids.length < 1) {
      this.phase = 'end';
      this.host.finish(this.scores);
      return;
    }
    this.key++;
    this.parts = partsFor(this.ids.length);
    this.craving = makeCraving(this.parts, this.rng);
    this.own = owners(shuffle(this.ids, this.rng), this.parts);
    this.plate = Array.from({ length: this.parts }, () => null);
    this.ready.clear();
    this.clues = dealClues(this.craving, this.own, this.ids, this.rng);
    this.treatLog = [];
    this.cat = this.round >= CAT_FROM_ROUND && this.ids.length >= CAT_MIN_PLAYERS ? this.ids[Math.floor(this.rng() * this.ids.length)] : null;
    this.tryN = 1;
    this.history = [];
    this.fedOn = null;
    this.votes = {};
    this.results.clear();
    this.phase = 'intro';
    this.endsAt = Date.now() + INTRO_MS;
    bark();
    this.at(INTRO_MS, () => this.build());
    this.update();
  }

  private build() {
    this.clear();
    this.phase = 'build';
    this.ready.clear();
    this.endsAt = Date.now() + BUILD_MS;
    sound.reveal();
    this.at(BUILD_MS + LATE_MS, () => this.taste());
    this.update();
  }

  /** Everyone who owns a part (and is here) has said they're ready. */
  private allReady() {
    const pickers = [...new Set(this.own)].filter(this.present);
    return pickers.length > 0 && pickers.every((id) => this.ready.has(id));
  }

  private taste() {
    if (this.phase !== 'build') return;
    this.clear();
    // Anything nobody picked: Baja gets a random something.
    const plate = this.plate.map((v, i) => v ?? Math.floor(this.rng() * ROWS[i].options.length));
    this.plate = plate;
    const h = hits(plate, this.craving);
    this.history.push({ plate, hits: h });
    this.phase = 'taste';
    this.tasteStage = 'sniff';
    this.endsAt = 0;
    sound.note(1400, 0.05, { type: 'sine', vol: 0.06 });
    sound.note(1500, 0.05, { type: 'sine', vol: 0.06, delay: 0.15 });
    sound.note(1400, 0.05, { type: 'sine', vol: 0.06, delay: 0.3 });
    this.update();
    this.at(SNIFF_MS, () => {
      this.tasteStage = 'react';
      const r = reactionFor(h, this.parts);
      if (r === 'eat') {
        this.fedOn = this.tryN;
        sound.correct();
        bark(3);
        for (const id of this.ids) this.host.buzz(id, [80, 60, 80, 60, 200]);
      } else if (r === 'snub') sound.wrong();
      else if (r === 'lick') sound.plop();
      else {
        sound.note(300, 0.12, { type: 'triangle', vol: 0.1 });
        sound.note(700, 0.18, { type: 'sawtooth', vol: 0.07, delay: 0.6, slide: 200 });
      }
      this.update();
      this.at(r === 'eat' ? EAT_MS : REACT_MS, () => {
        if (r === 'eat' || this.tryN >= BAJA_TRIES) this.reveal();
        else {
          this.tryN++;
          this.build();
        }
      });
    });
  }

  private reveal() {
    this.clear();
    this.phase = 'reveal';
    this.endsAt = Date.now() + REVEAL_MS;
    const team = teamPoints(this.fedOn);
    for (const id of this.ids) {
      if (id === this.cat) {
        const cp = catPoints(this.fedOn);
        this.scores[id] += cp;
        this.results.set(id, {
          big: this.fedOn ? 'Baja got fed… 😾' : 'She’s starving! 😼',
          text: 'Now don’t get caught.',
          good: !this.fedOn,
          pts: cp,
        });
      } else {
        this.scores[id] += team;
        this.results.set(id, {
          big: this.fedOn ? `Fed on try ${this.fedOn}! 🐶` : 'Baja is still hungry 😢',
          text: this.fedOn ? 'The whole team scores.' : 'Better luck next craving.',
          good: !!this.fedOn,
          pts: team,
        });
      }
    }
    if (!this.fedOn) sound.wrong();
    this.at(REVEAL_MS, () => (this.cat ? this.vote() : this.nextRound()));
    this.update();
  }

  private vote() {
    this.clear();
    this.phase = 'vote';
    this.endsAt = Date.now() + VOTE_MS;
    sound.whoosh();
    this.at(VOTE_MS + LATE_MS, () => this.catReveal());
    this.update();
  }

  private catReveal() {
    if (this.phase !== 'vote') return;
    this.clear();
    this.phase = 'cat';
    this.endsAt = Date.now() + CAT_MS;
    const cat = this.cat!;
    const top = mostVoted(this.votes);
    const caught = top.length === 1 && top[0] === cat;
    for (const id of this.ids) {
      if (id === cat) {
        const pts = caught ? 0 : CAT_FOOLED_BONUS;
        this.scores[id] += pts;
        this.results.set(id, { big: caught ? 'Caught! 🙀' : 'Nobody suspected you 😼', text: caught ? 'They saw right through you.' : 'Purrfect crime.', good: !caught, pts });
      } else {
        const right = this.votes[id] === cat;
        const pts = right ? VOTE_RIGHT : 0;
        this.scores[id] += pts;
        const catName = this.host.player(cat)?.name ?? 'Someone';
        this.results.set(id, { big: right ? 'You found the cat! 🐈' : 'Wrong pierogi!', text: `${catName} was the cat.`, good: right, pts });
      }
    }
    caught ? sound.fanfare() : sound.wrong();
    this.at(CAT_MS, () => this.nextRound());
    this.update();
  }

  // ---- Phones ---------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'baja' || m.key !== this.key || !this.ids.includes(id)) return;
    if (this.phase === 'build') {
      if (typeof m.part === 'number' && typeof m.opt === 'number') {
        const part = m.part;
        if (this.own[part] !== id || !Number.isInteger(m.opt) || m.opt < 0 || m.opt >= (ROWS[part]?.options.length ?? 0)) return;
        this.plate[part] = m.opt;
        this.ready.delete(id);
        sound.pickup();
      } else if (typeof m.ready === 'boolean') {
        if (!this.own.includes(id)) return;
        if (m.ready && this.own.some((o, i) => o === id && this.plate[i] === null)) return;
        if (m.ready) this.ready.add(id);
        else this.ready.delete(id);
        sound.lockIn();
      } else if (m.treat) {
        if ((this.treats[id] ?? 0) <= 0) return;
        const c = treatClue(this.craving, this.clues[id] ?? [], this.rng);
        if (!c) return;
        this.treats[id]--;
        this.clues[id] = [...(this.clues[id] ?? []), c];
        this.treatLog.push({ id, at: Date.now() });
        bark(1);
        this.at(3000, () => this.host.changed());
      } else return;
      this.update();
      if (this.allReady()) {
        this.clear();
        this.at(900, () => this.taste());
      }
      return;
    }
    if (this.phase === 'vote' && typeof m.vote === 'string' && m.vote !== id && this.ids.includes(m.vote)) {
      this.votes[id] = m.vote;
      sound.lockIn();
      this.update();
      if (this.ids.filter(this.present).every((x) => this.votes[x])) {
        this.clear();
        this.at(800, () => this.catReveal());
      }
    }
  }

  onConnection() {
    this.host.changed();
  }

  onRemoved(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    delete this.votes[id];
    this.ready.delete(id);
    if (this.ids.length === 0) {
      this.clear();
      this.host.finish({});
      return;
    }
    // Hand their parts to someone still here, and if they were the cat, the cat is gone.
    this.own = this.own.map((o, i) => (o === id ? this.ids[i % this.ids.length] : o));
    if (this.cat === id) this.cat = null;
    if (this.phase === 'vote' && !this.cat) {
      this.clear();
      this.nextRound();
      return;
    }
    this.update();
  }

  viewFor(id: string): PhoneView {
    const r = this.results.get(id);
    const showResult = (this.phase === 'reveal' || this.phase === 'cat') && r;
    return {
      v: 'baja',
      phase: this.phase,
      key: this.key,
      round: Math.max(1, Math.min(this.round, this.rounds)),
      rounds: this.rounds,
      tryN: this.tryN,
      tries: BAJA_TRIES,
      parts: this.parts,
      endsAt: this.endsAt,
      total: this.scores[id] ?? 0,
      mine: this.own.map((o, i) => (o === id ? i : -1)).filter((i) => i >= 0),
      owners: this.own.map((o) => {
        const p = this.host.player(o);
        return { name: p?.name ?? '?', color: p?.color ?? 'yolk' };
      }),
      plate: this.plate.slice(),
      ready: this.ready.has(id),
      clues: (this.clues[id] ?? []).map(clueText),
      treats: this.treats[id] ?? 0,
      cat: this.cat === id,
      catRound: this.catRound,
      history: this.history.slice(),
      answer: this.phase === 'reveal' || this.phase === 'vote' || this.phase === 'cat' ? this.craving.slice() : null,
      players: this.ids
        .filter((x) => x !== id)
        .flatMap((x) => {
          const p = this.host.player(x);
          return p ? [{ id: x, name: p.name, color: p.color }] : [];
        }),
      voted: this.votes[id] ?? null,
      result: showResult ? r : undefined,
    };
  }

  // ---- TV -------------------------------------------------------------------------

  private mood(): Mood {
    if (this.phase === 'taste') {
      const last = this.history[this.history.length - 1];
      return this.tasteStage === 'sniff' || !last ? 'sniff' : reactionFor(last.hits, this.parts);
    }
    if (this.phase === 'reveal') return this.fedOn ? 'eat' : 'snub';
    if (this.treatLog.some((t) => Date.now() - t.at < 2500)) return 'lick';
    return 'idle';
  }

  private bubble(): string {
    const recent = this.treatLog.filter((t) => Date.now() - t.at < 2500).pop();
    if (recent && this.phase === 'build') return `*crunch* ${this.host.player(recent.id)?.name ?? 'Someone'}, I'll tell you a secret… 🤫`;
    switch (this.phase) {
      case 'intro':
        return this.catRound ? 'I’m hungry! But one of you smells like… CAT. 🐈' : 'I’m hungry! Figure out what I want. Together!';
      case 'build':
        return this.tryN === 1 ? 'Talk to each other! Your clues are on your phones.' : 'Still hungry… try again!';
      case 'taste': {
        const last = this.history[this.history.length - 1];
        return this.tasteStage === 'sniff' || !last ? '*sniff sniff*' : reactionText(reactionFor(last.hits, this.parts));
      }
      case 'reveal':
        return this.fedOn ? 'Best. Dinner. Ever.' : 'You all let me STARVE?!';
      case 'vote':
        return 'Who’s the cat? I can smell it…';
      case 'cat':
        return 'I KNEW it!';
      case 'end':
        return 'Good night!';
    }
  }

  render() {
    const mood = this.mood();
    const players = this.ids.map((id) => this.host.player(id)).filter((p) => !!p);
    const last = this.history[this.history.length - 1];
    const zoom = this.phase === 'taste' && this.tasteStage === 'react' && mood === 'eat';
    const catP = this.cat ? this.host.player(this.cat) : undefined;
    const voteCount = (pid: string) => Object.values(this.votes).filter((v) => v === pid).length;

    return (
      <div class="screen baja-screen bt-screen">
        <div class="baja-sofa" />
        <div class="baja-top">
          <div class="pill">
            Craving {Math.max(1, Math.min(this.round, this.rounds))} / {this.rounds}
          </div>
          {(this.phase === 'build' || this.phase === 'taste') && (
            <div class="pill">
              Try {this.tryN} / {BAJA_TRIES}
            </div>
          )}
          {this.catRound && this.phase !== 'cat' && <div class="pill pill-cat">🐈 A cat is among you</div>}
          <div class="grow" />
          {(this.phase === 'build' || this.phase === 'vote') && (
            <TimerRing key={`t${this.key}-${this.phase}-${this.tryN}`} endsAt={this.endsAt} total={this.phase === 'vote' ? VOTE_MS : BUILD_MS} size={110} onTick={(s) => s <= 5 && s > 0 && sound.tick()} />
          )}
        </div>

        <div class="baja-stage">
          <div class={`baja-wrap mood-${mood}`} key={`${this.phase}-${this.tasteStage}-${this.tryN}`}>
            <Baja mood={mood} size={600} />
          </div>
          <div class="baja-bubble pop-in" key={`b-${this.phase}-${this.tasteStage}-${this.treatLog.length}`}>
            {this.bubble()}
          </div>
          {this.phase === 'taste' && last && (
            <div class="baja-plate" key={`p${this.tryN}`}>
              <div class="baja-plate-who bt-teamplate">Team plate</div>
              <Offering plate={last.plate} size={1.25} />
            </div>
          )}
          {zoom && (
            <div class="baja-zoomies">
              <BajaRun size={300} />
            </div>
          )}
        </div>

        <div class="bt-panel">
          {(this.phase === 'intro' || this.phase === 'build' || this.phase === 'taste') && (
            <>
              <div class="bt-panel-title">{this.phase === 'intro' ? 'Who picks what' : 'The team plate'}</div>
              <div class="bt-slots">
                {this.own.map((o, i) => {
                  const p = this.host.player(o);
                  const v = this.plate[i];
                  const opt = v !== null ? ROWS[i].options[v] : null;
                  return (
                    <div class={`bt-slot ${this.ready.has(o) ? 'ready' : ''}`} style={{ '--pc': p ? colorHex(p.color) : '#888' }}>
                      <span class="bt-slot-title">{ROWS[i].title}</span>
                      <span class="bt-slot-pick" key={`${i}-${v}`}>
                        {opt ? opt.emoji : '❓'}
                      </span>
                      <span class="bt-slot-label">{opt ? opt.label : 'thinking…'}</span>
                      {p && (
                        <span class="bt-slot-who">
                          <Pierogi color={colorHex(p.color)} size={34} mood={this.ready.has(o) ? 'wow' : 'happy'} />
                          {p.name}
                          {this.ready.has(o) && ' ✓'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {this.phase === 'intro' && <div class="bt-note">🔒 Your secret clues are about the OTHER parts. Share them!</div>}
              {this.phase === 'build' && (
                <div class="bt-treats">
                  {players.map((p) => (
                    <span class="bt-treat" style={{ '--pc': colorHex(p.color) }}>
                      {p.name} {'🦴'.repeat(this.treats[p.id] ?? 0) || '·'}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
          {this.history.length > 0 && this.phase !== 'vote' && this.phase !== 'cat' && (
            <div class="bt-history">
              {this.history.map((h, k) => (
                <div class={`bt-try ${h.hits === this.parts ? 'win' : ''}`}>
                  <span class="bt-try-n">#{k + 1}</span>
                  <span class="bt-try-plate">{plateEmoji(h.plate).join(' ')}</span>
                  <span class="baja-paws">
                    {Array.from({ length: this.parts }, (_, i) => (
                      <i class={i < h.hits ? 'on' : ''}>🐾</i>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
          {this.phase === 'reveal' && (
            <div class="baja-answer bt-answer pop-in">
              <small>Baja wanted</small>
              <Offering plate={this.craving} size={1.1} />
              <div class="baja-answer-text">
                {this.craving.map((v, i) => (
                  <span>
                    {ROWS[i].options[v].emoji} {ROWS[i].options[v].label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {this.phase === 'vote' && (
            <>
              <div class="bt-panel-title">Who is the neighbour’s cat? 🐈</div>
              <div class="bt-note">Vote on your phone. Argue on the call!</div>
              <div class="bt-suspects">
                {players.map((p) => (
                  <div class="bt-suspect" style={{ '--pc': colorHex(p.color) }}>
                    <Pierogi color={colorHex(p.color)} size={70} mood={this.votes[p.id] ? 'wow' : 'happy'} />
                    <span>{p.name}</span>
                    <b>{this.votes[p.id] ? 'voted' : '…'}</b>
                  </div>
                ))}
              </div>
            </>
          )}
          {this.phase === 'cat' && catP && (
            <div class="bt-catreveal pop-in">
              <div class="bt-panel-title">The cat was…</div>
              <div class="bt-catwho">
                <div class="bt-catart">
                  <Cat />
                </div>
                <div class="bt-catname" style={{ '--pc': colorHex(catP.color) }}>
                  <Pierogi color={colorHex(catP.color)} size={90} mood="wow" />
                  {catP.name}!
                </div>
              </div>
              <div class="bt-votes">
                {players.map((p) => (
                  <span style={{ '--pc': colorHex(p.color) }}>
                    {p.name}: {voteCount(p.id)} 🗳️
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div class="bt-board">
          {players
            .slice()
            .sort((a, b) => (this.scores[b.id] ?? 0) - (this.scores[a.id] ?? 0))
            .map((p) => (
              <div class="bt-row" style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={28} />
                <span>{p.name}</span>
                <b>{(this.scores[p.id] ?? 0).toLocaleString('en-US')}</b>
              </div>
            ))}
        </div>
      </div>
    );
  }
}
