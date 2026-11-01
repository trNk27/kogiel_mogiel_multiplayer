/** Śladami Babci: a trail of red berries round a triangle in the snow, and pierogi footprints following it. */
export function Icon({ size }: { size: number }) {
  const berries = [
    [50, 18],
    [43, 30],
    [36, 42],
    [29, 54],
    [22, 66],
    [17, 76],
    [30, 76],
    [43, 76],
    [57, 76],
    [70, 76],
    [83, 76],
    [78, 66],
    [71, 54],
    [64, 42],
    [57, 30],
  ];
  const steps = [
    [26, 70],
    [33, 58],
    [40, 47],
    [46, 36],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <ellipse cx="50" cy="56" rx="42" ry="38" fill="#eef4fb" />
      {berries.map(([x, y], k) => (
        <circle cx={x} cy={y} r="4.2" fill="#d8321f" stroke="#2a120a" stroke-width="1.5" key={k} />
      ))}
      {steps.map(([x, y], k) => (
        <ellipse cx={x + 3} cy={y + 2} rx="3.4" ry="2.4" fill="#4f9dff" stroke="#2a120a" stroke-width="1.3" key={k} />
      ))}
      <path d="M34 34 a8 8 0 0 1 16 0 Z" fill="#4f9dff" stroke="#2a120a" stroke-width="2.5" stroke-linejoin="round" />
      <circle cx="39" cy="30" r="1.6" fill="#2a120a" />
      <circle cx="45" cy="30" r="1.6" fill="#2a120a" />
    </svg>
  );
}
