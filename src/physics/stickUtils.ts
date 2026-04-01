import { STICK_REACH, BALL_RADIUS, PLAYER_RADIUS } from "./constants";

/**
 * Returns the stick tip direction (unit vector) for a given aim direction.
 * The stick extends to the right-hand side of the player — 90° CCW from aim.
 * e.g. facing right (1,0) → stick points down (0,1).
 */
export function stickDir(aim: { x: number; y: number }): { x: number; y: number } {
  const len = Math.hypot(aim.x, aim.y);
  if (len === 0) return { x: 0, y: 1 };
  const nx = aim.x / len;
  const ny = aim.y / len;
  return { x: -ny, y: nx };
}

/**
 * Returns true if the ball is close enough to the player's stick tip or body
 * to allow a wrist/slap shot to connect.
 *
 * Checks two independent radii so possession is still detected if the smooth
 * aim hasn't caught up to the raw aim yet:
 *  - tip check: uses the provided aimDir (typically smoothed)
 *  - body check: always fires if ball is within player radius + ball radius + 5
 */
export function ballInRange(
  player: { x: number; y: number },
  ball: { x: number; y: number },
  aimDir: { x: number; y: number }
): boolean {
  const sd = stickDir(aimDir);
  const aimLen = Math.hypot(aimDir.x, aimDir.y) || 1;
  const fwdX = (aimDir.x / aimLen) * PLAYER_RADIUS * 0.84;
  const fwdY = (aimDir.y / aimLen) * PLAYER_RADIUS * 0.84;
  const tipX = player.x + sd.x * STICK_REACH + fwdX;
  const tipY = player.y + sd.y * STICK_REACH + fwdY;
  const distToTip  = Math.hypot(ball.x - tipX,    ball.y - tipY);
  const distToBody = Math.hypot(ball.x - player.x, ball.y - player.y);
  return distToTip < BALL_RADIUS + 30 || distToBody < PLAYER_RADIUS + BALL_RADIUS + 10;
}
