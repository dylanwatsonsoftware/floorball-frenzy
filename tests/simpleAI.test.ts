import { describe, it, expect } from "vitest";
import { getNextAIInput } from "../src/physics/simpleAI";
import type { Player, Ball } from "../src/types/game";
import {
  GOAL_LINE_LEFT,
  GOAL_TOP,
  GOAL_BOTTOM,
  SHOOT_MAX_CHARGE_MS,
  MAX_DASH_CHARGES
} from "../src/physics/constants";

const midGoalY = (GOAL_TOP + GOAL_BOTTOM) / 2;

function createDummyPlayer(id: string, x: number, y: number): Player {
  return {
    id, x, y, vx: 0, vy: 0, aimX: 0, aimY: 0,
    dashCooldownMs: 0, dashCharges: MAX_DASH_CHARGES, lastDashTimeMs: -1000,
    chargeMs: 0, heat: 0, enFuegoTimerMs: 0,
    fakes: 0, parries: 0, rebounds: 0,
    input: { moveX: 0, moveY: 0, slap: false, dash: false }
  };
}

function createDummyBall(x: number, y: number, possessedBy: string | null = null): Ball {
  return { x, y, z: 0, vx: 0, vy: 0, vz: 0, possessedBy };
}

describe("simpleAI", () => {
  it("moves toward the ball when not in possession", () => {
    const ai = createDummyPlayer("ai", 500, 360);
    const opponent = createDummyPlayer("opp", 100, 360);
    const ball = createDummyBall(600, 360); // Ball is to the right

    const input = getNextAIInput(ai, ball, opponent);

    expect(input.moveX).toBeGreaterThan(0);
    expect(input.moveY).toBe(0);
  });

  it("moves toward left goal when in possession", () => {
    const ai = createDummyPlayer("ai", 500, 360);
    const opponent = createDummyPlayer("opp", 800, 360);
    const ball = createDummyBall(500, 360, "ai");

    const input = getNextAIInput(ai, ball, opponent);

    expect(input.moveX).toBeLessThan(0); // Attacking left
  });

  it("avoids opponent by steering up/down when in possession", () => {
    const ai = createDummyPlayer("ai", 500, 360);
    const opponent = createDummyPlayer("opp", 400, 360); // Opponent is directly in front (left)
    const ball = createDummyBall(500, 360, "ai");

    // Test steering up
    opponent.y = 370; // Opponent is slightly below
    let input = getNextAIInput(ai, ball, opponent);
    expect(input.moveY).toBeLessThan(0); // Should steer up

    // Test steering down
    opponent.y = 350; // Opponent is slightly above
    input = getNextAIInput(ai, ball, opponent);
    expect(input.moveY).toBeGreaterThan(0); // Should steer down
  });

  it("clamps steering Y to field boundaries and steers up when opponent is below", () => {
    const ai = createDummyPlayer("ai", 500, GOAL_TOP + 10);
    const opponent = createDummyPlayer("opp", 400, GOAL_TOP + 20); // Opponent below
    const ball = createDummyBall(500, GOAL_TOP + 10, "ai");

    const input = getNextAIInput(ai, ball, opponent);
    // Steering up should produce negative moveY
    expect(input.moveY).toBeLessThan(0);
  });

  it("charges and releases slap shot near goal", () => {
    const ai = createDummyPlayer("ai", GOAL_LINE_LEFT + 200, midGoalY);
    const opponent = createDummyPlayer("opp", 800, 360);
    const ball = createDummyBall(ai.x, ai.y, "ai");

    // Case: not charging yet
    let input = getNextAIInput(ai, ball, opponent);
    expect(input.slap).toBe(true);

    // Case: charging but below threshold
    ai.chargeMs = SHOOT_MAX_CHARGE_MS * 0.5;
    input = getNextAIInput(ai, ball, opponent);
    expect(input.slap).toBe(true);

    // Case: charging above threshold
    ai.chargeMs = SHOOT_MAX_CHARGE_MS * 0.8;
    input = getNextAIInput(ai, ball, opponent);
    expect(input.slap).toBe(false); // Released
  });

  it("dashes toward ball if far away", () => {
    const ai = createDummyPlayer("ai", 100, 100);
    const opponent = createDummyPlayer("opp", 800, 360);
    const ball = createDummyBall(500, 500); // dist > 300

    let input = getNextAIInput(ai, ball, opponent);
    expect(input.dash).toBe(true);

    // No charges
    ai.dashCharges = 0;
    input = getNextAIInput(ai, ball, opponent);
    expect(input.dash).toBe(false);

    // Cooldown active
    ai.dashCharges = 1;
    ai.dashCooldownMs = 100;
    input = getNextAIInput(ai, ball, opponent);
    expect(input.dash).toBe(false);
  });

  it("returns zero movement when close to target", () => {
    const ai = createDummyPlayer("ai", 500, 360);
    const opponent = createDummyPlayer("opp", 100, 360);
    const ball = createDummyBall(505, 360); // dist = 5 (< 10)

    const input = getNextAIInput(ai, ball, opponent);
    expect(input.moveX).toBe(0);
    expect(input.moveY).toBe(0);
  });
});
