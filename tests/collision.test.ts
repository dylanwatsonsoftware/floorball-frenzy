import { describe, it, expect } from "vitest";
import { resolvePlayerBallCollision } from "../src/physics/collision";
import { PLAYER_RADIUS, BALL_RADIUS } from "../src/physics/constants";
import type { Ball } from "../src/types/game";
import type { PlayerExtended } from "../src/physics/playerPhysics";

function makePlayer(overrides: Partial<PlayerExtended> = {}): PlayerExtended {
  return {
    id: "p1", x: 0, y: 0, vx: 0, vy: 0,
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
