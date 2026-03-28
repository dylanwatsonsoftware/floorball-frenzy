import type { Ball } from "../types/game";
import {
  GRAVITY,
  BALL_BOUNCE_Z,
  BALL_FRICTION,
  BALL_BOUNCE,
  BALL_RADIUS,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FIELD_BOTTOM,
  GOAL_TOP,
  GOAL_BOTTOM,
  GOAL_Z_THRESHOLD,
  GOAL_LINE_LEFT,
  GOAL_LINE_RIGHT,
  CORNER_RADIUS,
} from "./constants";

export type GoalEvent = "host" | "client" | null;

/**
 * Advance ball state by one timestep dt (seconds).
 * Returns which side scored ("host" | "client") or null.
 */
export function stepBall(ball: Ball, dt: number): GoalEvent {
  // Vertical (z) physics
  ball.vz -= GRAVITY * dt;
  ball.z += ball.vz * dt;
  if (ball.z <= 0) {
    ball.z = 0;
    ball.vz *= -BALL_BOUNCE_Z;
    if (Math.abs(ball.vz) < 10) ball.vz = 0;
  }

  // Horizontal friction (only when on the ground)
  if (ball.z === 0) {
    ball.vx *= BALL_FRICTION;
    ball.vy *= BALL_FRICTION;
  }

  // Integrate horizontal position
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Goal detection (at goal line, not end wall — space behind goals is live)
  const goal = checkGoal(ball);
  if (goal) return goal;

  // Straight wall collisions — top/bottom
  if (ball.y - BALL_RADIUS < FIELD_TOP) {
    ball.y = FIELD_TOP + BALL_RADIUS;
    ball.vy = Math.abs(ball.vy) * BALL_BOUNCE;
  } else if (ball.y + BALL_RADIUS > FIELD_BOTTOM) {
    ball.y = FIELD_BOTTOM - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy) * BALL_BOUNCE;
  }

  // Straight wall collisions — end walls (always bounce; goal mouth is open
  // in physics but score was already detected above)
  if (ball.x - BALL_RADIUS < FIELD_LEFT) {
    ball.x = FIELD_LEFT + BALL_RADIUS;
    ball.vx = Math.abs(ball.vx) * BALL_BOUNCE;
  } else if (ball.x + BALL_RADIUS > FIELD_RIGHT) {
    ball.x = FIELD_RIGHT - BALL_RADIUS;
    ball.vx = -Math.abs(ball.vx) * BALL_BOUNCE;
  }

  // Rounded corner collision — prevents ball sticking in corners
  resolveCorners(ball);

  return null;
}

function checkGoal(ball: Ball): GoalEvent {
  const inMouth = ball.y >= GOAL_TOP && ball.y <= GOAL_BOTTOM;
  if (!inMouth || ball.z >= GOAL_Z_THRESHOLD) return null;

  // Left goal (blue/host net): red scores
  if (ball.x - BALL_RADIUS < GOAL_LINE_LEFT && ball.vx < 0) return "client";
  // Right goal (red/client net): blue scores
  if (ball.x + BALL_RADIUS > GOAL_LINE_RIGHT && ball.vx > 0) return "host";
  return null;
}

/**
 * Push the ball away from rounded corners.
 * Corner arcs have radius CORNER_RADIUS centred at the four inset corners.
 * Ball centre must stay within CORNER_RADIUS - BALL_RADIUS from each arc centre.
 */
function resolveCorners(ball: Ball): void {
  const R = CORNER_RADIUS;
  const minDist = R - BALL_RADIUS;

  const arcCentres = [
    { cx: FIELD_LEFT  + R, cy: FIELD_TOP    + R }, // top-left
    { cx: FIELD_RIGHT - R, cy: FIELD_TOP    + R }, // top-right
    { cx: FIELD_LEFT  + R, cy: FIELD_BOTTOM - R }, // bottom-left
    { cx: FIELD_RIGHT - R, cy: FIELD_BOTTOM - R }, // bottom-right
  ];

  for (const { cx, cy } of arcCentres) {
    // Only check when ball is in the corner zone
    const inZoneX = Math.abs(ball.x - cx) < R;
    const inZoneY = Math.abs(ball.y - cy) < R;
    if (!inZoneX || !inZoneY) continue;

    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist <= minDist) continue;

    // Ball has crossed the corner arc — push it inward
    const nx = dx / dist; // outward normal
    const ny = dy / dist;

    ball.x = cx + nx * minDist;
    ball.y = cy + ny * minDist;

    // Reflect the outward velocity component with restitution
    const outwardVel = ball.vx * nx + ball.vy * ny;
    if (outwardVel > 0) {
      ball.vx -= (1 + BALL_BOUNCE) * outwardVel * nx;
      ball.vy -= (1 + BALL_BOUNCE) * outwardVel * ny;
    }
  }
}

/**
 * Apply possession assist — ball gently follows the player in control.
 */
export function applyPossessionAssist(
  ball: Ball,
  playerVx: number,
  playerVy: number
): void {
  ball.vx += (playerVx - ball.vx) * 0.1;
  ball.vy += (playerVy - ball.vy) * 0.1;
}

/**
 * Reset ball to centre of field.
 */
export function resetBall(ball: Ball): void {
  ball.x = (FIELD_LEFT + FIELD_RIGHT) / 2;
  ball.y = (FIELD_TOP + FIELD_BOTTOM) / 2;
  ball.z = 0;
  ball.vx = 0;
  ball.vy = 0;
  ball.vz = 0;
}
