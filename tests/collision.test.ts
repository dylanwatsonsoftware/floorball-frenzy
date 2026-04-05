import { describe, it, expect } from "vitest";
import { resolvePlayerBallCollision, resolveStickTipCollision } from "../src/physics/collision";
import { PLAYER_RADIUS, BALL_RADIUS, STICK_LENGTH } from "../src/physics/constants";
import type { Ball } from "../src/types/game";
import type { PlayerExtended } from "../src/physics/playerPhysics";

function makePlayer(overrides: Partial<PlayerExtended> = {}): PlayerExtended {
  return {
    id: "p1", x: 0, y: 0, vx: 0, vy: 0,
    aimX: 1, aimY: 0,
    dashCooldownMs: 0,
    input: { moveX: 0, moveY: 0, wrist: false, slap: false, dash: false },
    ...overrides,
  };
}

function makeBall(overrides: Partial<Ball> = {}): Ball {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ...overrides };
}

const CONTACT_DIST = PLAYER_RADIUS + BALL_RADIUS; // 30

describe("resolvePlayerBallCollision — no overlap", () => {
  it("does nothing when ball is far from player", () => {
    const p = makePlayer({ x: 0, y: 0 });
    const ball = makeBall({ x: 100, y: 0 });
    resolvePlayerBallCollision(p, ball);
    expect(ball.x).toBe(100);
    expect(ball.vx).toBe(0);
  });
});

describe("resolvePlayerBallCollision — overlap resolution", () => {
  it("pushes ball outside contact distance when overlapping", () => {
    // Ball centre-to-centre overlap: 10px (contact dist = 30, actual dist = 20)
    const p = makePlayer({ x: 0, y: 0 });
    const ball = makeBall({ x: 20, y: 0 });
    resolvePlayerBallCollision(p, ball);
    const dist = Math.hypot(ball.x - p.x, ball.y - p.y);
    expect(dist).toBeGreaterThanOrEqual(CONTACT_DIST - 0.001);
  });

  it("resolves overlap along the correct axis", () => {
    const p = makePlayer({ x: 0, y: 0 });
    const ball = makeBall({ x: 0, y: 20 }); // directly below
    resolvePlayerBallCollision(p, ball);
    // Ball should be pushed downward (y > 0)
    expect(ball.y).toBeGreaterThan(20);
    expect(ball.x).toBeCloseTo(0, 3);
  });
});

describe("resolvePlayerBallCollision — momentum transfer", () => {
  it("gives ball velocity in the push direction when player is moving", () => {
    const p = makePlayer({ x: 0, y: 0, vx: 200, vy: 0 });
    const ball = makeBall({ x: 20, y: 0, vx: 0 }); // ball directly right
    resolvePlayerBallCollision(p, ball);
    // Ball should gain positive vx (player moving right into ball)
    expect(ball.vx).toBeGreaterThan(0);
  });

  it("does not give ball velocity away from player motion", () => {
    // Player moving left, ball to the right — player runs away from ball, no push
    const p = makePlayer({ x: 0, y: 0, vx: -200, vy: 0 });
    const ball = makeBall({ x: 20, y: 0, vx: 0 });
    resolvePlayerBallCollision(p, ball);
    // Ball should still be resolved outward but player is moving away,
    // so velocity transfer along normal should be minimal (<=0 dot product)
    // The ball should not receive large positive vx
    expect(ball.vx).toBeLessThanOrEqual(0);
  });

  it("transfers velocity proportional to player speed", () => {
    const pFast = makePlayer({ x: 0, y: 0, vx: 300, vy: 0 });
    const ballFast = makeBall({ x: 20, y: 0 });
    resolvePlayerBallCollision(pFast, ballFast);

    const pSlow = makePlayer({ x: 0, y: 0, vx: 100, vy: 0 });
    const ballSlow = makeBall({ x: 20, y: 0 });
    resolvePlayerBallCollision(pSlow, ballSlow);

    expect(ballFast.vx).toBeGreaterThan(ballSlow.vx);
  });
});

describe("resolvePlayerBallCollision — airborne ball", () => {
  it("still resolves horizontal overlap for airborne balls", () => {
    const p = makePlayer({ x: 0, y: 0 });
    const ball = makeBall({ x: 20, y: 0, z: 50 }); // airborne
    resolvePlayerBallCollision(p, ball);
    const dist = Math.hypot(ball.x - p.x, ball.y - p.y);
    expect(dist).toBeGreaterThanOrEqual(CONTACT_DIST - 0.001);
  });
});

const TIP_DIST = PLAYER_RADIUS + STICK_LENGTH; // 48

describe("resolveStickTipCollision", () => {
  it("does nothing when ball is far from stick tip", () => {
    const p = makePlayer({ x: 0, y: 0 });
    const ball = makeBall({ x: TIP_DIST + BALL_RADIUS + 10, y: 0 }); // beyond tip
    resolveStickTipCollision(p, ball, 1, 0);
    expect(ball.vx).toBe(0);
    expect(ball.x).toBeCloseTo(TIP_DIST + BALL_RADIUS + 10, 1);
  });

  it("does nothing when aim is zero vector", () => {
    const p = makePlayer({ x: 0, y: 0 });
    const ball = makeBall({ x: TIP_DIST, y: 0 });
    resolveStickTipCollision(p, ball, 0, 0);
    expect(ball.x).toBe(TIP_DIST); // unchanged
  });

  it("pushes ball away from tip on contact", () => {
    const p = makePlayer({ x: 0, y: 0 });
    // Stick tip is at (TIP_DIST, -0.84 * PLAYER_RADIUS) due to fwdX/fwdY offset
    const fwdY = -0.84 * PLAYER_RADIUS;
    const ball = makeBall({ x: TIP_DIST, y: fwdY + 5 }); // 5px offset from tip
    resolveStickTipCollision(p, ball, 1, 0);
    // Ball should be pushed further away from tip
    const dist = Math.hypot(ball.x - TIP_DIST, ball.y - fwdY);
    expect(dist).toBeGreaterThan(5);
  });

  it("transfers player velocity to ball on stick-tip contact", () => {
    const p = makePlayer({ x: 0, y: 0, vx: 300, vy: 0 });
    const fwdY = -0.84 * PLAYER_RADIUS;
    // Place ball so that it's overlapping the tip and the collision normal has a positive x component.
    // Tip is at (TIP_DIST, fwdY).
    // If ball is at (TIP_DIST + 5, fwdY), nx = 1.
    const ball = makeBall({ x: TIP_DIST + 5, y: fwdY });
    resolveStickTipCollision(p, ball, 1, 0);
    expect(ball.vx).toBeGreaterThan(0);
  });

  it("normalises non-unit aim vectors correctly", () => {
    const p = makePlayer({ x: 0, y: 0, vx: 0, vy: 200 });
    // Aim diagonally (non-unit)
    const aimX = 3, aimY = 4; // magnitude 5
    const len = Math.hypot(aimX, aimY);
    const nax = aimX / len, nay = aimY / len;

    const fwdX = nay * PLAYER_RADIUS * 0.84;
    const fwdY = -nax * PLAYER_RADIUS * 0.84;
    const tipX = nax * (PLAYER_RADIUS + STICK_LENGTH) + fwdX;
    const tipY = nay * (PLAYER_RADIUS + STICK_LENGTH) + fwdY;

    const ball = makeBall({ x: tipX, y: tipY - 2 }); // near tip
    resolveStickTipCollision(p, ball, aimX, aimY);
    // Ball should have moved (overlap resolved)
    const distToTip = Math.hypot(ball.x - tipX, ball.y - tipY);
    expect(distToTip).toBeGreaterThanOrEqual(BALL_RADIUS - 0.1);
  });
});
