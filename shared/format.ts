/** Format a number for display: years without separators, otherwise grouped with up to 3 decimals. */
export function formatNumber(n: number, unit = ''): string {
  if (unit === 'year') return String(n);
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}
