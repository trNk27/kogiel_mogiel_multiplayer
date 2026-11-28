/**
 * The street for Spacer z Bają, drawn in SVG: a winter evening on an osiedle street with a pet shop. The
 * camera pans along it while the group walks and Baja trots past the other way. Every anomaly is a small
 * change somewhere in here.
 */
import type { JSX } from "preact";
import { BajaRun } from "../baja/art";
import { Pierogi } from "../../lib/art";
import { GROUP_X, STREET_W, type AnomalyId } from "./logic";

export const VIEW = 1920;
export const LONG_EXTRA = 700;
const SIDEWALK = 760;

/** How high the reveal ring sits for each anomaly: Baja and things on the pavement are low down. */
const RING_Y: Partial<Record<AnomalyId, number>> = {
  withYou: 900,
  backwards: 900,
  huge: 820,
  twoBajas: 900,
  hindLegs: 860,
  blackBaja: 900,
  sitting: 880,
  glowEyes: 900,
  briefcase: 900,
  skyLeash: 700,
  catShadow: 960,
  noBaja: 900,
  ballWave: 900,
  puddleCat: 960,
  kibble: 820,
  bigPigeon: 700,
  benchWatcher: 740,
  carCreeps: 680,
  tramBack: 640,
  lightsOut: 420,
  extraLamp: 460,
};

/** Where the reveal ring sits (low for Baja and the pavement). */
export function ringY(a: AnomalyId | null) {
  return (a && RING_Y[a]) || 560;
}

export function streetWidth(a: AnomalyId | null) {
  return STREET_W + (a === "longStreet" ? LONG_EXTRA : 0);
}

/** How long a walk takes (the long street takes longer). */
export function walkMs(base: number, a: AnomalyId | null) {
  return Math.round((base * streetWidth(a)) / STREET_W);
}

export interface Walker {
  color: string;
  name: string;
}

export interface StreetProps {
  anomaly: AnomalyId | null;
  /** 'walk' pans the camera over `ms`; 'still' parks it over `focus` (world x). */
  mode: "walk" | "still";
  ms: number;
  focus?: number;
  level: number;
  walkers: Walker[];
  /** Restarts the animations. */
  runKey: string | number;
  /** Highlight ring at the focus point (the reveal). */
  ring?: string | null;
}

export function Street(p: StreetProps) {
  const a = p.anomaly;
  const W = streetWidth(a);
  const X = (x: number) =>
    x + (a === "longStreet" && x >= 1200 ? LONG_EXTRA : 0);
  const pan = W - VIEW;
  const camera: JSX.CSSProperties =
    p.mode === "walk"
      ? {
          width: `${W}px`,
          "--to": `${-pan}px`,
          animation: `sp-pan ${p.ms}ms linear forwards`,
        }
      : {
          width: `${W}px`,
          transform: `translateX(${-Math.max(0, Math.min(pan, X(p.focus ?? 0) - VIEW / 2))}px)`,
          transition: "transform 1.2s cubic-bezier(.3,.8,.3,1)",
        };
  // When the camera passes a world x (for lights going out behind you).
  const passAt = (x: number) =>
    Math.max(0, ((X(x) - GROUP_X + 60) / pan) * p.ms);
  const walking = p.mode === "walk";
  return (
    <div class={`sp-view ${walking ? "walking" : ""}`} key={p.runKey}>
      <div class="sp-sky" />
      <div class="sp-world" style={camera}>
        <svg
          width={W}
          height={1080}
          viewBox={`0 0 ${W} 1080`}
          class="sp-svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="sp-walk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#6f6a78" />
              <stop offset="1" stop-color="#4a4552" />
            </linearGradient>
            <linearGradient id="sp-shade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="rgba(255,255,255,.06)" />
              <stop offset="1" stop-color="rgba(0,0,0,.28)" />
            </linearGradient>
            <radialGradient id="sp-glow">
              <stop offset="0" stop-color="rgba(255,214,140,.55)" />
              <stop offset="1" stop-color="rgba(255,214,140,0)" />
            </radialGradient>
          </defs>
          {/* Back road and pavement. */}
          <rect x="0" y="640" width={W} height="120" fill="#2f2b36" />
          <path
            d={`M0 700 H${W}`}
            stroke="#c9c2b6"
            stroke-width="4"
            stroke-dasharray="40 40"
            opacity=".5"
          />
          <rect
            x="0"
            y={SIDEWALK}
            width={W}
            height={1080 - SIDEWALK}
            fill="url(#sp-walk)"
          />
          <rect x="0" y={SIDEWALK} width={W} height="14" fill="#8d8796" />
          {Array.from({ length: Math.ceil(W / 160) }, (_, i) => (
            <path
              d={`M${i * 160} ${SIDEWALK + 14} l-60 306`}
              stroke="rgba(0,0,0,.18)"
              stroke-width="3"
            />
          ))}
          {/* Snow along the kerb. */}
          <path
            d={`M0 ${SIDEWALK + 4} ${Array.from({ length: Math.ceil(W / 90) }, (_, i) => `Q${i * 90 + 45} ${SIDEWALK - 14} ${i * 90 + 90} ${SIDEWALK + 4}`).join(" ")}`}
            fill="#f4f6fb"
          />

          <Building
            x={X(0)}
            w={680}
            color="#8a4b3b"
            number="6"
            floors={3}
            open={a === "windowsOpen"}
          />
          <Wall
            x={X(680)}
            w={520}
            text={a === "graffiti" ? "WRÓĆ" : "KOGIEL ♥ MOGIEL"}
            warn={a === "graffiti"}
          />
          {a === "longStreet" && (
            <Wall x={1200} w={LONG_EXTRA} text="KOGIEL ♥ MOGIEL" />
          )}
          <Building
            x={X(1200)}
            w={500}
            color="#c99a3e"
            floors={3}
            open={a === "windowsOpen"}
          />
          <PetShop
            x={X(1700)}
            typo={a === "signTypo"}
            fishStare={a === "fishStare"}
            posterEyes={a === "posterEyes"}
            ms={p.ms}
            walking={walking}
          />
          <Building
            x={X(2420)}
            w={580}
            color="#5a6c8a"
            number={a === "houseSeven" ? "7" : "8"}
            floors={3}
            open={a === "windowsOpen"}
          />
          <Building
            x={X(3000)}
            w={W - X(3000)}
            color="#6b4a6e"
            floors={3}
            open={a === "windowsOpen"}
            exit={p.level}
          />

          <Tram back={a === "tramBack"} W={W} ms={p.ms} walking={walking} />
          <g
            class={a === "carCreeps" && walking ? "sp-creep" : ""}
            style={{ "--ms": `${p.ms}ms` }}
          >
            <Car x={X(2780)} />
          </g>

          <Bench
            x={X(1250)}
            bigPigeon={a === "bigPigeon"}
            watcher={a === "benchWatcher"}
          />
          <Puddle x={X(1560)} cat={a === "puddleCat"} />
          <Kibble x={X(2300)} refill={a === "kibble"} />
          <Hydrant x={X(3150)} />

          {[250, 850, 1450, 2050, 2650, 3250].map((x) => (
            <Lamp
              x={X(x)}
              out={a === "lightsOut"}
              delay={walking ? passAt(x) : 0}
              key={x}
            />
          ))}
          {a === "extraLamp" && <Lamp x={X(1150)} />}
          {a === "longStreet" && <Lamp x={1450} />}

          {p.ring && p.focus !== undefined && (
            <g class="sp-ring">
              <circle
                cx={X(p.focus)}
                cy={ringY(a)}
                r="210"
                fill="none"
                stroke="#ffd23f"
                stroke-width="10"
                stroke-dasharray="26 16"
              />
            </g>
          )}
        </svg>
        <BajaLayer a={a} W={W} ms={p.ms} walking={walking} X={X} />
        {a === "sitting" && <BajaSitting x={X(1500)} />}
      </div>
      <Snow mode={a === "snowUp" ? "up" : a === "snowHalf" ? "half" : "down"} />
      {a === "ballWave" && <BallWave ms={p.ms} still={!walking} />}
      <div class="sp-group" style={{ left: `${GROUP_X - 140}px` }}>
        {p.walkers.map((w, i) => (
          <div
            class={`sp-walker ${walking ? "go" : ""}`}
            style={{
              left: `${(i % 6) * 52 + (i >= 6 ? 26 : 0)}px`,
              bottom: `${i >= 6 ? 0 : 40}px`,
              animationDelay: `${i * 0.11}s`,
            }}
            key={i}
          >
            <Pierogi color={w.color} size={74} mood="happy" />
          </div>
        ))}
      </div>
      {p.ring && (
        <div class="sp-ring-label pop-in" key={p.ring}>
          {p.ring}
        </div>
      )}
    </div>
  );
}

// ---- buildings -----------------------------------------------------------------

function Windows({
  x,
  w,
  floors,
  open,
}: {
  x: number;
  w: number;
  floors: number;
  open?: boolean;
}) {
  const cols = Math.max(2, Math.floor((w - 60) / 110));
  const gap = (w - 60) / cols;
  const out: JSX.Element[] = [];
  for (let f = 0; f < floors; f++)
    for (let c = 0; c < cols; c++) {
      const wx = x + 30 + c * gap + (gap - 70) / 2;
      const wy = 170 + f * 110;
      const lit = (c * 3 + f * 5 + Math.floor(x)) % 4 !== 0;
      out.push(
        open ? (
          <g key={`${f}-${c}`}>
            <rect x={wx} y={wy} width="70" height="84" fill="#120d18" />
            <path
              d={`M${wx} ${wy} l-26 10 v74 l26 -10 Z M${wx + 70} ${wy} l26 10 v74 l-26 -10 Z`}
              fill="#d8e3ef"
              stroke="#3a3040"
              stroke-width="3"
            />
            <path
              d={`M${wx + 10} ${wy + 6} q16 30 -6 70`}
              stroke="#f3e9c6"
              stroke-width="10"
              fill="none"
              opacity=".85"
            />
          </g>
        ) : (
          <g key={`${f}-${c}`}>
            <rect
              x={wx}
              y={wy}
              width="70"
              height="84"
              fill={lit ? "#ffd27a" : "#2b2433"}
              stroke="#3a3040"
              stroke-width="5"
            />
            {lit && (
              <path
                d={`M${wx + 4} ${wy + 4} h22 q-6 40 0 76 h-22 Z M${wx + 66} ${wy + 4} h-22 q6 40 0 76 h22 Z`}
                fill="#e66b4f"
                opacity=".75"
              />
            )}
            <path
              d={`M${wx + 35} ${wy} v84 M${wx} ${wy + 42} h70`}
              stroke="#3a3040"
              stroke-width="4"
            />
            <rect x={wx - 6} y={wy + 82} width="82" height="8" fill="#eef2f8" />
          </g>
        ),
      );
    }
  return <>{out}</>;
}

function Building({
  x,
  w,
  color,
  number,
  floors,
  open,
  exit,
}: {
  x: number;
  w: number;
  color: string;
  number?: string;
  floors: number;
  open?: boolean;
  exit?: number;
}) {
  return (
    <g>
      <rect x={x} y="120" width={w} height="520" fill={color} />
      <rect x={x} y="120" width={w} height="520" fill="url(#sp-shade)" />
      <rect x={x - 6} y="108" width={w + 12} height="22" fill="#3a3040" />
      <path
        d={`M${x - 6} 108 h${w + 12} q-${w / 2} -18 -${w + 12} 0`}
        fill="#f4f6fb"
      />
      <rect x={x} y="120" width="6" height="520" fill="rgba(0,0,0,.18)" />
      <Windows x={x} w={w} floors={floors} open={open} />
      {/* Ground floor: a door. */}
      <rect
        x={x + w / 2 - 50}
        y="500"
        width="100"
        height="140"
        fill="#3a2a26"
      />
      <rect
        x={x + w / 2 - 50}
        y="500"
        width="100"
        height="140"
        fill="none"
        stroke="#2a1d1a"
        stroke-width="6"
      />
      <circle cx={x + w / 2 + 30} cy="575" r="6" fill="#ffd23f" />
      {number && (
        <g>
          <rect
            x={x + w / 2 + 70}
            y="510"
            width="70"
            height="56"
            rx="8"
            fill="#1e4fa3"
            stroke="#fff"
            stroke-width="4"
          />
          <text
            x={x + w / 2 + 105}
            y="551"
            text-anchor="middle"
            font-size="38"
            font-weight="900"
            fill="#fff"
            font-family="system-ui, sans-serif"
          >
            {number}
          </text>
        </g>
      )}
      {exit !== undefined && (
        <g>
          <rect
            x={x + 60}
            y="470"
            width="230"
            height="86"
            rx="10"
            fill="#1f8a4c"
            stroke="#d8ffe4"
            stroke-width="5"
          />
          <text
            x={x + 175}
            y="508"
            text-anchor="middle"
            font-size="30"
            font-weight="900"
            fill="#fff"
            font-family="system-ui, sans-serif"
          >
            WYJŚCIE
          </text>
          <text
            x={x + 175}
            y="546"
            text-anchor="middle"
            font-size="34"
            font-weight="900"
            fill="#ffd23f"
            font-family="system-ui, sans-serif"
          >
            → {exit}
          </text>
        </g>
      )}
    </g>
  );
}

function Wall({
  x,
  w,
  text,
  warn,
}: {
  x: number;
  w: number;
  text: string;
  warn?: boolean;
}) {
  return (
    <g>
      {/* Bare trees behind a low concrete wall. */}
      {[0.25, 0.7].map((f) => (
        <g
          stroke="#3b2c2a"
          stroke-width="10"
          stroke-linecap="round"
          fill="none"
          key={f}
        >
          <path
            d={`M${x + w * f} 640 V300 M${x + w * f} 400 l-60 -70 M${x + w * f} 360 l50 -80 M${x + w * f - 30} 365 l-20 -40`}
          />
        </g>
      ))}
      <rect x={x} y="440" width={w} height="200" fill="#8e8a92" />
      <rect x={x} y="430" width={w} height="16" fill="#f4f6fb" />
      {Array.from({ length: Math.floor(w / 130) }, (_, i) => (
        <path
          d={`M${x + 130 * (i + 1)} 446 V640`}
          stroke="rgba(0,0,0,.15)"
          stroke-width="4"
        />
      ))}
      <text
        x={x + w / 2}
        y="560"
        text-anchor="middle"
        font-size={warn ? 110 : 62}
        font-weight="900"
        fill={warn ? "#e8233b" : "#ff5c8a"}
        stroke={warn ? "#2a0c10" : "#3b1a4a"}
        stroke-width="5"
        paint-order="stroke"
        font-family="'Comic Sans MS', system-ui, sans-serif"
        transform={`rotate(-4 ${x + w / 2} 560)`}
      >
        {text}
      </text>
    </g>
  );
}

function PetShop({
  x,
  typo,
  fishStare,
  posterEyes,
  ms,
  walking,
}: {
  x: number;
  typo: boolean;
  fishStare: boolean;
  posterEyes: boolean;
  ms: number;
  walking: boolean;
}) {
  const w = 720;
  return (
    <g>
      <rect x={x} y="120" width={w} height="520" fill="#2f6f6a" />
      <rect x={x - 6} y="108" width={w + 12} height="22" fill="#3a3040" />
      <path
        d={`M${x - 6} 108 h${w + 12} q-${w / 2} -18 -${w + 12} 0`}
        fill="#f4f6fb"
      />
      <Windows x={x} w={w} floors={2} />
      {/* Sign. */}
      <rect
        x={x + 60}
        y="390"
        width={w - 120}
        height="74"
        rx="12"
        fill="#fbf0d9"
        stroke="#1d3d3a"
        stroke-width="6"
      />
      <text
        x={x + w / 2}
        y="442"
        text-anchor="middle"
        font-size="46"
        font-weight="900"
        fill="#1d3d3a"
        font-family="system-ui, sans-serif"
        letter-spacing="3"
      >
        {typo ? "ZOOLOGINCZY 🐾" : "ZOOLOGICZNY 🐾"}
      </text>
      {/* Poster on the pillar. */}
      <g>
        <rect
          x={x + 20}
          y="490"
          width="100"
          height="130"
          fill="#fff8e8"
          stroke="#c9bfa8"
          stroke-width="3"
        />
        <text
          x={x + 70}
          y="512"
          text-anchor="middle"
          font-size="16"
          font-weight="900"
          fill="#c0392b"
          font-family="system-ui, sans-serif"
        >
          SZCZENIAKI!
        </text>
        <circle cx={x + 70} cy="560" r="34" fill="#e8913a" />
        <path
          d={`M${x + 42} 536 l-6 -22 l20 12 Z M${x + 98} 536 l6 -22 l-20 12 Z`}
          fill="#c56a22"
        />
        <ellipse cx={x + 70} cy="574" rx="16" ry="12" fill="#fff4e0" />
        <circle cx={x + 58} cy="552" r="8" fill="#fff" />
        <circle cx={x + 82} cy="552" r="8" fill="#fff" />
        <g
          class={posterEyes && walking ? "sp-follow" : ""}
          style={{ "--ms": `${ms}ms` }}
        >
          <circle
            cx={x + (posterEyes ? 62 : 58)}
            cy="553"
            r="4.5"
            fill="#1a0905"
          />
          <circle
            cx={x + (posterEyes ? 86 : 82)}
            cy="553"
            r="4.5"
            fill="#1a0905"
          />
        </g>
        <circle cx={x + 70} cy="568" r="4" fill="#1a0905" />
      </g>
      {/* Shop window with an aquarium. */}
      <rect
        x={x + 150}
        y="480"
        width="400"
        height="160"
        fill="#173b4f"
        stroke="#1d3d3a"
        stroke-width="8"
      />
      <rect
        x={x + 180}
        y="500"
        width="250"
        height="120"
        fill="#4fb3d9"
        opacity=".85"
      />
      <path
        d={`M${x + 180} 520 q60 -10 125 0 t125 0`}
        stroke="#bff0ff"
        stroke-width="4"
        fill="none"
      />
      {[0, 1, 2, 3].map((k) =>
        fishStare ? (
          <g key={k}>
            <circle
              cx={x + 215 + k * 58}
              cy={560 + (k % 2) * 26}
              r="18"
              fill={["#ff8c2b", "#ffd23f", "#ff5c8a", "#9be15d"][k]}
            />
            <circle
              cx={x + 208 + k * 58}
              cy={556 + (k % 2) * 26}
              r="6"
              fill="#fff"
            />
            <circle
              cx={x + 222 + k * 58}
              cy={556 + (k % 2) * 26}
              r="6"
              fill="#fff"
            />
            <circle
              cx={x + 208 + k * 58}
              cy={557 + (k % 2) * 26}
              r="3"
              fill="#111"
            />
            <circle
              cx={x + 222 + k * 58}
              cy={557 + (k % 2) * 26}
              r="3"
              fill="#111"
            />
            <ellipse
              cx={x + 215 + k * 58}
              cy={570 + (k % 2) * 26}
              rx="5"
              ry="3"
              fill="#7a1d1d"
            />
          </g>
        ) : (
          <g class="sp-fish" style={{ animationDelay: `${k * 0.7}s` }} key={k}>
            <ellipse
              cx={x + 215 + k * 58}
              cy={560 + (k % 2) * 26}
              rx="20"
              ry="11"
              fill={["#ff8c2b", "#ffd23f", "#ff5c8a", "#9be15d"][k]}
            />
            <path
              d={`M${x + 195 + k * 58} ${560 + (k % 2) * 26} l-14 -10 v20 Z`}
              fill={["#ff8c2b", "#ffd23f", "#ff5c8a", "#9be15d"][k]}
            />
            <circle
              cx={x + 226 + k * 58}
              cy={557 + (k % 2) * 26}
              r="3"
              fill="#111"
            />
          </g>
        ),
      )}
      {/* A cat tree and bags of food in the rest of the window. */}
      <rect x={x + 450} y="560" width="70" height="80" fill="#c99a3e" />
      <rect x={x + 456} y="520" width="56" height="44" fill="#e56b4f" />
      <text
        x={x + 484}
        y="548"
        text-anchor="middle"
        font-size="22"
        fill="#fff"
        font-weight="900"
        font-family="system-ui"
      >
        🦴
      </text>
      <rect x={x + 580} y="490" width="100" height="150" fill="#3a2a26" />
      <rect
        x={x + 592}
        y="502"
        width="76"
        height="70"
        fill="#ffd27a"
        opacity=".8"
      />
      <text
        x={x + 630}
        y="610"
        text-anchor="middle"
        font-size="18"
        font-weight="900"
        fill="#ffd23f"
        font-family="system-ui"
      >
        OTWARTE
      </text>
    </g>
  );
}

// ---- street furniture ------------------------------------------------------------

function Lamp({
  x,
  out,
  delay = 0,
}: {
  x: number;
  out?: boolean;
  delay?: number;
}) {
  return (
    <g>
      <rect
        x={x - 7}
        y="300"
        width="14"
        height={SIDEWALK - 290}
        fill="#2a2530"
      />
      <path
        d={`M${x} 300 q0 -40 44 -40`}
        stroke="#2a2530"
        stroke-width="12"
        fill="none"
      />
      <path d={`M${x + 30} 258 h40 l-8 24 h-24 Z`} fill="#2a2530" />
      <g
        class={out ? "sp-lamp-out" : ""}
        style={{ animationDelay: `${delay}ms` }}
      >
        <ellipse cx={x + 50} cy="290" rx="16" ry="8" fill="#fff2c4" />
        <path
          d={`M${x + 34} 286 L${x - 80} ${SIDEWALK + 200} H${x + 180} L${x + 66} 286 Z`}
          fill="url(#sp-glow)"
          opacity=".55"
        />
      </g>
      <rect x={x - 14} y={SIDEWALK - 4} width="28" height="12" fill="#2a2530" />
    </g>
  );
}

function Bench({
  x,
  bigPigeon,
  watcher,
}: {
  x: number;
  bigPigeon: boolean;
  watcher: boolean;
}) {
  const y = SIDEWALK + 50;
  return (
    <g>
      <rect x={x} y={y - 70} width="190" height="16" rx="4" fill="#8a5a34" />
      <rect x={x} y={y - 48} width="190" height="16" rx="4" fill="#8a5a34" />
      <rect
        x={x - 4}
        y={y - 16}
        width="198"
        height="18"
        rx="4"
        fill="#a66c3e"
      />
      <path
        d={`M${x + 14} ${y} v40 M${x + 176} ${y} v40`}
        stroke="#2a2530"
        stroke-width="10"
      />
      {/* A pierogi reading the paper (or watching you). */}
      <g transform={`translate(${x + 30} ${y - 104})`}>
        <path
          d="M6 70 A50 50 0 0 1 106 70 Q56 86 6 70 Z"
          fill="#f2d49b"
          stroke="#7a5a2a"
          stroke-width="4"
        />
        {watcher ? (
          <g class="sp-watch">
            <circle cx="40" cy="54" r="11" fill="#fff" />
            <circle cx="70" cy="54" r="11" fill="#fff" />
            <circle cx="42" cy="56" r="6" fill="#111" />
            <circle cx="72" cy="56" r="6" fill="#111" />
            <path
              d="M44 72 h22"
              stroke="#111"
              stroke-width="4"
              stroke-linecap="round"
            />
          </g>
        ) : (
          <g>
            <rect
              x="34"
              y="34"
              width="74"
              height="50"
              fill="#f4f1ea"
              stroke="#9a948a"
              stroke-width="2"
              transform="rotate(8 70 60)"
            />
            <path
              d="M44 48 h50 M44 58 h44 M44 68 h50"
              stroke="#9a948a"
              stroke-width="3"
              transform="rotate(8 70 60)"
            />
          </g>
        )}
      </g>
      {/* Pigeon on the back of the bench. */}
      <g
        transform={`translate(${x + 150} ${y - 72}) scale(${bigPigeon ? 3.4 : 1})`}
      >
        <ellipse cx="0" cy="-14" rx="18" ry="13" fill="#8e95a3" />
        <circle cx="14" cy="-28" r="9" fill="#7d8492" />
        <path d="M22 -28 l8 3 l-8 3 Z" fill="#e8a33a" />
        <circle cx="16" cy="-30" r="2" fill="#111" />
        <path
          d="M-6 -24 q8 6 14 2"
          stroke="#5f9e86"
          stroke-width="3"
          fill="none"
        />
        <path d="M-18 -10 l-10 6" stroke="#6b7280" stroke-width="5" />
      </g>
    </g>
  );
}

function Puddle({ x, cat }: { x: number; cat: boolean }) {
  const y = 990;
  return (
    <g>
      <ellipse cx={x} cy={y} rx="110" ry="26" fill="#3d4a66" />
      <ellipse
        cx={x}
        cy={y}
        rx="110"
        ry="26"
        fill="none"
        stroke="#9fb3d1"
        stroke-width="3"
        opacity=".6"
      />
      {cat ? (
        <g>
          <ellipse cx={x} cy={y + 2} rx="30" ry="14" fill="#1b1f2b" />
          <path
            d={`M${x - 26} ${y - 6} l6 -14 l8 10 Z M${x + 26} ${y - 6} l-6 -14 l-8 10 Z`}
            fill="#1b1f2b"
          />
          <ellipse cx={x - 10} cy={y} rx="5" ry="3" fill="#d6f25f" />
          <ellipse cx={x + 10} cy={y} rx="5" ry="3" fill="#d6f25f" />
        </g>
      ) : (
        <ellipse
          cx={x + 30}
          cy={y - 6}
          rx="24"
          ry="5"
          fill="#fff2c4"
          opacity=".5"
        />
      )}
    </g>
  );
}

function Kibble({ x, refill }: { x: number; refill: boolean }) {
  const y = SIDEWALK + 70;
  return (
    <g>
      <path d={`M${x - 40} ${y - 26} h80 l-10 26 h-60 Z`} fill="#d63a3a" />
      <text
        x={x}
        y={y - 6}
        text-anchor="middle"
        font-size="16"
        font-weight="900"
        fill="#fff"
        font-family="system-ui"
      >
        BAJA
      </text>
      <g class={refill ? "sp-refill" : ""}>
        <ellipse cx={x} cy={y - 28} rx="38" ry="10" fill="#8a5225" />
        {refill && (
          <path d={`M${x - 36} ${y - 30} q36 -50 72 0 Z`} fill="#8a5225" />
        )}
      </g>
    </g>
  );
}

function Hydrant({ x }: { x: number }) {
  const y = SIDEWALK + 30;
  return (
    <g>
      <rect
        x={x - 16}
        y={y - 70}
        width="32"
        height="74"
        rx="8"
        fill="#d63a3a"
      />
      <rect
        x={x - 26}
        y={y - 50}
        width="52"
        height="14"
        rx="6"
        fill="#b52e2e"
      />
      <path d={`M${x - 20} ${y - 70} q20 -24 40 0 Z`} fill="#b52e2e" />
      <path d={`M${x - 22} ${y - 72} q22 -30 44 0`} fill="#f4f6fb" />
    </g>
  );
}

function Car({ x }: { x: number }) {
  const y = 740;
  return (
    <g>
      <path
        d={`M${x} ${y - 30} q0 -36 40 -40 l50 -40 h120 l50 40 q50 4 50 40 v24 h-310 Z`}
        fill="#2f7fbf"
      />
      <path
        d={`M${x + 100} ${y - 70} l36 -30 h50 v30 Z M${x + 196} ${y - 70} v-30 h40 l36 30 Z`}
        fill="#bfe3ff"
      />
      <path
        d={`M${x + 90} ${y - 104} q90 -22 182 0`}
        stroke="#f4f6fb"
        stroke-width="14"
        fill="none"
        stroke-linecap="round"
      />
      <circle cx={x + 70} cy={y - 4} r="26" fill="#1a1a1a" />
      <circle cx={x + 250} cy={y - 4} r="26" fill="#1a1a1a" />
      <circle cx={x + 70} cy={y - 4} r="10" fill="#9aa" />
      <circle cx={x + 250} cy={y - 4} r="10" fill="#9aa" />
      <rect x={x + 300} y={y - 40} width="14" height="10" fill="#ffd27a" />
    </g>
  );
}

function Tram({
  back,
  W,
  ms,
  walking,
}: {
  back: boolean;
  W: number;
  ms: number;
  walking: boolean;
}) {
  return (
    <g
      class={walking ? (back ? "sp-tram back" : "sp-tram") : "sp-tram-parked"}
      style={{ "--ms": `${ms}ms`, "--w": `${W}px` }}
    >
      <g transform={back ? "translate(560 0) scale(-1 1)" : ""}>
        <rect x="0" y="560" width="520" height="140" rx="22" fill="#e8b53a" />
        <rect x="0" y="640" width="520" height="34" fill="#c0392b" />
        {[0, 1, 2, 3, 4].map((k) => (
          <rect
            x={30 + k * 96}
            y="578"
            width="70"
            height="50"
            rx="6"
            fill="#ffe8a8"
            stroke="#7a5a20"
            stroke-width="3"
            key={k}
          />
        ))}
        {/* The driver's end, at the front. */}
        <path d="M0 582 q-10 40 0 100 h-6 v-100 Z" fill="#9fd3f0" />
        <rect x="6" y="582" width="24" height="46" fill="#9fd3f0" />
        <path
          d="M200 560 l40 -40 h40 l40 40"
          stroke="#2a2530"
          stroke-width="6"
          fill="none"
        />
        <circle cx="90" cy="704" r="14" fill="#2a2530" />
        <circle cx="430" cy="704" r="14" fill="#2a2530" />
      </g>
    </g>
  );
}

// ---- Baja ----------------------------------------------------------------------

function BajaLayer({
  a,
  W,
  ms,
  walking,
  X,
}: {
  a: AnomalyId | null;
  W: number;
  ms: number;
  walking: boolean;
  X: (x: number) => number;
}) {
  if (a === "noBaja" || a === "sitting") return null;
  const size = a === "huge" ? 420 : 210;
  const h = size * 0.7;
  const y = 1060 - h;
  const pan = W - VIEW;
  // Normally Baja trots from the far end towards you; "with you" keeps pace beside the group.
  const from = a === "withYou" ? GROUP_X + 200 : X(2300);
  const to = a === "withYou" ? GROUP_X + 200 + pan : X(500);
  const facingLeft = a !== "backwards" && a !== "withYou";
  const style: JSX.CSSProperties = walking
    ? {
        "--from": `${from}px`,
        "--to": `${to}px`,
        animation: `sp-baja ${ms}ms linear forwards`,
        top: `${y}px`,
      }
    : { transform: `translateX(${X(1500) - 105}px)`, top: `${y}px` };
  const one = (extra = 0) => (
    <div
      class={`sp-baja-body ${a === "hindLegs" ? "upright" : ""} ${a === "blackBaja" ? "black" : ""}`}
      style={{ left: `${extra}px` }}
    >
      <div class="sp-shadow">
        {a === "catShadow" ? (
          <CatShadow size={size} />
        ) : (
          <span class="sp-shadow-blob" />
        )}
      </div>
      <div style={{ transform: facingLeft ? "scaleX(-1)" : undefined }}>
        <BajaRun size={size} />
        {a === "glowEyes" && (
          <span
            class="sp-glow-eye"
            style={{
              left: `${(212 / 260) * size - 12}px`,
              top: `${(70 / 182) * h - 12}px`,
            }}
          />
        )}
        {a === "briefcase" && (
          <Briefcase left={(236 / 260) * size - 10} top={(112 / 182) * h} />
        )}
        {a === "skyLeash" && (
          <span
            class="sp-leash"
            style={{
              left: `${(170 / 260) * size}px`,
              top: `${-1000 + (80 / 182) * h}px`,
            }}
          />
        )}
      </div>
    </div>
  );
  return (
    <div class="sp-baja" style={style}>
      {one()}
      {a === "twoBajas" && one(240)}
    </div>
  );
}

function BajaSitting({ x }: { x: number }) {
  // Sat on the pavement, facing out at the group.
  return (
    <div
      class="sp-baja sitting"
      style={{ transform: `translateX(${x - 110}px)`, top: "760px" }}
    >
      <svg width="220" height="240" viewBox="0 0 220 240" aria-hidden="true">
        <ellipse cx="110" cy="226" rx="80" ry="12" fill="rgba(0,0,0,.25)" />
        <path d="M40 220 Q30 130 110 120 Q190 130 180 220 Z" fill="#e8913a" />
        <path d="M80 220 Q110 160 140 220 Z" fill="#fff4e0" />
        <circle cx="110" cy="90" r="64" fill="#e8913a" />
        <path
          d="M60 60 L52 6 L94 40 Z M160 60 L168 6 L126 40 Z"
          fill="#e8913a"
          stroke="#c56a22"
          stroke-width="3"
        />
        <ellipse cx="110" cy="112" rx="34" ry="28" fill="#fff4e0" />
        <circle cx="86" cy="84" r="10" fill="#1a0905" />
        <circle cx="134" cy="84" r="10" fill="#1a0905" />
        <circle cx="89" cy="80" r="3" fill="#fff" />
        <circle cx="137" cy="80" r="3" fill="#fff" />
        <ellipse cx="110" cy="104" rx="10" ry="7" fill="#2a120a" />
        <path d="M110 112 v10" stroke="#2a120a" stroke-width="3" />
      </svg>
    </div>
  );
}

function CatShadow({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size * 0.3}
      viewBox="0 0 260 80"
      aria-hidden="true"
    >
      <path
        d="M30 60 q0 -26 60 -28 h70 q14 -20 30 -22 l6 -14 l8 14 l8 -14 l4 16 q14 10 6 26 q-10 18 -40 18 h-120 q-20 30 -50 10 q24 0 18 -16 Z"
        fill="rgba(0,0,0,.45)"
      />
    </svg>
  );
}

function Briefcase({ left, top }: { left: number; top: number }) {
  return (
    <svg
      class="sp-briefcase"
      style={{ left: `${left}px`, top: `${top}px` }}
      width="56"
      height="46"
      viewBox="0 0 56 46"
      aria-hidden="true"
    >
      <path
        d="M20 10 v-6 h16 v6"
        stroke="#3a2416"
        stroke-width="5"
        fill="none"
      />
      <rect
        x="2"
        y="10"
        width="52"
        height="34"
        rx="5"
        fill="#6b3f22"
        stroke="#3a2416"
        stroke-width="3"
      />
      <rect x="24" y="22" width="8" height="8" fill="#ffd23f" />
    </svg>
  );
}

// ---- weather and the ball wave -----------------------------------------------------

function Snow({ mode }: { mode: "down" | "up" | "half" }) {
  return (
    <div class={`sp-snow ${mode}`} aria-hidden="true">
      {Array.from({ length: 70 }, (_, i) => {
        const left = ((i * 137) % 100) * (mode === "half" ? 0.48 : 1);
        return (
          <span
            style={{
              left: `${left}%`,
              animationDelay: `${-((i * 0.37) % 6)}s`,
              animationDuration: `${5 + (i % 5)}s`,
              width: `${6 + (i % 3) * 3}px`,
              height: `${6 + (i % 3) * 3}px`,
            }}
            key={i}
          />
        );
      })}
    </div>
  );
}

function BallWave({ ms, still }: { ms: number; still: boolean }) {
  return (
    <div
      class={`sp-balls ${still ? "still" : ""}`}
      style={{ "--ms": `${ms}ms` }}
      aria-hidden="true"
    >
      {Array.from({ length: 40 }, (_, i) => (
        <span
          style={{
            left: `${(i % 10) * 60}px`,
            bottom: `${Math.floor(i / 10) * 52 + (i % 3) * 8}px`,
            animationDelay: `${(i % 7) * 0.05}s`,
          }}
          key={i}
        />
      ))}
    </div>
  );
}
