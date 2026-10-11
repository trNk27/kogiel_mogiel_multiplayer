/**
 * Maluch Rallye Premium on the phone, before the race: the VIP drives the menus (Grand Prix or
 * Tracks, then which one), and everybody picks a car and says they're ready. During the race the
 * phone is Maluch Rally's thumb pad (see rally.tsx).
 */
import { KARTS, PREMIUM_CUPS, PREMIUM_TRACKS, colorHex, kartInfo, premiumTrack } from '../../../shared/protocol';
import { KartArt, StatBars, kartIndex } from '../games/premium/karts';
import { Pierogi } from '../lib/art';
import type { Props } from './views';
import './premium.css';

const HARD = ['pass', 'snake', 'crown'];

function Header({ sub }: { sub?: string }) {
  return (
    <div class="pp-head">
      <span class="pp-logo">
        Maluch Rallye <i>Premium</i>
      </span>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function PremiumPad({ view, me, send }: Props<'premium'>) {
  const color = colorHex(me.color);
  if (view.phase === 'karts') {
    const k = kartInfo(view.kart);
    const i = kartIndex(view.kart);
    const pick = (n: number) => !view.ready && send({ t: 'prem', a: 'kart', i: (n + KARTS.length) % KARTS.length });
    return (
      <div class="pv pv-prem" style={{ '--me': color, '--paint': color }}>
        <Header sub={view.event} />
        <div class="pp-kart">
          <button class="pp-arrow" disabled={view.ready} onClick={() => pick(i - 1)} aria-label="Previous car">
            ◀
          </button>
          <div class="pp-kart-art" key={k.id}>
            <KartArt kart={k.id} color={color} size={230} />
          </div>
          <button class="pp-arrow" disabled={view.ready} onClick={() => pick(i + 1)} aria-label="Next car">
            ▶
          </button>
        </div>
        <div class="pp-kart-name">{k.name}</div>
        <div class="pp-kart-blurb">{k.blurb}</div>
        <div class="pp-thumbs">
          {KARTS.map((x, n) => (
            <button class={`pp-thumb ${x.id === view.kart ? 'on' : ''}`} disabled={view.ready} onClick={() => pick(n)}>
              <KartArt kart={x.id} color={x.id === view.kart ? color : '#8a7d80'} size={64} />
            </button>
          ))}
        </div>
        <StatBars stats={k.stats} class="pp-stats" />
        <div class="pp-bottom">
          <button class={`btn btn-big ${view.ready ? 'btn-ghost' : 'btn-yolk'} pp-ready`} onClick={() => send({ t: 'prem', a: 'ready', on: !view.ready })}>
            {view.ready ? 'Change car' : 'Ready!'}
          </button>
          <div class="muted small center">
            {view.readyCount} / {view.total} ready
          </div>
          {view.vip && (
            <div class="pp-vip-row">
              <button class="btn btn-ghost" onClick={() => send({ t: 'prem', a: 'back' })}>
                ← Back
              </button>
              {view.readyCount < view.total && (
                <button class="btn btn-ghost" onClick={() => send({ t: 'prem', a: 'go' })}>
                  Start now
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!view.vip) {
    return (
      <div class="pv pv-prem pv-center">
        <Header />
        <Pierogi color={color} size={150} class="bob" />
        <div class="phone-big">{view.vipName || 'The VIP'} is choosing</div>
        <div class="muted">{view.phase === 'title' ? 'Grand Prix or a single track?' : view.phase === 'cups' ? 'Which Grand Prix?' : 'Which track?'} · 📺</div>
      </div>
    );
  }

  if (view.phase === 'title') {
    return (
      <div class="pv pv-prem">
        <Header sub="👑 You pick" />
        <div class="pp-modes">
          <button class="pp-mode" onClick={() => send({ t: 'prem', a: 'mode', i: 0 })}>
            <span class="pp-mode-icon">🏆</span>
            <b>Grand Prix</b>
            <small>Three tracks in a row · cup points</small>
          </button>
          <button class="pp-mode" onClick={() => send({ t: 'prem', a: 'mode', i: 1 })}>
            <span class="pp-mode-icon">🏁</span>
            <b>Tracks</b>
            <small>One race on any of {PREMIUM_TRACKS.length} tracks</small>
          </button>
        </div>
      </div>
    );
  }

  const cups = view.phase === 'cups';
  const tap = (i: number) => send({ t: 'prem', a: i === view.cursor ? 'go' : 'hover', i });
  const chosen = cups ? PREMIUM_CUPS[view.cursor]?.name : PREMIUM_TRACKS[view.cursor]?.name;
  return (
    <div class="pv pv-prem">
      <div class="pp-bar">
        <button class="btn btn-ghost pp-back" onClick={() => send({ t: 'prem', a: 'back' })}>
          ←
        </button>
        <Header sub={cups ? 'Pick a Grand Prix' : 'Pick a track'} />
      </div>
      <div class="pp-list">
        {cups
          ? PREMIUM_CUPS.map((c, i) => (
              <button class={`pp-item ${i === view.cursor ? 'on' : ''}`} style={{ '--cup': c.color }} onClick={() => tap(i)}>
                <span class="pp-dot" />
                <span class="grow">
                  <b>{c.name}</b>
                  <small>{c.tracks.map((t) => premiumTrack(t).name).join(' · ')}</small>
                </span>
              </button>
            ))
          : PREMIUM_TRACKS.map((t, i) => {
              const cup = PREMIUM_CUPS.find((c) => c.tracks.includes(t.id));
              return (
                <button class={`pp-item ${i === view.cursor ? 'on' : ''}`} style={{ '--cup': cup?.color ?? '#fff' }} onClick={() => tap(i)}>
                  <span class="pp-dot" />
                  <span class="grow">
                    <b>{t.name}</b>
                    <small>{t.hint}</small>
                  </span>
                  {HARD.includes(t.shape) && <span class="pp-hard">Hard</span>}
                </button>
              );
            })}
      </div>
      <div class="pp-bottom">
        <button class="btn btn-big btn-yolk pp-ready" onClick={() => send({ t: 'prem', a: 'go' })}>
          Race {chosen}!
        </button>
      </div>
    </div>
  );
}
