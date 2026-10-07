/** Czołgi: a chunky little tank with a shell flying out of the barrel. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M10 80 L90 80 L90 92 L10 92 Z" fill="#5a3320" />
      <rect x="62" y="22" width="22" height="16" rx="3" fill="#a9743f" stroke="#2a120a" stroke-width="3" />
      <path d="M62 30 H84 M73 22 V38" stroke="#6b4524" stroke-width="3" />
      <rect x="14" y="62" width="64" height="18" rx="9" fill="#2b2523" stroke="#2a120a" stroke-width="3" />
      <circle cx="24" cy="71" r="4.5" fill="#8a8480" />
      <circle cx="40" cy="71" r="4.5" fill="#8a8480" />
      <circle cx="56" cy="71" r="4.5" fill="#8a8480" />
      <circle cx="69" cy="71" r="4.5" fill="#8a8480" />
      <rect x="18" y="48" width="56" height="18" rx="6" fill="#ff3d6e" stroke="#2a120a" stroke-width="3" />
      <rect x="26" y="34" width="34" height="18" rx="8" fill="#ff5a7a" stroke="#2a120a" stroke-width="3" />
      <rect x="54" y="38" width="30" height="7" rx="3.5" fill="#8a8480" stroke="#2a120a" stroke-width="3" />
      <circle cx="46" cy="30" r="8" fill="#ffc93c" stroke="#2a120a" stroke-width="3" />
      <circle cx="43.5" cy="29" r="1.6" fill="#2a120a" />
      <circle cx="48.5" cy="29" r="1.6" fill="#2a120a" />
      <circle cx="90" cy="41.5" r="4.5" fill="#a3e048" stroke="#2a120a" stroke-width="2.5" />
      <path d="M80 56 l5 -4 M82 62 l7 -2" stroke="#ffc93c" stroke-width="3" stroke-linecap="round" />
    </svg>
  );
}
