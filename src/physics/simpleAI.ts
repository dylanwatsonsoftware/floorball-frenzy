import type { Ball, InputState, Player } from "../types/game";
import { GOAL_LINE_LEFT, GOAL_TOP, GOAL_BOTTOM, SHOOT_MAX_CHARGE_MS } from "./constants";

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

  if (hasPossession) {
    // AI (Client) attacks Left Goal (Red Team is Host, Blue Team is Client)
    // Actually, in memory: "Red (Host/Left) vs. Blue (Client/Right) team color scheme.
    // Red attacks the Right goal; Blue attacks the Left goal."
    // So Client (AI) attacks GOAL_LINE_LEFT.
    targetX = GOAL_LINE_LEFT;
    targetY = midGoalY;

    // Avoidance logic: if opponent is in the way, steer around them
    const dxOpp = opponent.x - aiPlayer.x;
    const dyOpp = opponent.y - aiPlayer.y;
    const distOpp = Math.hypot(dxOpp, dyOpp);

    // If opponent is close and roughly in front of us
    // AI is at Right, attacking Left. So opponent is "in front" if opponent.x < aiPlayer.x
    if (distOpp < 200 && opponent.x < aiPlayer.x) {
      // Steer up or down based on opponent's Y
      if (opponent.y > aiPlayer.y) {
        targetY = Math.max(GOAL_TOP, aiPlayer.y - 150);
      } else {
        targetY = Math.min(GOAL_BOTTOM, aiPlayer.y + 150);
      }
      // Push target X a bit further to maintain forward momentum while sidestepping
      targetX = aiPlayer.x - 100;
    }

    // Shooting logic
    const distToGoal = Math.hypot(aiPlayer.x - GOAL_LINE_LEFT, aiPlayer.y - midGoalY);
    if (distToGoal < 450) {
      // Start charging slap if not already charging enough
      if (aiPlayer.chargeMs < SHOOT_MAX_CHARGE_MS * 0.7) {
        input.slap = true;
      } else {
        // Release slap (by setting input.slap = false)
        input.slap = false;
      }
    }
  } else {
    // Move toward the ball
    targetX = ball.x;
    targetY = ball.y;

    // Use dash if ball is far away or moving fast away
    const distToBall = Math.hypot(aiPlayer.x - ball.x, aiPlayer.y - ball.y);
    if (distToBall > 300 && aiPlayer.dashCharges > 0 && aiPlayer.dashCooldownMs === 0) {
      input.dash = true;
    }
  }

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
