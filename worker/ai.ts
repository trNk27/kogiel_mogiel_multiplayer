/**
 * The AI bot's brain: the TV posts a task to /api/ai, and this asks Claude Haiku with the worker's
 * secret key (set with `npx wrangler secret put ANTHROPIC_API_KEY`). The bot looks at a drawing as a
 * picture (the TV sends it as a small PNG/JPEG); if the TV couldn't make one, it reads the drawing as
 * SVG text instead. It draws by writing SVG that becomes doodle strokes.
 */
import Anthropic from '@anthropic-ai/sdk';
import { DOODLE_COLORS, type AiRequest, type AiResponse, type Stroke } from '../shared/protocol';
import { strokesToSvg, svgToStrokes } from '../shared/svgStrokes';

const DEFAULT_MODEL = 'claude-haiku-5-5';
/** Longest sentence or guess (the game cuts at 60 characters too). */
const MAX_TEXT = 60;
/** Largest request accepted from the TV: a drawing (~25 KB of JSON at most) plus its picture (≤ 80 KB). */
const MAX_BODY = 160 * 1024;
const MAX_IMAGE = 100_000;
const IMAGE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

export interface AiEnv {
  ANTHROPIC_API_KEY?: string;
  /** Optional: another Claude model id. */
  ANTHROPIC_MODEL?: string;
}

export function aiEnabled(env: AiEnv): boolean {
  return !!env.ANTHROPIC_API_KEY;
}

/** Things to write about, so the bot's opening sentences don't all sound alike. */
const THEMES = [
  'animals', 'food', 'Polish grandmas', 'sports', 'space', 'the sea', 'a wedding', 'the weather', 'a castle', 'vehicles',
  'music', 'a farm', 'a supermarket', 'ghosts', 'robots', 'a school', 'the mountains', 'a birthday', 'dinosaurs', 'pierogi',
];

async function chat(
  env: AiEnv,
  system: string,
  content: string | Anthropic.ContentBlockParam[],
  opts: { maxTokens: number; timeoutMs: number },
): Promise<string> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: opts.timeoutMs });
  const res = await client.messages.create({
    model: env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: opts.maxTokens,
    // A party game: answer quickly rather than think long.
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content }],
  });
  if (res.stop_reason === 'refusal') throw new Error('refused');
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
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

/** The paper colour, which is also the second pen: drawing with it rubs things out. */
const PAPER_PEN = DOODLE_COLORS[1];

async function write(env: AiEnv): Promise<AiResponse> {
  const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
  const out = await chat(
    env,
    GAME,
    `Write ONE short, silly, concrete sentence (4 to 8 words) for the next player to draw. Something about ${theme}. ` +
      'It must be drawable and funny. Reply with the sentence only.',
    { maxTokens: 1024, timeoutMs: 20_000 },
  );
  const text = cleanLine(out);
  return text ? { text } : { error: 'empty' };
}

const GUESS = 'Guess what sentence the artist was drawing. Reply with your guess only: a short caption of 3 to 8 words, no quotes.';

async function describe(env: AiEnv, strokes: Stroke[], image?: string): Promise<AiResponse> {
  if (!strokes.length) return { error: 'blank' };
  const picture = image?.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/);
  const content: string | Anthropic.ContentBlockParam[] = picture
    ? [
        { type: 'image', source: { type: 'base64', media_type: picture[1] as 'image/png' | 'image/jpeg', data: picture[2] } },
        { type: 'text', text: `This is the drawing you were handed. ${GUESS}` },
      ]
    : // No picture from the TV: read the strokes as text instead.
      'Here is the drawing you were handed, as SVG. The canvas is 1000×1000, y goes down, and every polyline is one pen stroke ' +
      `with its pen colour. The paper is ${PAPER_PEN}, so strokes in that colour are rubbed-out parts: ignore them. ` +
      `Work out what it shows (look at the shapes, their positions and colours), then: ${GUESS}\n\n` +
      strokesToSvg(strokes);
  const out = await chat(env, GAME, content, { maxTokens: 1024, timeoutMs: 28_000 });
  const text = cleanLine(out);
  return text ? { text } : { error: 'empty' };
}

async function draw(env: AiEnv, prompt: string): Promise<AiResponse> {
  const palette = DOODLE_COLORS.filter((c) => c !== PAPER_PEN).join(', ');
  const out = await chat(
    env,
    GAME +
      ' When you draw, you answer with one SVG doodle and nothing else. Rules: viewBox="0 0 1000 1000"; ' +
      `the paper is cream (${PAPER_PEN}); ` +
      'use only <path>, <polyline>, <line>, <circle>, <ellipse> and <rect>; everything is a pen line (fill="none"); ' +
      `stroke colours only from this palette: ${palette}; stroke-width 10, 24 or 48; ` +
      'no <text>, no letters or numbers, no transform attributes, no gradients; at most 40 elements. ' +
      'Draw it like a quick, recognisable cartoon that fills most of the canvas.',
    `Draw this: “${prompt}”`,
    { maxTokens: 8000, timeoutMs: 60_000 },
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
