import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOODLE_SPACE, MAX_DOODLE_POINTS, type Stroke } from '../shared/protocol';
import { nearestColor, strokesToSvg, svgToStrokes } from '../shared/svgStrokes';
import { BOT_ID, Telephone, seating } from '../client/src/games/telephone/logic';
import { cleanLine, extractSvg, readAiRequest, runAi } from '../worker/ai';

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

describe('the bot looking at a drawing', () => {
  const env = { DEEPSEEK_API_KEY: 'test' };
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const strokes: Stroke[] = [[0, 1, 100, 100, 900, 900]];

  /** A fake DeepSeek: `answer(model, hasImage)` returns an HTTP status or a reply. */
  function fake(answer: (model: string, hasImage: boolean) => number | string) {
    const calls: { model: string; hasImage: boolean }[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { model: string; messages: { content: unknown }[] };
      const hasImage = Array.isArray(body.messages[1].content);
      calls.push({ model: body.model, hasImage });
      const a = answer(body.model, hasImage);
      if (typeof a === 'number') return new Response('{}', { status: a });
      return new Response(JSON.stringify({ choices: [{ message: { content: a } }] }), { status: 200 });
    });
    return calls;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('sends the picture to a vision model, trying the next id if one is unknown', async () => {
    const calls = fake((model) => (model === 'deepseek-v4-flash-vision-exp' ? '"A diagonal line."' : 400));
    expect(await runAi(env, { task: 'describe', strokes, image, code: 'ABCD', key: 'k' })).toEqual({ text: 'A diagonal line' });
    expect(calls.map((c) => c.model)).toEqual(['deepseek-flash', 'deepseek-v4-flash-vision-exp']);
    expect(calls.every((c) => c.hasImage)).toBe(true);
    // The id that worked is used first from now on.
    calls.length = 0;
    await runAi(env, { task: 'describe', strokes, image, code: 'ABCD', key: 'k' });
    expect(calls.map((c) => c.model)).toEqual(['deepseek-v4-flash-vision-exp']);
  });

  it('falls back to reading the strokes as SVG when no vision model answers', async () => {
    const calls = fake((_m, hasImage) => (hasImage ? 404 : 'A stick'));
    expect(await runAi({ ...env, DEEPSEEK_VISION_MODEL: 'nope' }, { task: 'describe', strokes, image, code: 'ABCD', key: 'k' })).toEqual({ text: 'A stick' });
    expect(calls.at(-1)).toEqual({ model: 'deepseek-chat', hasImage: false });
  });

  it('only accepts small PNG/JPEG data URLs from the TV', async () => {
    const req = (img: string) =>
      readAiRequest(new Request('http://x/api/ai', { method: 'POST', body: JSON.stringify({ code: 'ABCD', key: 'k', task: 'describe', strokes, image: img }) }));
    const has = async (img: string) => {
      const r = await req(img);
      return r === null ? null : 'image' in r;
    };
    expect(await has(image)).toBe(true);
    expect(await has('https://elsewhere.example/x.png')).toBe(false);
    // Too big a picture is dropped (the strokes still go through)…
    expect(await has(`data:image/png;base64,${'A'.repeat(120_000)}`)).toBe(false);
    // …and too big a request is refused.
    expect(await has(`data:image/png;base64,${'A'.repeat(200_000)}`)).toBe(null);
  });
});
