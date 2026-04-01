import type { Ball } from "../types/game";
import type { PlayerExtended } from "./playerPhysics";
import { PLAYER_RADIUS, BALL_RADIUS, STICK_LENGTH, FIELD_LEFT, FIELD_RIGHT, FIELD_TOP, FIELD_BOTTOM } from "./constants";

const CONTACT_DIST = PLAYER_RADIUS + BALL_RADIUS;

// How much of the player's velocity is transferred to the ball on contact.
// 0.6 feels like a solid stick push without being unrealistically bouncy.
const TRANSFER = 0.6;

// Bounciness of player-player collisions: 0 = perfectly inelastic (stick together),
// 1 = perfectly elastic (full speed exchange). 0.4 gives a solid-feeling bump.
const PLAYER_RESTITUTION = 0.4;

/**
 * Resolve a collision between two players.
 * - Separates them so they no longer overlap.
 * - Exchanges the velocity components along the collision normal (equal mass).
 */
export function resolvePlayerPlayerCollision(
  a: PlayerExtended,
  b: PlayerExtended
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = PLAYER_RADIUS * 2;

  if (dist >= minDist) return;

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

  // Relative velocity of b with respect to a, projected onto collision normal
  const relVx = b.vx - a.vx;
  const relVy = b.vy - a.vy;
  const dot = relVx * nx + relVy * ny;

  // Only resolve if approaching (dot < 0 means converging)
  if (dot >= 0) return;

  // Equal-mass impulse: j = -(1 + e) * dot / 2
  const j = -(1 + PLAYER_RESTITUTION) * dot / 2;
  a.vx -= nx * j;
  a.vy -= ny * j;
  b.vx += nx * j;
  b.vy += ny * j;
}

/**
 * Resolve a player-ball collision.
 * - Separates the ball so it no longer overlaps the player circle.
 * - Transfers the component of player velocity that pushes into the ball.
 */
export function resolvePlayerBallCollision(
  player: PlayerExtended,
  ball: Ball
): void {
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const dist = Math.hypot(dx, dy);

  if (dist >= CONTACT_DIST) return; // no overlap

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
