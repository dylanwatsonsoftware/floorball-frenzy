import { describe, it, expect } from "vitest";
import { stepBall } from "../src/physics/ballPhysics";
import { Ball } from "../src/types/game";

// Reproduction of the possession pull logic from GameScene.ts
const PLAYER_RADIUS = 20;
const BALL_RADIUS = 10;
const STICK_REACH = 48;
const GOAL_LINE_LEFT = 194;
const GOAL_TOP = 304;
const GOAL_BOTTOM = 416;

function getBladeTip(player: {x: number, y: number}, aim: {x: number, y: number}) {
  const stickDir = { x: -aim.y, y: aim.x };
  const aNx = aim.x;
  const aNy = aim.y;

  const bladeTipX = player.x + stickDir.x * STICK_REACH + aNx * PLAYER_RADIUS * 0.84;
  const bladeTipY = player.y + stickDir.y * STICK_REACH + aNy * PLAYER_RADIUS * 0.84;

  return { x: bladeTipX, y: bladeTipY };
}

describe("Possession Goal Bug Reproduction", () => {
  it("pulls the ball behind the goal line when facing the left goal", () => {
    const player = { x: 210, y: 360 }; // Standing in front of left goal
    const aim = { x: -1, y: 0 }; // Facing the goal

    const tip = getBladeTip(player, aim);

    // The goal line is at 194. Anything < 194 is in the goal.
    expect(tip.x).toBeLessThan(GOAL_LINE_LEFT);
    expect(tip.x).toBe(193.2); // 210 - 16.8

    // Check if it's within the goal mouth Y range
    expect(tip.y).toBeGreaterThan(GOAL_TOP);
    expect(tip.y).toBeLessThan(GOAL_BOTTOM);
    expect(tip.y).toBe(360 - 48); // 312
  });

  it("does not score when ball is possessed", () => {
    const ball: Ball = {
      x: 193, // Inside left goal line (194)
      y: 360,
      z: 0,
      vx: -100,
      vy: 0,
      vz: 0,
      possessedBy: "host"
    };

    const result = stepBall(ball, 1/60);
    expect(result).toBeNull();
  });

  it("scores when ball is NOT possessed", () => {
    const ball: Ball = {
      x: 195, // Just outside left goal line (194)
      y: 360,
      z: 0,
      vx: -200, // Moving left
      vy: 0,
      vz: 0,
      possessedBy: null
    };

    const result = stepBall(ball, 1/60);
    expect(result).toBe("client");
  });
});
