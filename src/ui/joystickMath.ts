export interface Vec2 {
  x: number;
  y: number;
}

export function normaliseJoystick(ox: number, oy: number, tx: number, ty: number, radius: number): Vec2 {
  const dx = tx - ox;
  const dy = ty - oy;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0.001) return { x: 0, y: 0 };

  const mag = Math.min(dist, radius) / radius;
  return {
    x: (dx / dist) * mag,
    y: (dy / dist) * mag,
  };
}

export function deadZone(v: number, threshold: number): number {
  return Math.abs(v) < threshold ? 0 : v;
}
