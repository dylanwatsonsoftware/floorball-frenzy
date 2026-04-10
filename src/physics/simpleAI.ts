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

const AVOIDANCE_DISTANCE = 200;
const AVOIDANCE_Y_OFFSET = 150;
const AVOIDANCE_X_OFFSET = 100;
const SHOOT_RANGE = 450;
const SHOOT_CHARGE_FRACTION = 0.7;
const DASH_RANGE = 300;
const GOAL_PROXIMITY_X = 20;
const GOAL_MOUTH_Y_BUFFER = 10;
const PADDING_BUFFER = 10;
const MOVEMENT_THRESHOLD = 10;

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

  const PADDING = PLAYER_RADIUS + PADDING_BUFFER;

  if (hasPossession) {
    // AI (Client) attacks Left Goal
    targetX = GOAL_LINE_LEFT;
    targetY = midGoalY;

    // Avoidance logic: if opponent is in the way, steer around them
    const dxOpp = opponent.x - aiPlayer.x;
    const dyOpp = opponent.y - aiPlayer.y;
    const distOpp = Math.hypot(dxOpp, dyOpp);

    if (distOpp < AVOIDANCE_DISTANCE && opponent.x < aiPlayer.x) {
      if (opponent.y > aiPlayer.y) {
        targetY = Math.max(FIELD_TOP + PADDING, aiPlayer.y - AVOIDANCE_Y_OFFSET);
      } else {
        targetY = Math.min(FIELD_BOTTOM - PADDING, aiPlayer.y + AVOIDANCE_Y_OFFSET);
      }
      targetX = aiPlayer.x - AVOIDANCE_X_OFFSET;
    }

    // Shooting logic
    const distToGoal = Math.hypot(aiPlayer.x - GOAL_LINE_LEFT, aiPlayer.y - midGoalY);
    if (distToGoal < SHOOT_RANGE) {
      if (aiPlayer.chargeMs < SHOOT_MAX_CHARGE_MS * SHOOT_CHARGE_FRACTION) {
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
    if (distToBall > DASH_RANGE && aiPlayer.dashCharges > 0 && aiPlayer.dashCooldownMs === 0) {
      input.dash = true;
    }
  }

  // ── Corner / Goal Obstacle handling ─────────────────────────────────────────
  // If target is near a goal cage but not the mouth, steer toward the center
  const isNearLeftGoalX = targetX < GOAL_LINE_LEFT + GOAL_PROXIMITY_X;
  const isNearRightGoalX = targetX > FIELD_RIGHT - GOAL_CAGE_DEPTH - GOAL_PROXIMITY_X;
  const isOutsideGoalMouthY = targetY < GOAL_TOP - GOAL_MOUTH_Y_BUFFER || targetY > GOAL_BOTTOM + GOAL_MOUTH_Y_BUFFER;

  if ((isNearLeftGoalX || isNearRightGoalX) && isOutsideGoalMouthY) {
    // Steer vertically toward the center of the pitch to avoid getting stuck behind goals
    const midY = (FIELD_TOP + FIELD_BOTTOM) / 2;
    targetY = midY;
  }

  // Clamp target within field boundaries with padding
  targetX = Math.max(FIELD_LEFT + PADDING, Math.min(FIELD_RIGHT - PADDING, targetX));
  targetY = Math.max(FIELD_TOP + PADDING, Math.min(FIELD_BOTTOM - PADDING, targetY));

  // Calculate movement vector
  const dx = targetX - aiPlayer.x;
  const dy = targetY - aiPlayer.y;
  const dist = Math.hypot(dx, dy);

  if (dist > MOVEMENT_THRESHOLD) {
    input.moveX = dx / dist;
    input.moveY = dy / dist;
  }

  return input;
}
