/** Hand-made SVG art: pierogi avatars, folk paper-cut (wycinanki) rosettes, the kogiel mogiel logo. */
import type { JSX } from 'preact';

function pierogiPath(): string {
  const cx = 60;
  const cy = 66;
  const R = 50;
  const N = 11;
  const pt = (a: number, r: number) => `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy - r * Math.sin(a)).toFixed(1)}`;
  let d = `M ${pt(Math.PI, R)}`;
  for (let k = 0; k < N; k++) {
    const a0 = Math.PI - (k * Math.PI) / N;
    const a1 = Math.PI - ((k + 1) * Math.PI) / N;
    d += ` Q ${pt((a0 + a1) / 2, R + 8)} ${pt(a1, R)}`;
  }
  d += ` Q ${cx} ${cy + 22} ${pt(Math.PI, R)} Z`;
  return d;
}
const PIEROGI = pierogiPath();

interface PierogiProps {
  color: string;
  size?: number;
  mood?: 'happy' | 'dead' | 'wow' | 'sleep';
  class?: string;
  style?: JSX.CSSProperties;
}

/** A cute pierogi in the player's colour. */
export function Pierogi({ color, size = 64, mood = 'happy', class: cls, style }: PierogiProps) {
  return (
    <svg class={cls} style={style} width={size} height={size * 0.8} viewBox="0 0 120 96" aria-hidden="true">
      <path d={PIEROGI} fill={color} stroke="rgba(40,16,8,.55)" stroke-width="3" stroke-linejoin="round" />
      <path d="M 18 64 A 42 42 0 0 1 102 64" fill="none" stroke="rgba(40,16,8,.22)" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round" />
      <path d="M 12 70 Q 60 92 108 70 Q 60 84 12 70 Z" fill="rgba(40,16,8,.14)" />
      {mood === 'dead' ? (
        <g stroke="#2a120a" stroke-width="3.5" stroke-linecap="round">
          <path d="M 38 46 l 10 10 M 48 46 l -10 10 M 72 46 l 10 10 M 82 46 l -10 10" />
          <path d="M 50 70 q 10 -6 20 0" fill="none" />
        </g>
      ) : mood === 'sleep' ? (
        <g stroke="#2a120a" stroke-width="3.5" stroke-linecap="round" fill="none">
          <path d="M 37 53 q 6 5 12 0 M 71 53 q 6 5 12 0" />
          <path d="M 54 68 q 6 3 12 0" />
        </g>
      ) : (
        <g>
          <ellipse cx="43" cy="51" rx="5.5" ry={mood === 'wow' ? 7.5 : 6.5} fill="#2a120a" />
          <ellipse cx="77" cy="51" rx="5.5" ry={mood === 'wow' ? 7.5 : 6.5} fill="#2a120a" />
          <circle cx="45" cy="48.5" r="2" fill="#fff" />
          <circle cx="79" cy="48.5" r="2" fill="#fff" />
          {mood === 'wow' ? (
            <ellipse cx="60" cy="68" rx="6" ry="7" fill="#2a120a" />
          ) : (
            <path d="M 50 64 q 10 10 20 0" fill="none" stroke="#2a120a" stroke-width="3.5" stroke-linecap="round" />
          )}
          <ellipse cx="32" cy="62" rx="6" ry="3.5" fill="#ff5a7a" opacity=".45" />
          <ellipse cx="88" cy="62" rx="6" ry="3.5" fill="#ff5a7a" opacity=".45" />
        </g>
      )}
    </svg>
  );
}

interface RosetteProps {
  size?: number;
  petals?: string;
  inner?: string;
  center?: string;
  leaves?: string;
  class?: string;
  style?: JSX.CSSProperties;
}

/** A folk paper-cut style flower. */
export function Rosette({
  size = 120,
  petals = '#e8335a',
  inner = '#ffd23f',
  center = '#2fd6a8',
  leaves = '#4caf50',
  class: cls,
  style,
}: RosetteProps) {
  const p = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg class={cls} style={style} width={size} height={size} viewBox="-60 -60 120 120" aria-hidden="true">
      {p.map((a) => (
        <path key={`l${a}`} d="M 0 -30 Q 9 -46 0 -58 Q -9 -46 0 -30 Z" fill={leaves} transform={`rotate(${a + 22.5})`} />
      ))}
      {p.map((a) => (
        <ellipse key={`p${a}`} cx="0" cy="-24" rx="11" ry="19" fill={petals} transform={`rotate(${a})`} />
      ))}
      {p.map((a) => (
        <circle key={`d${a}`} cx="0" cy="-30" r="3.2" fill={inner} transform={`rotate(${a})`} />
      ))}
      <circle r="17" fill={inner} />
      <circle r="10" fill={center} />
      <circle r="4" fill={inner} />
    </svg>
  );
}

/** A glass of kogiel mogiel – the brand mark. */
export function KogielGlass({ size = 80 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 96" aria-hidden="true">
      <path d="M 14 22 L 66 22 L 58 88 Q 40 94 22 88 Z" fill="rgba(255,255,255,.18)" stroke="#fff4dc" stroke-width="3" stroke-linejoin="round" />
      <path d="M 17 34 L 63 34 L 57.5 86 Q 40 91 22.5 86 Z" fill="#ffc93c" />
      <path d="M 17 34 L 63 34 L 62 42 Q 40 48 18 42 Z" fill="#ffe08a" />
      <path d="M 22 24 Q 26 6 40 10 Q 52 2 58 18 Q 64 22 58 26 L 22 26 Q 16 24 22 24 Z" fill="#fff4dc" />
      <path d="M 30 18 Q 40 10 50 18" fill="none" stroke="#ffc93c" stroke-width="3" stroke-linecap="round" />
      <path d="M 60 4 L 52 40" stroke="#ff3d6e" stroke-width="4" stroke-linecap="round" />
      <circle cx="62" cy="2" r="4" fill="#ff3d6e" />
    </svg>
  );
}

export function Logo({ size = 1 }: { size?: number }) {
  return (
    <div class="logo" style={{ fontSize: `${size}em` }}>
      <KogielGlass size={84 * size} />
      <div class="logo-text">
        <div class="logo-small">Kogiel Mogiel</div>
        <div class="logo-big">Couch Party</div>
      </div>
    </div>
  );
}

/** A row of rosettes used as a decorative border. */
export function FolkBorder({ count = 7, size = 46 }: { count?: number; size?: number }) {
  const palettes = [
    ['#ff3d6e', '#ffd23f', '#4f9dff'],
    ['#ffd23f', '#ff3d6e', '#2fd6a8'],
    ['#b27bff', '#ffd23f', '#ff3d6e'],
  ];
  return (
    <div class="folk-border" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const [a, b, c] = palettes[i % palettes.length];
        return <Rosette key={i} size={size} petals={a} inner={b} center={c} />;
      })}
    </div>
  );
}
