/**
 * The AI bot's brain: the TV posts a task to /api/ai, and this calls DeepSeek with the worker's
 * secret key (set with `npx wrangler secret put DEEPSEEK_API_KEY`). The bot looks at a drawing with
 * a DeepSeek vision model (the TV sends it as a small picture); if no vision model answers, it reads
 * the drawing as SVG text instead. It draws by writing SVG that becomes doodle strokes.
 */
import { DOODLE_COLORS, type AiRequest, type AiResponse, type Stroke } from '../shared/protocol';
import { strokesToSvg, svgToStrokes } from '../shared/svgStrokes';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';
/**
 * Vision models to try, in order (DEEPSEEK_VISION_MODEL first if set). DeepSeek has used more than
 * one id for its image-reading model, so the first that answers is remembered and used from then on.
 */
const VISION_MODELS = ['deepseek-flash', 'deepseek-v4-flash-vision-exp'];
let visionModel: string | null = null;
/** Longest sentence or guess (the game cuts at 60 characters too). */
const MAX_TEXT = 60;
/** Largest request accepted from the TV: a drawing (~25 KB of JSON at most) plus its picture (≤ 80 KB). */
const MAX_BODY = 160 * 1024;
const MAX_IMAGE = 100_000;
const IMAGE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

export interface AiEnv {
  DEEPSEEK_API_KEY?: string;
  /** Optional: another DeepSeek model id. */
  DEEPSEEK_MODEL?: string;
  /** Optional: the DeepSeek model that reads pictures (tried before the built-in guesses). */
  DEEPSEEK_VISION_MODEL?: string;
}

export function aiEnabled(env: AiEnv): boolean {
  return !!env.DEEPSEEK_API_KEY;
}

/** Things to write about, so the bot's opening sentences don't all sound alike. */
const THEMES = [
  'animals', 'food', 'Polish grandmas', 'sports', 'space', 'the sea', 'a wedding', 'the weather', 'a castle', 'vehicles',
  'music', 'a farm', 'a supermarket', 'ghosts', 'robots', 'a school', 'the mountains', 'a birthday', 'dinosaurs', 'pierogi',
];

type Content = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`DeepSeek answered ${status}`);
  }
}

async function chat(
  env: AiEnv,
  system: string,
  user: Content,
  opts: { maxTokens: number; temperature: number; timeoutMs: number; model?: string },
): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      signal: ctl.signal,
      headers: { authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: opts.model || env.DEEPSEEK_MODEL || DEFAULT_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        stream: false,
      }),
    });
    if (!res.ok) throw new HttpError(res.status);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

/** One short line from a model answer: no code fences, quotes or "Caption:" prefixes. */
export function cleanLine(raw: string): string {
  const line =
    raw
      .replace(/```[\s\S]*?```/g, ' ')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  return line
    .replace(/^(caption|guess|answer|sentence)\s*:\s*/i, '')
    .replace(/^["'“”‘’«»]+|["'“”‘’«».]+$/g, '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT)
    .trim();
}

/** The <svg>…</svg> in a model answer, or ''. */
export function extractSvg(raw: string): string {
  const m = raw.match(/<svg[\s\S]*?<\/svg>/i);
  return m ? m[0] : '';
}

const GAME =
  'You are a cheerful player in a party game like "Telephone Pictionary" (Głuchy Telefon). ' +
  'Players take turns writing a sentence, drawing the previous sentence, and describing the previous drawing.';

async function write(env: AiEnv): Promise<AiResponse> {
  const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
  const out = await chat(
    env,
    GAME,
    `Write ONE short, silly, concrete sentence (4 to 8 words) for the next player to draw. Something about ${theme}. ` +
      'It must be drawable and funny. Reply with the sentence only.',
    { maxTokens: 60, temperature: 1.3, timeoutMs: 20_000 },
  );
  const text = cleanLine(out);
  return text ? { text } : { error: 'empty' };
}

const LOOK =
  'This is the drawing you were handed. Guess what sentence the artist was drawing. ' +
  'Reply with your guess only: a short caption of 3 to 8 words, no quotes.';

/** Look at the picture with a vision model. '' if none of them would take it. */
async function look(env: AiEnv, image: string): Promise<string> {
  const models = [...new Set([visionModel, env.DEEPSEEK_VISION_MODEL, ...VISION_MODELS].filter((m): m is string => !!m))];
  for (const model of models) {
    try {
      const out = await chat(
        env,
        GAME,
        [
          { type: 'image_url', image_url: { url: image } },
          { type: 'text', text: LOOK },
        ],
        { model, maxTokens: 60, temperature: 0.7, timeoutMs: 25_000 },
      );
      visionModel = model;
      return cleanLine(out);
    } catch (e) {
      // A model that doesn't exist or won't take images says 400/404/422: try the next one.
      // Anything else (timeout, 401, 429, 5xx) won't get better with another model name.
      if (!(e instanceof HttpError) || ![400, 404, 422].includes(e.status)) throw e;
      if (visionModel === model) visionModel = null;
    }
  }
  return '';
}

async function describe(env: AiEnv, strokes: Stroke[], image?: string): Promise<AiResponse> {
  if (!strokes.length) return { error: 'blank' };
  if (image) {
    try {
      const text = await look(env, image);
      if (text) return { text };
    } catch {
      // Fall back to reading the strokes.
    }
  }
  const svg = strokesToSvg(strokes);
  const out = await chat(
    env,
    GAME,
    'Here is the drawing you were handed, as SVG. The canvas is 1000×1000, y goes down, and every polyline is one pen stroke ' +
      'with its pen colour. Work out what it shows (look at the shapes, their positions and colours), then guess what ' +
      'sentence the artist was drawing. Reply with your guess only: a short caption of 3 to 8 words, no quotes.\n\n' +
      svg,
    { maxTokens: 60, temperature: 0.8, timeoutMs: 28_000 },
  );
  const text = cleanLine(out);
  return text ? { text } : { error: 'empty' };
}

async function draw(env: AiEnv, prompt: string): Promise<AiResponse> {
  const palette = DOODLE_COLORS.join(', ');
  const out = await chat(
    env,
    GAME +
      ' When you draw, you answer with one SVG doodle and nothing else. Rules: viewBox="0 0 1000 1000"; ' +
      'use only <path>, <polyline>, <line>, <circle>, <ellipse> and <rect>; everything is a pen line (fill="none"); ' +
      `stroke colours only from this palette: ${palette}; stroke-width 10, 24 or 48; ` +
      'no <text>, no letters or numbers, no transform attributes, no gradients; at most 40 elements. ' +
      'Draw it like a quick, recognisable cartoon that fills most of the canvas.',
    `Draw this: “${prompt}”`,
    { maxTokens: 3500, temperature: 0.7, timeoutMs: 60_000 },
  );
  const svg = extractSvg(out);
  const strokes = svg ? svgToStrokes(svg) : [];
  return strokes.length ? { strokes, svg } : { error: 'no drawing' };
}

/** Run one task. Never throws: failures come back as { error }. */
export async function runAi(env: AiEnv, req: AiRequest): Promise<AiResponse> {
  try {
    if (req.task === 'write') return await write(env);
    if (req.task === 'describe') return await describe(env, Array.isArray(req.strokes) ? req.strokes : [], req.image);
    if (req.task === 'draw') return await draw(env, cleanLine(String(req.prompt ?? '')) || 'anything you like');
    return { error: 'bad task' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed' };
  }
}

/** Read and check the TV's request body. */
export async function readAiRequest(request: Request): Promise<AiRequest | null> {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try {
    const body = JSON.parse(text) as AiRequest;
    if (typeof body?.code !== 'string' || typeof body.key !== 'string') return null;
    if (body.task !== 'write' && body.task !== 'draw' && body.task !== 'describe') return null;
    if (body.task === 'describe') {
      if (!isStrokes(body.strokes)) return null;
      if (body.image !== undefined && (typeof body.image !== 'string' || body.image.length > MAX_IMAGE || !IMAGE_RE.test(body.image))) delete body.image;
    }
    return body;
  } catch {
    return null;
  }
}

function isStrokes(x: unknown): x is Stroke[] {
  return Array.isArray(x) && x.every((s) => Array.isArray(s) && s.every((n) => typeof n === 'number' && Number.isFinite(n)));
}
