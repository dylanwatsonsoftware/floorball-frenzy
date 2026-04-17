import { describe, it, expect } from "vitest";
import {
  createShootState,
  updateShootCharge,
  releaseShot,
} from "../src/physics/shooting";
import type { Ball } from "../src/types/game";
import {
  SHOOT_MAX_CHARGE_MS,
  ONE_TOUCH_MULTIPLIER,
} from "../src/physics/constants";

function makeBall(): Ball {
  return { x: 640, y: 360, z: 0, vx: 0, vy: 0, vz: 0, possessedBy: null };
}

describe("createShootState", () => {
  it("starts with zero charge and not charging", () => {
    const s = createShootState();
    expect(s.chargeMs).toBe(0);
    expect(s.charging).toBe(false);
  });
});

describe("releaseShot — Kinetic Redirect", () => {
  it("detects redirect on fast incoming ball with sharp angle", () => {
    const s = createShootState();
    s.chargeMs = 100; // low charge
    const ball = makeBall();
    ball.vx = 0;
    ball.vy = 500; // fast incoming

    // aim right (1, 0). incoming is (0, 500). dot product 0.
    releaseShot(s, ball, 1, 0, false);

    expect(ball.isRedirect).toBe(true);
    expect(ball.vx).toBeGreaterThan(500); // 500 base power + boost
  });

  it("does not redirect if angle is too shallow", () => {
    const s = createShootState();
    s.chargeMs = 100;
    const ball = makeBall();
    ball.vx = 400;
    ball.vy = 300; // speed 500, direction (0.8, 0.6)

    // aim similar direction (0.8, 0.6). dot product 1.
    releaseShot(s, ball, 0.8, 0.6, false);

    expect(ball.isRedirect).toBe(false);
  });

  it("does not redirect if charge is too high", () => {
    const s = createShootState();
    s.chargeMs = 300; // too high
    const ball = makeBall();
    ball.vx = 0;
    ball.vy = 500;

    releaseShot(s, ball, 1, 0, false);

    expect(ball.isRedirect).toBe(false);
  });
});

describe("updateShootCharge", () => {
  it("accumulates charge while slap is held", () => {
    const s = createShootState();
    updateShootCharge(s, true, 16);
    expect(s.chargeMs).toBe(16);
    expect(s.charging).toBe(true);
  });

  it("does not exceed 2× SHOOT_MAX_CHARGE_MS (overcharge headroom)", () => {
    const s = createShootState();
    updateShootCharge(s, true, SHOOT_MAX_CHARGE_MS * 3);
    expect(s.chargeMs).toBeLessThanOrEqual(SHOOT_MAX_CHARGE_MS * 2);
  });

  it("resets charge when slap released", () => {
    const s = createShootState();
    s.chargeMs = 400;
    s.charging = true;
    updateShootCharge(s, false, 16);
    // charge resets only after releaseShot is called, not here
    expect(s.charging).toBe(false);
  });
});

describe("releaseShot — direction and power", () => {
  it("fires ball horizontally in aim direction", () => {
    const s = createShootState();
    s.chargeMs = 0;
    const ball = makeBall();
    releaseShot(s, ball, 1, 0, false);
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.vy).toBeCloseTo(0, 3);
  });

  it("fires ball in the opposite direction when aim is left", () => {
    const s = createShootState();
    const ball = makeBall();
    releaseShot(s, ball, -1, 0, false);
    expect(ball.vx).toBeLessThan(0);
  });

  it("overcharge (2× max) produces less power than full charge", () => {
    const ballFull = makeBall();
    const sFull = createShootState();
    sFull.chargeMs = SHOOT_MAX_CHARGE_MS;
    releaseShot(sFull, ballFull, 1, 0, false);

    const ballOver = makeBall();
    const sOver = createShootState();
    sOver.chargeMs = SHOOT_MAX_CHARGE_MS * 2; // fully overcharged
    releaseShot(sOver, ballOver, 1, 0, false);

    expect(ballOver.vx).toBeLessThan(ballFull.vx);
  });

  it("full charge produces more power than zero charge", () => {
    const ballZero = makeBall();
    const sZero = createShootState();
    sZero.chargeMs = 0;
    releaseShot(sZero, ballZero, 1, 0, false);

    const ballFull = makeBall();
    const sFull = createShootState();
    sFull.chargeMs = SHOOT_MAX_CHARGE_MS;
    releaseShot(sFull, ballFull, 1, 0, false);

    expect(ballFull.vx).toBeGreaterThan(ballZero.vx);
  });

  it("full charge adds lift (vz > 0)", () => {
    const s = createShootState();
    s.chargeMs = SHOOT_MAX_CHARGE_MS;
    const ball = makeBall();
    releaseShot(s, ball, 1, 0, false);
    expect(ball.vz).toBeGreaterThan(0);
  });

  it("zero charge produces no lift", () => {
    const s = createShootState();
    s.chargeMs = 0;
    const ball = makeBall();
    releaseShot(s, ball, 1, 0, false);
    expect(ball.vz).toBe(0);
  });

  it("one-touch bonus multiplies power", () => {
    const sNormal = createShootState();
    const ballNormal = makeBall();
    releaseShot(sNormal, ballNormal, 1, 0, false);

    const sOneTouch = createShootState();
    const ballOneTouch = makeBall();
    releaseShot(sOneTouch, ballOneTouch, 1, 0, true);

    expect(ballOneTouch.vx).toBeCloseTo(ballNormal.vx * ONE_TOUCH_MULTIPLIER, 2);
  });

  it("resets chargeMs to 0 after release", () => {
    const s = createShootState();
    s.chargeMs = 400;
    releaseShot(s, makeBall(), 1, 0, false);
    expect(s.chargeMs).toBe(0);
    expect(s.charging).toBe(false);
  });
});

