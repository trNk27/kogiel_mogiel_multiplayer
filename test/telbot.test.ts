import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOODLE_SPACE, MAX_DOODLE_POINTS, type Stroke } from '../shared/protocol';
import { nearestColor, strokesToSvg, svgToStrokes } from '../shared/svgStrokes';
import { TEL_MAX_BOTS, Telephone, botIds, botName, isBot, seating } from '../client/src/games/telephone/logic';
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

describe('bots in Głuchy Telefon', () => {
  it('seats 0 to 4 bots with their own ids and names', () => {
    expect(botIds(0)).toEqual([]);
    expect(botIds(2)).toEqual(['bot:1', 'bot:2']);
    expect(botIds(99)).toHaveLength(TEL_MAX_BOTS);
    expect(botIds(-1)).toEqual([]);
    expect(new Set(botIds(4).map(botName)).size).toBe(4);
    expect(botIds(4).every(isBot)).toBe(true);
    expect(isBot('Ab3dEf9h')).toBe(false);
  });

  it('bots play every step but never vote', () => {
    const bots = botIds(4);
    const seats = seating(['a', 'b', 'c'], Math.random, bots);
    const t = new Telephone(seats, false, bots);
    expect(t.n).toBe(7);
    expect(t.steps).toBe(6);
    while (!t.done) {
      for (const id of bots) expect(t.pending()).toContain(id);
      for (const id of t.pending()) {
        expect(t.kind === 'draw' ? t.submit(id, { strokes: [[0, 1, 1, 1]] }) : t.submit(id, { text: `hi from ${id}` })).toBe(true);
      }
      t.endStep();
    }
    for (let c = 0; c < t.n; c++) for (const id of bots) expect(t.canVote(c, id)).toBe(false);
    expect(t.pendingVoters(0).sort()).toEqual(['a', 'b', 'c']);
    // Players can vote for a bot's entry.
    const chain = seats.indexOf('bot:1');
    const i = t.chains[chain].findIndex((e) => e.by === 'bot:1');
    expect(t.vote(chain, 'a', i)).toBe(true);
    expect(t.scores()['bot:1']).toBe(100);
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
  const env = { ANTHROPIC_API_KEY: 'test' };
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const strokes: Stroke[] = [[0, 1, 100, 100, 900, 900]];

  type Sent = { model: string; content: string | { type: string; source?: { media_type: string; data: string }; text?: string }[] };

  /** A fake Claude API: records each request and answers with `reply`. */
  function fake(reply: (sent: Sent) => { content: unknown[]; stop_reason?: string } | number) {
    const calls: Sent[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body) as { model: string; messages: { content: Sent['content'] }[] };
      const sent = { model: body.model, content: body.messages[0].content };
      calls.push(sent);
      const r = reply(sent);
      if (typeof r === 'number') return new Response('{"type":"error","error":{"type":"x","message":"x"}}', { status: r });
      const msg = { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', usage: {}, ...r };
      return new Response(JSON.stringify(msg), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    return calls;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('shows Claude Haiku the picture and keeps only the text of its answer', async () => {
    const calls = fake(() => ({ content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: '"A diagonal line."' }] }));
    expect(await runAi(env, { task: 'describe', strokes, image, code: 'ABCD', key: 'k' })).toEqual({ text: 'A diagonal line' });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('claude-haiku-5-5');
    const blocks = calls[0].content as Exclude<Sent['content'], string>;
    expect(blocks[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png', data: 'iVBORw0KGgo=' } });
  });

  it('reads the strokes as SVG when the TV sent no picture', async () => {
    const calls = fake(() => ({ content: [{ type: 'text', text: 'A stick' }] }));
    expect(await runAi(env, { task: 'describe', strokes, code: 'ABCD', key: 'k' })).toEqual({ text: 'A stick' });
    expect(calls[0].content).toEqual(expect.stringContaining('<polyline'));
    expect(calls[0].content).toEqual(expect.stringContaining('rubbed-out'));
  });

  it('turns a refusal or a failed call into an error', async () => {
    fake(() => ({ content: [], stop_reason: 'refusal' }));
    expect(await runAi(env, { task: 'write', code: 'ABCD', key: 'k' })).toEqual({ error: 'refused' });
    fake(() => 400);
    expect((await runAi(env, { task: 'write', code: 'ABCD', key: 'k' })).error).toBeTruthy();
  });

  it('draws with an SVG that becomes strokes', async () => {
    fake(() => ({ content: [{ type: 'text', text: '<svg viewBox="0 0 1000 1000"><circle cx="500" cy="500" r="200" stroke="#ffd23f" stroke-width="24"/></svg>' }] }));
    const res = await runAi(env, { task: 'draw', prompt: 'the sun', code: 'ABCD', key: 'k' });
    expect(res.strokes).toHaveLength(1);
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
