/**
 * Pure math helpers for virtual joystick — no Phaser dependency, fully testable.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Convert a drag (originX/Y → pointerX/Y) inside a circle of `radius` px
 * into a normalised Vec2 with magnitude clamped to [0, 1].
 */
export function normaliseJoystick(
  originX: number,
  originY: number,
  pointerX: number,
  pointerY: number,
  radius: number
): Vec2 {
  const dx = pointerX - originX;
  const dy = pointerY - originY;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { x: 0, y: 0 };
  const mag = Math.min(dist / radius, 1);
  return { x: (dx / dist) * mag, y: (dy / dist) * mag };
}

/**
 * Apply a dead zone: return 0 if |value| <= threshold, otherwise return value.
 */
export function deadZone(value: number, threshold: number): number {
  return Math.abs(value) <= threshold ? 0 : value;
}
