import { describe, expect, it } from 'vitest';
import { DOODLE_SPACE, MAX_DOODLE_POINTS, type Stroke } from '../shared/protocol';
import { nearestColor, strokesToSvg, svgToStrokes } from '../shared/svgStrokes';
import { BOT_ID, Telephone, seating } from '../client/src/games/telephone/logic';
import { cleanLine, extractSvg } from '../worker/ai';

describe('svgToStrokes', () => {
  it('reads the basic shapes and scales the viewBox into the canvas', () => {
    const strokes = svgToStrokes(`<svg viewBox="0 0 100 100" fill="none">
      <circle cx="50" cy="50" r="20" stroke="#ffd23f" stroke-width="2.4"/>
      <line x1="0" y1="0" x2="100" y2="100" stroke="black"/>
      <rect x="10" y="10" width="20" height="10" stroke="#4f9dff"/>
      <polyline points="0,100 50,0 100,100" stroke="red"/>
    </svg>`);
    expect(strokes).toHaveLength(4);
    const [circle, line, rect, poly] = strokes;
    expect(circle[0]).toBe(3); // yolk
    expect(circle[1]).toBe(1); // 2.4 × 10 = 24
    expect(line.slice(2)).toEqual([0, 0, DOODLE_SPACE, DOODLE_SPACE]);
    expect(rect[0]).toBe(5);
    expect((rect.length - 2) / 2).toBe(5);
    expect(poly[0]).toBe(2); // red → beetroot
  });

  it('follows path commands, relative ones and curves included', () => {
    const strokes = svgToStrokes('<svg viewBox="0 0 1000 1000"><path d="M100 100 l100 0 h50 v50 Z M500 500 C 600 400 700 600 800 500 q 50 50 100 0" stroke="#2a120a"/></svg>');
    expect(strokes).toHaveLength(2);
    expect(strokes[0].slice(2)).toEqual([100, 100, 200, 100, 250, 100, 250, 150, 100, 100]);
    const end = strokes[1].slice(-2);
    expect(end).toEqual([900, 500]);
  });

  it('keeps points inside the canvas and under the limit', () => {
    const pts = Array.from({ length: 4000 }, (_, i) => `${i - 500},${i * 3}`).join(' ');
    const strokes = svgToStrokes(`<svg viewBox="0 0 1000 1000"><polyline points="${pts}"/></svg>`);
    const all = strokes.flatMap((s) => s.slice(2));
    expect(all.every((v) => v >= 0 && v <= DOODLE_SPACE)).toBe(true);
    expect(all.length / 2).toBeLessThanOrEqual(MAX_DOODLE_POINTS);
  });

  it('returns nothing for junk', () => {
    expect(svgToStrokes('no svg here')).toEqual([]);
    expect(svgToStrokes('<svg><text>hi</text></svg>')).toEqual([]);
  });

  it('maps colours to the nearest pen', () => {
    expect(nearestColor('#000')).toBe(0);
    expect(nearestColor('white')).toBe(1);
    expect(nearestColor('rgb(80, 150, 250)')).toBe(5);
    expect(nearestColor('none')).toBe(0);
  });
});

describe('strokesToSvg', () => {
  it('round-trips a drawing', () => {
    const strokes: Stroke[] = [
      [2, 0, 10, 20, 30, 40, 50, 60],
      [5, 2, 500, 500],
    ];
    const svg = strokesToSvg(strokes);
    expect(svg).toContain('<polyline stroke="#ff3d6e" stroke-width="10" points="10,20 30,40 50,60"/>');
    expect(svgToStrokes(svg)).toEqual([
      [2, 0, 10, 20, 30, 40, 50, 60],
      [5, 2, 500, 500, 500, 500],
    ]);
  });

  it('thins long drawings', () => {
    const big: Stroke = [0, 1, ...Array.from({ length: 5000 }, (_, i) => i % 1000)];
    const svg = strokesToSvg([big], 300);
    expect(svg.length).toBeLessThan(5000);
  });
});

describe('the bot in Głuchy Telefon', () => {
  it('takes a seat, plays every step but never votes', () => {
    const seats = seating(['a', 'b', 'c'], Math.random, [BOT_ID]);
    const t = new Telephone(seats, false, [BOT_ID]);
    expect(t.steps).toBe(4);
    while (!t.done) {
      expect(t.pending()).toContain(BOT_ID);
      for (const id of t.pending()) {
        expect(t.kind === 'draw' ? t.submit(id, { strokes: [[0, 1, 1, 1]] }) : t.submit(id, { text: `hi from ${id}` })).toBe(true);
      }
      t.endStep();
    }
    const botChain = seats.indexOf(BOT_ID);
    expect(t.canVote(botChain, BOT_ID)).toBe(false);
    expect(t.pendingVoters(0)).not.toContain(BOT_ID);
    // Players can vote for the bot's entries.
    const other = (botChain + 1) % 4;
    const i = t.chains[other].findIndex((e) => e.by === BOT_ID);
    const voter = t.active.find((id) => id !== BOT_ID)!;
    expect(t.vote(other, voter, i)).toBe(true);
    expect(t.scores()[BOT_ID]).toBe(100);
  });
});

describe('AI answer cleaning', () => {
  it('keeps one short line', () => {
    expect(cleanLine('"A cat riding a tram."\n\nHope that helps!')).toBe('A cat riding a tram');
    expect(cleanLine('Caption: Babcia <b>flying</b>')).toBe('Babcia bflying/b');
    expect(cleanLine('x'.repeat(100))).toHaveLength(60);
  });

  it('finds the svg in a chatty answer', () => {
    expect(extractSvg('Sure!\n```svg\n<svg viewBox="0 0 10 10"><line/></svg>\n```')).toBe('<svg viewBox="0 0 10 10"><line/></svg>');
    expect(extractSvg('nope')).toBe('');
  });
});
