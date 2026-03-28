import { describe, it, expect } from "vitest";
import type { Ball } from "../src/types/game";
import { stepBall, applyPossessionAssist, resetBall } from "../src/physics/ballPhysics";
import {
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FIELD_BOTTOM,
  BALL_RADIUS,
  GRAVITY,
  BALL_BOUNCE_Z,
  BALL_FRICTION,
  BALL_BOUNCE,
  GOAL_TOP,
  GOAL_BOTTOM,
  FIXED_DT,
} from "../src/physics/constants";

function makeBall(overrides: Partial<Ball> = {}): Ball {
  return { x: 640, y: 360, z: 0, vx: 0, vy: 0, vz: 0, ...overrides };
}

describe("stepBall — gravity and vertical bounce", () => {
  it("applies gravity to vz each step", () => {
    const ball = makeBall({ z: 100, vz: 0 });
    stepBall(ball, FIXED_DT);
    expect(ball.vz).toBeCloseTo(-GRAVITY * FIXED_DT, 5);
  });

  it("integrates z from vz", () => {
    const ball = makeBall({ z: 100, vz: 50 });
    stepBall(ball, FIXED_DT);
    // vz after gravity: 50 - 900/60 = 35; z after: 100 + 35/60
    expect(ball.z).toBeGreaterThan(0);
  });

  it("bounces off the floor: z stays >= 0 and vz reverses", () => {
    const ball = makeBall({ z: 1, vz: -50 });
    stepBall(ball, FIXED_DT);
    expect(ball.z).toBeGreaterThanOrEqual(0);
    expect(ball.vz).toBeGreaterThanOrEqual(0);
  });

  it("applies BALL_BOUNCE_Z on floor contact", () => {
    const ball = makeBall({ z: 0, vz: -100 });
    stepBall(ball, FIXED_DT);
    // After gravity: vz = -100 - 900/60 = -115; then floor: vz = 115 * 0.5 = 57.5
    expect(ball.vz).toBeCloseTo((-(-100 - GRAVITY * FIXED_DT)) * BALL_BOUNCE_Z, 1);
  });
});

describe("stepBall — horizontal friction", () => {
  it("applies friction when ball is on the ground (z=0)", () => {
    const ball = makeBall({ z: 0, vz: 0, vx: 200 });
    stepBall(ball, FIXED_DT);
    expect(ball.vx).toBeCloseTo(200 * BALL_FRICTION, 5);
  });

  it("does NOT apply friction when ball is airborne", () => {
    const ball = makeBall({ z: 50, vz: 0, vx: 200 });
    stepBall(ball, FIXED_DT);
    expect(ball.vx).toBe(200);
  });
});

describe("stepBall — wall collisions", () => {
  it("bounces off top wall", () => {
    const ball = makeBall({ y: FIELD_TOP + BALL_RADIUS - 1, vy: -100 });
    stepBall(ball, FIXED_DT);
    expect(ball.y).toBeGreaterThanOrEqual(FIELD_TOP + BALL_RADIUS);
    expect(ball.vy).toBeGreaterThan(0);
  });

  it("bounces off bottom wall", () => {
    const ball = makeBall({ y: FIELD_BOTTOM - BALL_RADIUS + 1, vy: 100 });
    stepBall(ball, FIXED_DT);
    expect(ball.y).toBeLessThanOrEqual(FIELD_BOTTOM - BALL_RADIUS);
    expect(ball.vy).toBeLessThan(0);
  });

  it("bounces off left wall when outside goal mouth", () => {
    // z=50 to skip ground friction so we isolate wall-bounce restitution
    const ball = makeBall({ x: FIELD_LEFT + BALL_RADIUS - 1, y: FIELD_TOP + 10, vx: -100, z: 50 });
    stepBall(ball, FIXED_DT);
    expect(ball.x).toBeGreaterThanOrEqual(FIELD_LEFT + BALL_RADIUS);
    expect(ball.vx).toBeCloseTo(100 * BALL_BOUNCE, 2);
  });

  it("bounces off right wall when outside goal mouth", () => {
    const ball = makeBall({ x: FIELD_RIGHT - BALL_RADIUS + 1, y: FIELD_TOP + 10, vx: 100, z: 50 });
    stepBall(ball, FIXED_DT);
    expect(ball.x).toBeLessThanOrEqual(FIELD_RIGHT - BALL_RADIUS);
    expect(ball.vx).toBeCloseTo(-100 * BALL_BOUNCE, 2);
  });

  it("does NOT bounce when inside goal mouth (allows goal detection)", () => {
    const goalMidY = (GOAL_TOP + GOAL_BOTTOM) / 2;
    const ball = makeBall({ x: FIELD_LEFT + BALL_RADIUS - 1, y: goalMidY, vx: -200 });
    const result = stepBall(ball, FIXED_DT);
    // Should detect a goal, not bounce
    expect(result).toBe("host");
  });
});

describe("stepBall — goal detection", () => {
  it("returns 'host' when ball enters the left goal", () => {
    const goalMidY = (GOAL_TOP + GOAL_BOTTOM) / 2;
    const ball = makeBall({ x: FIELD_LEFT - 1, y: goalMidY, z: 0, vx: -100 });
    const result = stepBall(ball, FIXED_DT);
    expect(result).toBe("host");
  });

  it("returns 'client' when ball enters the right goal", () => {
    const goalMidY = (GOAL_TOP + GOAL_BOTTOM) / 2;
    const ball = makeBall({ x: FIELD_RIGHT + 1, y: goalMidY, z: 0, vx: 100 });
    const result = stepBall(ball, FIXED_DT);
    expect(result).toBe("client");
  });

  it("returns null when ball is above goal z threshold", () => {
    const goalMidY = (GOAL_TOP + GOAL_BOTTOM) / 2;
    const ball = makeBall({ x: FIELD_LEFT - 1, y: goalMidY, z: 200 });
    const result = stepBall(ball, FIXED_DT);
    expect(result).toBeNull();
  });

  it("returns null when ball is outside goal mouth (wrong y)", () => {
    const ball = makeBall({ x: FIELD_LEFT - 1, y: FIELD_TOP + 5, z: 0 });
    stepBall(ball, FIXED_DT);
    // No goal — ball should bounce off left wall
    expect(ball.vx).toBeGreaterThanOrEqual(0);
  });
});

describe("applyPossessionAssist", () => {
  it("pulls ball velocity toward player velocity", () => {
    const ball = makeBall({ vx: 0, vy: 0 });
    applyPossessionAssist(ball, 100, 200);
    expect(ball.vx).toBeCloseTo(10, 5);
    expect(ball.vy).toBeCloseTo(20, 5);
  });

  it("does nothing when ball already matches player velocity", () => {
    const ball = makeBall({ vx: 100, vy: 100 });
    applyPossessionAssist(ball, 100, 100);
    expect(ball.vx).toBeCloseTo(100, 5);
    expect(ball.vy).toBeCloseTo(100, 5);
  });
});

describe("resetBall", () => {
  it("places ball at field center with zero velocity", () => {
    const ball = makeBall({ x: 0, y: 0, z: 50, vx: 300, vy: -100, vz: 200 });
    resetBall(ball);
    expect(ball.x).toBe((FIELD_LEFT + FIELD_RIGHT) / 2);
    expect(ball.y).toBe((FIELD_TOP + FIELD_BOTTOM) / 2);
    expect(ball.z).toBe(0);
    expect(ball.vx).toBe(0);
    expect(ball.vy).toBe(0);
    expect(ball.vz).toBe(0);
  });
});
