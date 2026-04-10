import { describe, it, expect } from "vitest";
import { stepPlayer, createPlayer } from "../src/physics/playerPhysics";
import type { InputState } from "../src/types/game";
import {
  PLAYER_MAX_SPEED,
  PLAYER_ACCEL,
  PLAYER_FRICTION,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FIELD_BOTTOM,
  PLAYER_RADIUS,
  DASH_FORCE,
  DASH_COOLDOWN,
  FIXED_DT,
} from "../src/physics/constants";

const noInput: InputState = { moveX: 0, moveY: 0, slap: false, dash: false };

function rightInput(): InputState {
  return { moveX: 1, moveY: 0, slap: false, dash: false };
}

describe("createPlayer", () => {
  it("creates player at given position with zero velocity", () => {
    const p = createPlayer("p1", 200, 300);
    expect(p.id).toBe("p1");
    expect(p.x).toBe(200);
    expect(p.y).toBe(300);
    expect(p.vx).toBe(0);
    expect(p.vy).toBe(0);
    expect(p.dashCooldownMs).toBe(0);
    expect(p.dashCharges).toBe(3);
  });
});

describe("stepPlayer — movement", () => {
  it("accelerates in the input direction", () => {
    const p = createPlayer("p1", 640, 360);
    stepPlayer(p, rightInput(), FIXED_DT, FIXED_DT * 1000);
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vy).toBeCloseTo(0, 3);
  });

  it("applies friction — velocity decays without input", () => {
    const p = createPlayer("p1", 640, 360);
    p.vx = 100;
    stepPlayer(p, noInput, FIXED_DT, FIXED_DT * 1000);
    expect(p.vx).toBeCloseTo(100 * PLAYER_FRICTION, 5);
  });

  it("clamps speed to PLAYER_MAX_SPEED", () => {
    const p = createPlayer("p1", 640, 360);
    p.vx = 10000;
    p.vy = 10000;
    stepPlayer(p, noInput, FIXED_DT, FIXED_DT * 1000);
    const speed = Math.hypot(p.vx, p.vy);
    expect(speed).toBeLessThanOrEqual(PLAYER_MAX_SPEED * PLAYER_FRICTION + 0.001);
  });

  it("integrates position from velocity", () => {
    const p = createPlayer("p1", 640, 360);
    p.vx = 100;
    stepPlayer(p, noInput, FIXED_DT, FIXED_DT * 1000);
    // position += vx_before_friction * dt? No — friction applied first then position
    // vx after friction = 100 * 0.85 = 85; x += 85 * (1/60)
    expect(p.x).toBeCloseTo(640 + 100 * PLAYER_FRICTION * FIXED_DT, 3);
  });
});

describe("stepPlayer — boundary clamping", () => {
  it("clamps player to left boundary", () => {
    const p = createPlayer("p1", FIELD_LEFT, 360);
    p.vx = -1000;
    stepPlayer(p, noInput, FIXED_DT, FIXED_DT * 1000);
    expect(p.x).toBeGreaterThanOrEqual(FIELD_LEFT + PLAYER_RADIUS);
  });

  it("clamps player to right boundary", () => {
    const p = createPlayer("p1", FIELD_RIGHT, 360);
    p.vx = 1000;
    stepPlayer(p, noInput, FIXED_DT, FIXED_DT * 1000);
    expect(p.x).toBeLessThanOrEqual(FIELD_RIGHT - PLAYER_RADIUS);
  });

  it("clamps player to top boundary", () => {
    const p = createPlayer("p1", 640, FIELD_TOP);
    p.vy = -1000;
    stepPlayer(p, noInput, FIXED_DT, FIXED_DT * 1000);
    expect(p.y).toBeGreaterThanOrEqual(FIELD_TOP + PLAYER_RADIUS);
  });

  it("clamps player to bottom boundary", () => {
    const p = createPlayer("p1", 640, FIELD_BOTTOM);
    p.vy = 1000;
    stepPlayer(p, noInput, FIXED_DT, FIXED_DT * 1000);
    expect(p.y).toBeLessThanOrEqual(FIELD_BOTTOM - PLAYER_RADIUS);
  });
});

describe("stepPlayer — dash", () => {
  it("applies dash impulse in movement direction", () => {
    const p = createPlayer("p1", 640, 360);
    const input: InputState = { moveX: 1, moveY: 0, slap: false, dash: true };
    stepPlayer(p, input, FIXED_DT, FIXED_DT * 1000);
    expect(p.vx).toBeGreaterThan(DASH_FORCE * 0.5); // at least half after friction
  });

  it("sets dashCooldownMs after a dash", () => {
    const p = createPlayer("p1", 640, 360);
    const input: InputState = { moveX: 1, moveY: 0, slap: false, dash: true };
    stepPlayer(p, input, FIXED_DT, FIXED_DT * 1000);
    expect(p.dashCooldownMs).toBe(DASH_COOLDOWN);
    expect(p.dashCharges).toBe(2);
  });

  it("does not dash again while no charges are left", () => {
    const p = createPlayer("p1", 640, 360);
    p.dashCharges = 0;
    p.dashCooldownMs = DASH_COOLDOWN;
    const input: InputState = { moveX: 1, moveY: 0, slap: false, dash: true };
    const vxBefore = p.vx;
    stepPlayer(p, input, FIXED_DT, FIXED_DT * 1000);
    // impulse should NOT have been added
    const expectedWithoutDash = (vxBefore + PLAYER_ACCEL * FIXED_DT) * PLAYER_FRICTION;
    expect(p.vx).toBeCloseTo(expectedWithoutDash, 2);
  });

  it("decrements dashCooldownMs and recharges a dash", () => {
    const p = createPlayer("p1", 640, 360);
    p.dashCharges = 2;
    p.dashCooldownMs = 100;
    stepPlayer(p, noInput, FIXED_DT, 100);
    expect(p.dashCharges).toBe(3);
    expect(p.dashCooldownMs).toBe(0);
  });

  it("decrements dashCooldownMs and moves to next charge recharge", () => {
    const p = createPlayer("p1", 640, 360);
    p.dashCharges = 1;
    p.dashCooldownMs = 100;
    stepPlayer(p, noInput, FIXED_DT, 100);
    expect(p.dashCharges).toBe(2);
    expect(p.dashCooldownMs).toBe(DASH_COOLDOWN);
  });
});
