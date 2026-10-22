/** Zgodni: three pierogi agreeing under one sign, and the Pink Cow off to one side. */
export function Icon({ size }: { size: number }) {
  const pierogi = (x: number, y: number, c: string) => (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-13 0 A13 13 0 0 1 13 0 Z" fill={c} stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <circle cx="-4" cy="-5.5" r="2" fill="#2a120a" />
      <circle cx="4" cy="-5.5" r="2" fill="#2a120a" />
    </g>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M4 70 Q50 58 96 70 V74 Q96 96 74 96 H26 Q4 96 4 74 Z" fill="#5e9a3e" />
      <path d="M18 40 L30 22 L40 34 L52 16 L66 36" fill="none" stroke="#8d8f99" stroke-width="4" stroke-linejoin="round" opacity=".7" />
      <rect x="31" y="34" width="4" height="30" fill="#7a4e2a" />
      <rect x="16" y="28" width="34" height="14" rx="3" fill="#fbf0d9" stroke="#2a120a" stroke-width="2.5" />
      <path d="M22 35 H44" stroke="#2a120a" stroke-width="3" stroke-linecap="round" />
      {pierogi(22, 76, '#ff3d6e')}
      {pierogi(44, 78, '#ffd23f')}
      {pierogi(33, 86, '#4f9dff')}
      <g transform="translate(74 70) scale(0.78)">
        <CowShape />
      </g>
    </svg>
  );
}

function CowShape() {
  return (
    <>
      <rect x="-20" y="-12" width="30" height="18" rx="5" fill="#ff8fc8" stroke="#2a120a" stroke-width="3" />
      <circle cx="-10" cy="-5" r="4" fill="#e0559c" />
      <circle cx="2" cy="1" r="3" fill="#e0559c" />
      <rect x="-17" y="4" width="5" height="10" fill="#ff8fc8" stroke="#2a120a" stroke-width="2.5" />
      <rect x="3" y="4" width="5" height="10" fill="#ff8fc8" stroke="#2a120a" stroke-width="2.5" />
      <rect x="6" y="-22" width="17" height="17" rx="5" fill="#ff8fc8" stroke="#2a120a" stroke-width="3" />
      <rect x="9" y="-12" width="15" height="9" rx="4" fill="#ffc2df" stroke="#2a120a" stroke-width="2.5" />
      <path d="M8 -22 l-3 -6 M21 -22 l3 -6" stroke="#fff4dc" stroke-width="3" stroke-linecap="round" />
      <circle cx="11" cy="-16" r="1.8" fill="#2a120a" />
      <circle cx="18" cy="-16" r="1.8" fill="#2a120a" />
      <path d="M11 -2 l-3 7 h7 z" fill="#e3b341" stroke="#2a120a" stroke-width="2" stroke-linejoin="round" />
    </>
  );
}

/** Różowa Krowa, the Pink Cow, for the TV badge and the score chips. */
export function CowIcon({ size }: { size: number }) {
  return (
    <svg class="herd-cow-icon" width={size} height={size} viewBox="-26 -32 52 50" aria-hidden="true">
      <CowShape />
    </svg>
  );
}
