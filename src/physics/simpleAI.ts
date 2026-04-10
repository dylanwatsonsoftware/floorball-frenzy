import type { Ball, InputState, Player } from "../types/game";
import {
  GOAL_LINE_LEFT,
  GOAL_TOP,
  GOAL_BOTTOM,
  SHOOT_MAX_CHARGE_MS,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FIELD_BOTTOM,
  PLAYER_RADIUS,
  GOAL_CAGE_DEPTH
} from "./constants";

export function getNextAIInput(aiPlayer: Player, ball: Ball, opponent: Player): InputState {
  const input: InputState = {
    moveX: 0,
    moveY: 0,
    slap: false,
    dash: false,
  };

  const midGoalY = (GOAL_TOP + GOAL_BOTTOM) / 2;
  const hasPossession = ball.possessedBy === aiPlayer.id;

  let targetX = ball.x;
  let targetY = ball.y;

  const PADDING = PLAYER_RADIUS + 10;

  if (hasPossession) {
    // AI (Client) attacks Left Goal
    targetX = GOAL_LINE_LEFT;
    targetY = midGoalY;

    // Avoidance logic: if opponent is in the way, steer around them
    const dxOpp = opponent.x - aiPlayer.x;
    const dyOpp = opponent.y - aiPlayer.y;
    const distOpp = Math.hypot(dxOpp, dyOpp);

    if (distOpp < 200 && opponent.x < aiPlayer.x) {
      if (opponent.y > aiPlayer.y) {
        targetY = Math.max(FIELD_TOP + PADDING, aiPlayer.y - 150);
      } else {
        targetY = Math.min(FIELD_BOTTOM - PADDING, aiPlayer.y + 150);
      }
      targetX = aiPlayer.x - 100;
    }

    // Shooting logic
    const distToGoal = Math.hypot(aiPlayer.x - GOAL_LINE_LEFT, aiPlayer.y - midGoalY);
    if (distToGoal < 450) {
      if (aiPlayer.chargeMs < SHOOT_MAX_CHARGE_MS * 0.7) {
        input.slap = true;
      } else {
        input.slap = false;
      }
    }
  } else {
    // Move toward the ball
    targetX = ball.x;
    targetY = ball.y;

    // Use dash if ball is far away
    const distToBall = Math.hypot(aiPlayer.x - ball.x, aiPlayer.y - ball.y);
    if (distToBall > 300 && aiPlayer.dashCharges > 0 && aiPlayer.dashCooldownMs === 0) {
      input.dash = true;
    }
  }

  // ── Corner / Goal Obstacle handling ─────────────────────────────────────────
  // If target is near a goal cage but not the mouth, steer toward the center
  const isNearLeftGoalX = targetX < GOAL_LINE_LEFT + 20;
  const isNearRightGoalX = targetX > FIELD_RIGHT - GOAL_CAGE_DEPTH - 20;
  const isOutsideGoalMouthY = targetY < GOAL_TOP - 10 || targetY > GOAL_BOTTOM + 10;

  if ((isNearLeftGoalX || isNearRightGoalX) && isOutsideGoalMouthY) {
    // Steer vertically toward the center of the pitch to avoid getting stuck behind goals
    const midY = (FIELD_TOP + FIELD_BOTTOM) / 2;
    if (aiPlayer.y < midY) {
        targetY = aiPlayer.y + 50;
    } else {
        targetY = aiPlayer.y - 50;
    }
  }

  // Clamp target within field boundaries with padding
  targetX = Math.max(FIELD_LEFT + PADDING, Math.min(FIELD_RIGHT - PADDING, targetX));
  targetY = Math.max(FIELD_TOP + PADDING, Math.min(FIELD_BOTTOM - PADDING, targetY));

  // Calculate movement vector
  const dx = targetX - aiPlayer.x;
  const dy = targetY - aiPlayer.y;
  const dist = Math.hypot(dx, dy);

  if (dist > 10) {
    input.moveX = dx / dist;
    input.moveY = dy / dist;
  }

  return input;
}
