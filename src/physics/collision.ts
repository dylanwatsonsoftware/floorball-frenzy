import type { Ball } from "../types/game";
import type { PlayerExtended } from "./playerPhysics";
import { PLAYER_RADIUS, BALL_RADIUS } from "./constants";

const CONTACT_DIST = PLAYER_RADIUS + BALL_RADIUS;

// How much of the player's velocity is transferred to the ball on contact.
// 0.6 feels like a solid stick push without being unrealistically bouncy.
const TRANSFER = 0.6;

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
