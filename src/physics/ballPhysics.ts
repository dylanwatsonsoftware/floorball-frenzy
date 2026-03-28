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
    // Dampen tiny bounces to rest
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

  // Check goal before wall collisions
  const goal = checkGoal(ball);
  if (goal) return goal;

  // Wall collisions — top/bottom
  if (ball.y - BALL_RADIUS < FIELD_TOP) {
    ball.y = FIELD_TOP + BALL_RADIUS;
    ball.vy *= -BALL_BOUNCE;
  } else if (ball.y + BALL_RADIUS > FIELD_BOTTOM) {
    ball.y = FIELD_BOTTOM - BALL_RADIUS;
    ball.vy *= -BALL_BOUNCE;
  }

  // Wall collisions — left/right (only outside goal mouth)
  const inGoalMouth = ball.y >= GOAL_TOP && ball.y <= GOAL_BOTTOM;
  if (!inGoalMouth) {
    if (ball.x - BALL_RADIUS < FIELD_LEFT) {
      ball.x = FIELD_LEFT + BALL_RADIUS;
      ball.vx *= -BALL_BOUNCE;
    } else if (ball.x + BALL_RADIUS > FIELD_RIGHT) {
      ball.x = FIELD_RIGHT - BALL_RADIUS;
      ball.vx *= -BALL_BOUNCE;
    }
  }

  return null;
}

function checkGoal(ball: Ball): GoalEvent {
  const inGoalMouth = ball.y >= GOAL_TOP && ball.y <= GOAL_BOTTOM;
  if (!inGoalMouth) return null;
  if (ball.z >= GOAL_Z_THRESHOLD) return null;

  if (ball.x - BALL_RADIUS < FIELD_LEFT) return "host"; // client scored on host's goal
  if (ball.x + BALL_RADIUS > FIELD_RIGHT) return "client"; // host scored on client's goal
  return null;
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
 * Reset ball to center of field.
 */
export function resetBall(ball: Ball): void {
  ball.x = (FIELD_LEFT + FIELD_RIGHT) / 2;
  ball.y = (FIELD_TOP + FIELD_BOTTOM) / 2;
  ball.z = 0;
  ball.vx = 0;
  ball.vy = 0;
  ball.vz = 0;
}
