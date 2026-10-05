/** Tilt this far (degrees) for full lock. */
const TILT_FULL = 32;
const TILT_DEAD = 2.5;

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Screen rotation in degrees (0, 90, 180, 270). */
export function screenAngle() {
  const a = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return ((a % 360) + 360) % 360;
}

/**
 * Steering from gravity: hold the phone like a steering wheel (in either orientation) and turn it.
 * `accelerationIncludingGravity` points up, away from the ground (iOS reports it the other way round).
 */
export function tiltSteer(gx: number, gy: number, angle: number, ios: boolean) {
  const ux = ios ? -gx : gx;
  const uy = ios ? -gy : gy;
  const r = (angle * Math.PI) / 180;
  // Into screen coordinates (x right, y up).
  const sx = ux * Math.cos(r) - uy * Math.sin(r);
  const sy = ux * Math.sin(r) + uy * Math.cos(r);
  if (Math.hypot(sx, sy) < 2) return 0; // lying flat: no idea which way is up
  const deg = (Math.atan2(-sx, sy) * 180) / Math.PI;
  const a = Math.abs(deg);
  if (a < TILT_DEAD) return 0;
  return Math.sign(deg) * Math.min(1, (a - TILT_DEAD) / (TILT_FULL - TILT_DEAD));
}
