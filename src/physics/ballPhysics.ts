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
  GOAL_CAGE_DEPTH,
  CORNER_RADIUS,
  BOLT_FRICTION_POWER,
} from "./constants";

export type GoalEvent = "host" | "client" | null;

export interface StepBallResult {
  goal: GoalEvent;
  wallHit: boolean;
}

/**
 * Advance ball state by one timestep dt (seconds).
 * Returns goal event and wall impact flag.
 */
export function stepBall(ball: Ball, dt: number): StepBallResult {
  let wallHit = false;
  const oldX = ball.x;
  const elapsedMs = dt * 1000;
  if (ball.boltTimerMs && ball.boltTimerMs > 0) {
    ball.boltTimerMs = Math.max(0, ball.boltTimerMs - elapsedMs);
    if (ball.boltTimerMs === 0) ball.isBolt = false;
  }

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
    const friction = ball.isBolt ? Math.pow(BALL_FRICTION, BOLT_FRICTION_POWER) : BALL_FRICTION;
    ball.vx *= friction;
    ball.vy *= friction;
  }

  // Integrate horizontal position
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Goal detection (at goal line — only scores if entering through the mouth)
  const goal = checkGoal(ball, oldX);
  if (goal) return { goal, wallHit: false };

  // ── Goal cage physics ──────────────────────────────────────────────────────
  // The cage box is open at the front (goal mouth). Ball enters only through
  // the mouth. Side walls and back wall block all other entry.
  const LEFT_CAGE_BACK  = GOAL_LINE_LEFT  - GOAL_CAGE_DEPTH;
  const RIGHT_CAGE_BACK = GOAL_LINE_RIGHT + GOAL_CAGE_DEPTH;

  const inLeftCageX  = ball.x < GOAL_LINE_LEFT  && ball.x > LEFT_CAGE_BACK;
  const inRightCageX = ball.x > GOAL_LINE_RIGHT && ball.x < RIGHT_CAGE_BACK;

  // Cage side walls (top: y = GOAL_TOP, bottom: y = GOAL_BOTTOM)
  if (inLeftCageX || inRightCageX) {
    // Top wall — bounce approaching ball back above, or escaping ball back inside
    if (ball.y < GOAL_TOP && ball.y + BALL_RADIUS > GOAL_TOP && ball.vy > 0) {
      ball.y = GOAL_TOP - BALL_RADIUS;
      ball.vy = -Math.abs(ball.vy) * BALL_BOUNCE;
    } else if (ball.y > GOAL_TOP && ball.y - BALL_RADIUS < GOAL_TOP && ball.vy < 0) {
      ball.y = GOAL_TOP + BALL_RADIUS;
      ball.vy = Math.abs(ball.vy) * BALL_BOUNCE;
    }
    // Bottom wall
    if (ball.y > GOAL_BOTTOM && ball.y - BALL_RADIUS < GOAL_BOTTOM && ball.vy < 0) {
      ball.y = GOAL_BOTTOM + BALL_RADIUS;
      ball.vy = Math.abs(ball.vy) * BALL_BOUNCE;
    } else if (ball.y < GOAL_BOTTOM && ball.y + BALL_RADIUS > GOAL_BOTTOM && ball.vy > 0) {
      ball.y = GOAL_BOTTOM - BALL_RADIUS;
      ball.vy = -Math.abs(ball.vy) * BALL_BOUNCE;
    }
  }

  // Cage back walls — prevent ball entering cage from the open space behind goal
  const inGoalMouthY = ball.y + BALL_RADIUS > GOAL_TOP && ball.y - BALL_RADIUS < GOAL_BOTTOM;
  if (inGoalMouthY) {
    if (ball.x < LEFT_CAGE_BACK && ball.x + BALL_RADIUS > LEFT_CAGE_BACK && ball.vx > 0) {
      ball.x = LEFT_CAGE_BACK - BALL_RADIUS;
      ball.vx = -Math.abs(ball.vx) * BALL_BOUNCE;
    }
    if (ball.x > RIGHT_CAGE_BACK && ball.x - BALL_RADIUS < RIGHT_CAGE_BACK && ball.vx < 0) {
      ball.x = RIGHT_CAGE_BACK + BALL_RADIUS;
      ball.vx = Math.abs(ball.vx) * BALL_BOUNCE;
    }
  }

  // Straight wall collisions — top/bottom
  if (ball.y - BALL_RADIUS < FIELD_TOP) {
    ball.y = FIELD_TOP + BALL_RADIUS;
    const bounce = ball.lastHitterEnFuego ? 1.0 : BALL_BOUNCE;
    ball.vy = Math.abs(ball.vy) * bounce;
    if (ball.lastHitterEnFuego) {
      ball.lastHitterEnFuego = false;
      wallHit = true;
    }
  } else if (ball.y + BALL_RADIUS > FIELD_BOTTOM) {
    ball.y = FIELD_BOTTOM - BALL_RADIUS;
    const bounce = ball.lastHitterEnFuego ? 1.0 : BALL_BOUNCE;
    ball.vy = -Math.abs(ball.vy) * bounce;
    if (ball.lastHitterEnFuego) {
      ball.lastHitterEnFuego = false;
      wallHit = true;
    }
  }

  // Straight wall collisions — end walls (always bounce; goal mouth is open
  // in physics but score was already detected above)
  if (ball.x - BALL_RADIUS < FIELD_LEFT) {
    ball.x = FIELD_LEFT + BALL_RADIUS;
    const bounce = ball.lastHitterEnFuego ? 1.0 : BALL_BOUNCE;
    ball.vx = Math.abs(ball.vx) * bounce;
    if (ball.lastHitterEnFuego) {
      ball.lastHitterEnFuego = false;
      wallHit = true;
    }
  } else if (ball.x + BALL_RADIUS > FIELD_RIGHT) {
    ball.x = FIELD_RIGHT - BALL_RADIUS;
    const bounce = ball.lastHitterEnFuego ? 1.0 : BALL_BOUNCE;
    ball.vx = -Math.abs(ball.vx) * bounce;
    if (ball.lastHitterEnFuego) {
      ball.lastHitterEnFuego = false;
      wallHit = true;
    }
  }

  // Rounded corner collision — prevents ball sticking in corners
  if (resolveCorners(ball) && ball.lastHitterEnFuego) {
    ball.lastHitterEnFuego = false;
    wallHit = true;
  }

  return { goal: null, wallHit };
}

function checkGoal(ball: Ball, oldX: number): GoalEvent {
  const inMouth = ball.y >= GOAL_TOP && ball.y <= GOAL_BOTTOM;
  if (!inMouth || ball.z >= GOAL_Z_THRESHOLD) return null;

  // Only score when ball center is within the cage depth — not in the open
  // space behind the cage that the ball can reach by going around the goal.
  const LEFT_CAGE_BACK  = GOAL_LINE_LEFT  - GOAL_CAGE_DEPTH;
  const RIGHT_CAGE_BACK = GOAL_LINE_RIGHT + GOAL_CAGE_DEPTH;

  // Anti-tunneling: check if the ball crossed the goal line between oldX and ball.x
  const crossedLeftLine = (oldX >= GOAL_LINE_LEFT && ball.x < GOAL_LINE_LEFT);
  const crossedRightLine = (oldX <= GOAL_LINE_RIGHT && ball.x > GOAL_LINE_RIGHT);

  // Left goal (blue/host net): client scores
  if ((crossedLeftLine || (ball.x - BALL_RADIUS < GOAL_LINE_LEFT && ball.x > LEFT_CAGE_BACK)) && ball.vx < 0) return "client";
  // Right goal (red/client net): host scores
  if ((crossedRightLine || (ball.x + BALL_RADIUS > GOAL_LINE_RIGHT && ball.x < RIGHT_CAGE_BACK)) && ball.vx > 0) return "host";
  return null;
}

/**
 * Push the ball away from rounded corners.
 * Corner arcs have radius CORNER_RADIUS centred at the four inset corners.
 * Ball centre must stay within CORNER_RADIUS - BALL_RADIUS from each arc centre.
 * Returns true if a collision was resolved.
 */
function resolveCorners(ball: Ball): boolean {
  let hit = false;
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
      const bounce = ball.lastHitterEnFuego ? 1.0 : BALL_BOUNCE;
      ball.vx -= (1 + bounce) * outwardVel * nx;
      ball.vy -= (1 + bounce) * outwardVel * ny;
      hit = true;
    }
  }
  return hit;
}

/**
 * Apply possession assist — ball gently follows the player in control.
 */
export function applyPossessionAssist(
  ball: Ball,
  playerVx: number,
  playerVy: number
): void {
  ball.vx += (playerVx - ball.vx) * 0.15;
  ball.vy += (playerVy - ball.vy) * 0.15;
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
