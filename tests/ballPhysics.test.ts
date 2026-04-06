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
  GOAL_TOP,
  GOAL_BOTTOM,
  GOAL_LINE_LEFT,
  GOAL_LINE_RIGHT,
  CORNER_RADIUS,
  FIXED_DT,
} from "../src/physics/constants";

function makeBall(overrides: Partial<Ball> = {}): Ball {
  return { x: 640, y: 360, z: 0, vx: 0, vy: 0, vz: 0, possessedBy: null, ...overrides };
}

describe("stepBall — gravity and vertical bounce", () => {
  it("applies gravity to vz each step", () => {
    const ball = makeBall({ z: 100, vz: 0 });
    stepBall(ball, FIXED_DT);
    expect(ball.vz).toBeCloseTo(-GRAVITY * FIXED_DT, 5);
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

  it("bounces off end walls (left)", () => {
    const ball = makeBall({ x: FIELD_LEFT + BALL_RADIUS - 1, y: FIELD_TOP + 10, vx: -100, z: 50 });
    stepBall(ball, FIXED_DT);
    expect(ball.x).toBeGreaterThanOrEqual(FIELD_LEFT + BALL_RADIUS);
    expect(ball.vx).toBeGreaterThan(0);
  });

  it("bounces off end walls (right)", () => {
    const ball = makeBall({ x: FIELD_RIGHT - BALL_RADIUS + 1, y: FIELD_TOP + 10, vx: 100, z: 50 });
    stepBall(ball, FIXED_DT);
    expect(ball.x).toBeLessThanOrEqual(FIELD_RIGHT - BALL_RADIUS);
    expect(ball.vx).toBeLessThan(0);
  });

  it("ball can travel behind goal (between end wall and goal line) without scoring when moving right", () => {
    const goalMidY = (GOAL_TOP + GOAL_BOTTOM) / 2;
    // Ball is behind left goal, moving right (exiting) — should NOT score
    const ball = makeBall({ x: FIELD_LEFT + 10, y: goalMidY, z: 0, vx: 200 });
    const result = stepBall(ball, FIXED_DT);
    expect(result).toBeNull();
  });
});

describe("stepBall — goal detection (at goal line, not end wall)", () => {
  it("returns 'client' when ball crosses left goal line going left (blue net, red scores)", () => {
    const goalMidY = (GOAL_TOP + GOAL_BOTTOM) / 2;
    const ball = makeBall({ x: GOAL_LINE_LEFT + 1, y: goalMidY, z: 0, vx: -300 });
    const result = stepBall(ball, FIXED_DT);
    expect(result).toBe("client");
  });

  it("returns 'host' when ball crosses right goal line going right (red net, blue scores)", () => {
    const goalMidY = (GOAL_TOP + GOAL_BOTTOM) / 2;
    const ball = makeBall({ x: GOAL_LINE_RIGHT - 1, y: goalMidY, z: 0, vx: 300 });
    const result = stepBall(ball, FIXED_DT);
    expect(result).toBe("host");
  });

  it("returns null when ball is above goal z threshold", () => {
    const goalMidY = (GOAL_TOP + GOAL_BOTTOM) / 2;
    // GOAL_Z_THRESHOLD is now 4800, so 300 is below it.
    const ball = makeBall({ x: GOAL_LINE_LEFT - 5, y: goalMidY, z: 5000, vx: -300 });
    const result = stepBall(ball, FIXED_DT);
    expect(result).toBeNull();
  });

  it("returns null when ball is outside goal mouth y range", () => {
    const ball = makeBall({ x: GOAL_LINE_LEFT - 5, y: FIELD_TOP + 5, z: 0, vx: -300 });
    const result = stepBall(ball, FIXED_DT);
    expect(result).toBeNull();
  });

  it("does NOT score when ball behind goal is moving toward field (vx > 0)", () => {
    const goalMidY = (GOAL_TOP + GOAL_BOTTOM) / 2;
    const ball = makeBall({ x: FIELD_LEFT + 10, y: goalMidY, z: 0, vx: 300 });
    const result = stepBall(ball, FIXED_DT);
    expect(result).toBeNull();
  });
});

describe("stepBall — rounded corner collision", () => {
  const R = CORNER_RADIUS; // 42

  it("pushes ball away from top-left corner arc", () => {
    const cx = FIELD_LEFT + R;
    const cy = FIELD_TOP + R;
    // Place ball very close to corner centre (further from arc than BALL_RADIUS)
    const ball = makeBall({ x: cx - 5, y: cy - 5, z: 50, vx: -200, vy: -200 });
    stepBall(ball, FIXED_DT);
    const dist = Math.hypot(ball.x - cx, ball.y - cy);
    expect(dist).toBeLessThanOrEqual(R - BALL_RADIUS + 1); // within boundary
  });

  it("ball in corner zone but within arc boundary is unaffected", () => {
    const cx = FIELD_LEFT + R;
    const cy = FIELD_TOP + R;
    // Place ball inside corner zone but well within the arc (dist << R - BALL_RADIUS)
    const ball = makeBall({ x: cx, y: cy, z: 50, vx: 0, vy: 0 });
    const prevX = ball.x;
    const prevY = ball.y;
    stepBall(ball, FIXED_DT);
    // No corner correction needed — ball was well inside
    expect(ball.x).toBeCloseTo(prevX, 0);
    expect(ball.y).toBeCloseTo(prevY, 0);
  });

  it("corner bounce reverses outward velocity component", () => {
    const cx = FIELD_LEFT + R;
    const cy = FIELD_TOP + R;
    // Ball just outside the arc, moving away from centre
    const angle = Math.PI * 1.25; // 225° — toward top-left corner
    const d = R - BALL_RADIUS + 2; // just beyond boundary
    const ball = makeBall({
      x: cx + Math.cos(angle) * d,
      y: cy + Math.sin(angle) * d,
      z: 50,
      vx: Math.cos(angle) * 200,
      vy: Math.sin(angle) * 200,
    });
    stepBall(ball, FIXED_DT);
    // After bounce, ball should be moving inward (away from corner)
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const radialVel = ball.vx * (dx / Math.hypot(dx, dy)) + ball.vy * (dy / Math.hypot(dx, dy));
    expect(radialVel).toBeLessThanOrEqual(0);
  });
});

describe("applyPossessionAssist", () => {
  it("pulls ball velocity toward player velocity", () => {
    const ball = makeBall({ vx: 0, vy: 0 });
    applyPossessionAssist(ball, 100, 200);
    expect(ball.vx).toBeCloseTo(10, 5);
    expect(ball.vy).toBeCloseTo(20, 5);
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
  });
});
