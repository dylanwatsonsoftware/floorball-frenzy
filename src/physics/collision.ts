import type { Ball } from "../types/game";
import type { PlayerExtended } from "./playerPhysics";
import {
  PLAYER_RADIUS,
  BALL_RADIUS,
  STICK_LENGTH,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FIELD_BOTTOM,
  GOAL_LINE_LEFT,
  GOAL_LINE_RIGHT,
  GOAL_TOP,
  GOAL_BOTTOM,
  GOAL_CAGE_DEPTH,
  PARRY_WINDOW_MS,
  PARRY_VELOCITY_MULTIPLIER,
  HOUSE_TOP,
  HOUSE_BOTTOM,
  HOUSE_DEPTH,
} from "./constants";

const CONTACT_DIST = PLAYER_RADIUS + BALL_RADIUS;

// How much of the player's velocity is transferred to the ball on contact.
// 0.6 feels like a solid stick push without being unrealistically bouncy.
const TRANSFER = 0.6;

// Bounciness of player-player collisions.
const PLAYER_RESTITUTION = 0.4;
// How much each px/s of approach speed adds to a player's effective mass.
// At PLAYER_MAX_SPEED (700 px/s) this gives effective mass ≈ 7× base,
// so a full-speed player barely slows while pushing a stationary opponent away.
const MASS_SCALE = 0.015;

/**
 * Resolve a collision between two players.
 * - Separates them so they no longer overlap.
 * - Applies an impulse weighted by each player's effective mass:
 *   a player pressing hard into the contact acts as a heavier body and is
 *   knocked back less, pushing the slower/lighter opponent away instead.
 */
export function resolvePlayerPlayerCollision(
  a: PlayerExtended,
  b: PlayerExtended,
  onContact?: (p1: PlayerExtended, p2: PlayerExtended) => void
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = PLAYER_RADIUS * 2;

  if (dist >= minDist) return;

  // n points from a toward b
  const nx = dist > 0 ? dx / dist : 1;
  const ny = dist > 0 ? dy / dist : 0;

  // Push each player out by half the overlap
  const push = (minDist - dist) / 2;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;

  // Clamp back inside field after separation
  a.x = Math.max(FIELD_LEFT + PLAYER_RADIUS, Math.min(FIELD_RIGHT  - PLAYER_RADIUS, a.x));
  a.y = Math.max(FIELD_TOP  + PLAYER_RADIUS, Math.min(FIELD_BOTTOM - PLAYER_RADIUS, a.y));
  b.x = Math.max(FIELD_LEFT + PLAYER_RADIUS, Math.min(FIELD_RIGHT  - PLAYER_RADIUS, b.x));
  b.y = Math.max(FIELD_TOP  + PLAYER_RADIUS, Math.min(FIELD_BOTTOM - PLAYER_RADIUS, b.y));

  // Relative velocity along normal (negative = approaching)
  const dot = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (dot >= 0) return;

  // Effective mass: boosted by how hard each player is pressing into the contact.
  // Only the component directed toward the opponent counts.
  const aPress = a.vx * nx + a.vy * ny;           // +ve = a pressing toward b
  const bPress = -(b.vx * nx + b.vy * ny);         // +ve = b pressing toward a
  const massA = 1 + Math.max(0, aPress) * MASS_SCALE;
  const massB = 1 + Math.max(0, bPress) * MASS_SCALE;

  const j = -(1 + PLAYER_RESTITUTION) * dot / (1 / massA + 1 / massB);
  a.vx -= (j / massA) * nx;
  a.vy -= (j / massA) * ny;
  b.vx += (j / massB) * nx;
  b.vy += (j / massB) * ny;

  if (onContact) onContact(a, b);
}

/**
 * Resolve a player-ball collision.
 * - Separates the ball so it no longer overlaps the player circle.
 * - Transfers the component of player velocity that pushes into the ball.
 */
export function resolvePlayerBallCollision(
  player: PlayerExtended,
  ball: Ball,
  totalTimeMs = 0
): boolean {
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const dist = Math.hypot(dx, dy);

  if (dist >= CONTACT_DIST) return false; // no overlap

  // Perfect Parry detection
  const ballSpeed = Math.hypot(ball.vx, ball.vy);
  if (totalTimeMs - player.lastDashTimeMs < PARRY_WINDOW_MS && ballSpeed > 500) {
    // Check if ball is moving towards the player (dot < 0)
    const bnx = ball.vx / ballSpeed;
    const bny = ball.vy / ballSpeed;
    const pnx = (ball.x - player.x) / dist;
    const pny = (ball.y - player.y) / dist;
    const dotBall = bnx * pnx + bny * pny;

    if (dotBall < -0.5) {
      // Parry! Invert and multiply
      ball.vx = -ball.vx * PARRY_VELOCITY_MULTIPLIER;
      ball.vy = -ball.vy * PARRY_VELOCITY_MULTIPLIER;
      ball.isPerfect = true; // Give it perfect status
      return true;
    }
  }

  // Avoid division by zero when perfectly overlapping
  const nx = dist > 0 ? dx / dist : 1;
  const ny = dist > 0 ? dy / dist : 0;

  // Push ball out to contact distance
  const overlap = CONTACT_DIST - dist;
  ball.x += nx * overlap;
  ball.y += ny * overlap;

  // Transfer velocity: only the component along the collision normal (pushing direction)
  const relVx = player.vx - ball.vx;
  const relVy = player.vy - ball.vy;
  const dot = relVx * nx + relVy * ny;

  // Only transfer if player is moving toward ball (dot > 0)
  if (dot > 0) {
    ball.vx += nx * dot * TRANSFER;
    ball.vy += ny * dot * TRANSFER;
  }
  return false;
}

/**
 * Resolve a collision between a player (circle) and a rectangle (AABB).
 */
export function resolvePlayerRectangleCollision(
  player: PlayerExtended,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): void {
  // Find the closest point on the rectangle to the player's center
  const closestX = Math.max(rx, Math.min(player.x, rx + rw));
  const closestY = Math.max(ry, Math.min(player.y, ry + rh));

  const dx = player.x - closestX;
  const dy = player.y - closestY;
  const dist = Math.hypot(dx, dy);

  if (dist >= PLAYER_RADIUS) return;

  const nx = dist > 0 ? dx / dist : 1;
  const ny = dist > 0 ? dy / dist : 0;

  // Push player out of the rectangle
  const overlap = PLAYER_RADIUS - dist;
  player.x += nx * overlap;
  player.y += ny * overlap;

  // Kill velocity component moving into the rectangle
  const dot = player.vx * nx + player.vy * ny;
  if (dot < 0) {
    player.vx -= nx * dot;
    player.vy -= ny * dot;
  }
}

/**
 * Resolve player collision with restricted environment areas (goals and houses).
 */
export function resolvePlayerEnvironment(player: PlayerExtended): void {
  // Left Goal Cage
  resolvePlayerRectangleCollision(
    player,
    GOAL_LINE_LEFT - GOAL_CAGE_DEPTH,
    GOAL_TOP,
    GOAL_CAGE_DEPTH,
    GOAL_BOTTOM - GOAL_TOP
  );

  // Right Goal Cage
  resolvePlayerRectangleCollision(
    player,
    GOAL_LINE_RIGHT,
    GOAL_TOP,
    GOAL_CAGE_DEPTH,
    GOAL_BOTTOM - GOAL_TOP
  );

  // Left House (Goalkeeper Area)
  resolvePlayerRectangleCollision(
    player,
    GOAL_LINE_LEFT,
    HOUSE_TOP,
    HOUSE_DEPTH,
    HOUSE_BOTTOM - HOUSE_TOP
  );

  // Right House (Goalkeeper Area)
  resolvePlayerRectangleCollision(
    player,
    GOAL_LINE_RIGHT - HOUSE_DEPTH,
    HOUSE_TOP,
    HOUSE_DEPTH,
    HOUSE_BOTTOM - HOUSE_TOP
  );
}

/**
 * Resolve a collision between the stick tip and the ball.
 * The stick tip is STICK_LENGTH beyond the player's edge, in the aim direction.
 * Only fires when the ball overlaps the tip circle (radius = BALL_RADIUS).
 */
export function resolveStickTipCollision(
  player: PlayerExtended,
  ball: Ball,
  aimX: number,
  aimY: number
): void {
  const aimLen = Math.hypot(aimX, aimY);
  if (aimLen === 0) return;

  const nax = aimX / aimLen;
  const nay = aimY / aimLen;

  // Stick tip position (forward offset matches visual: +0.84 * PLAYER_RADIUS in aim direction)
  const fwdX = nay * PLAYER_RADIUS * 0.84;
  const fwdY = -nax * PLAYER_RADIUS * 0.84;
  const tipX = player.x + nax * (PLAYER_RADIUS + STICK_LENGTH) + fwdX;
  const tipY = player.y + nay * (PLAYER_RADIUS + STICK_LENGTH) + fwdY;

  const dx = ball.x - tipX;
  const dy = ball.y - tipY;
  const dist = Math.hypot(dx, dy);

  if (dist >= BALL_RADIUS) return; // no contact

  const nx = dist > 0 ? dx / dist : nax;
  const ny = dist > 0 ? dy / dist : nay;

  // Separate ball from stick tip
  const overlap = BALL_RADIUS - dist;
  ball.x += nx * overlap;
  ball.y += ny * overlap;

  // Transfer player velocity along normal (same rule as body collision)
  const relVx = player.vx - ball.vx;
  const relVy = player.vy - ball.vy;
  const dot = relVx * nx + relVy * ny;
  if (dot > 0) {
    ball.vx += nx * dot * TRANSFER;
    ball.vy += ny * dot * TRANSFER;
  }
}
