import { describe, it, expect } from "vitest";
import { lerpState } from "../src/net/lerp";
import type { GameState, Player, InputState } from "../src/types/game";

function makeInput(): InputState {
  return { moveX: 0, moveY: 0, slap: false, dash: false };
}
function makePlayer(x: number, y: number): Player {
  return { id: "p", x, y, vx: 0, vy: 0, aimX: 1, aimY: 0, dashCooldownMs: 0, dashCharges: 3, chargeMs: 0, input: makeInput() };
}
function makeState(ballX: number, score = { host: 0, client: 0 }): GameState {
  return {
    t: 0,
    ball: { x: ballX, y: 360, z: 0, vx: 0, vy: 0, vz: 0, possessedBy: null },
    players: { host: makePlayer(300, 360), client: makePlayer(900, 360) },
    score,
  };
}

describe("lerpState", () => {
  it("t=1 fully adopts snapshot", () => {
    const current = makeState(100);
    const snapshot = makeState(500);
    lerpState(current, snapshot, 1);
    expect(current.ball.x).toBeCloseTo(500, 5);
  });

  it("t=0 keeps current values", () => {
    const current = makeState(100);
    const snapshot = makeState(500);
    lerpState(current, snapshot, 0);
    expect(current.ball.x).toBeCloseTo(100, 5);
  });

  it("t=0.5 interpolates halfway", () => {
    const current = makeState(0);
    const snapshot = makeState(200);
    lerpState(current, snapshot, 0.5);
    expect(current.ball.x).toBeCloseTo(100, 5);
  });

  it("always adopts snapshot score directly", () => {
    const current = makeState(0, { host: 1, client: 0 });
    const snapshot = makeState(0, { host: 2, client: 1 });
    lerpState(current, snapshot, 0);
    expect(current.score.host).toBe(2);
    expect(current.score.client).toBe(1);
  });

  it("interpolates all player and ball velocity components", () => {
    const current = makeState(0);
    current.ball.vx = 100;
    current.ball.vy = 50;
    current.ball.vz = 20;
    current.players.host.vx = 10;
    current.players.host.vy = 20;
    current.players.client.vx = -10;
    current.players.client.vy = -20;

    const snapshot = makeState(0);
    snapshot.ball.vx = 200;
    snapshot.ball.vy = 150;
    snapshot.ball.vz = 120;
    snapshot.players.host.vx = 110;
    snapshot.players.host.vy = 120;
    snapshot.players.client.vx = 90;
    snapshot.players.client.vy = 80;

    lerpState(current, snapshot, 0.5);
    expect(current.ball.vx).toBeCloseTo(150, 5);
    expect(current.ball.vy).toBeCloseTo(100, 5);
    expect(current.ball.vz).toBeCloseTo(70, 5);
    expect(current.players.host.vx).toBeCloseTo(60, 5);
    expect(current.players.host.vy).toBeCloseTo(70, 5);
    expect(current.players.client.vx).toBeCloseTo(40, 5);
    expect(current.players.client.vy).toBeCloseTo(30, 5);
  });

  it("interpolates player aim and synchronizes dashCooldown and chargeMs (t=0.5)", () => {
    const current = makeState(0);
    current.players.host.aimX = 1;
    current.players.host.aimY = 0;
    current.players.host.dashCooldownMs = 1000;
    current.players.host.chargeMs = 100;

    const snapshot = makeState(0);
    snapshot.players.host.aimX = 0;
    snapshot.players.host.aimY = 1;
    snapshot.players.host.dashCooldownMs = 0;
    snapshot.players.host.chargeMs = 500;

    lerpState(current, snapshot, 0.5);

    expect(current.players.host.aimX).toBeCloseTo(0.5, 5);
    expect(current.players.host.aimY).toBeCloseTo(0.5, 5);
    expect(current.players.host.dashCooldownMs).toBe(0); // Clamped/Snapped
    expect(current.players.host.chargeMs).toBe(500); // Clamped/Snapped
  });

  it("synchronizes player fields (t=1)", () => {
    const current = makeState(0);
    const snapshot = makeState(0);
    snapshot.players.host.aimX = 0.707;
    snapshot.players.host.aimY = 0.707;
    snapshot.players.host.dashCooldownMs = 400;
    snapshot.players.host.chargeMs = 800;

    lerpState(current, snapshot, 1);

    expect(current.players.host.aimX).toBeCloseTo(0.707, 5);
    expect(current.players.host.aimY).toBeCloseTo(0.707, 5);
    expect(current.players.host.dashCooldownMs).toBe(400);
    expect(current.players.host.chargeMs).toBe(800);
  });

  it("preserves player fields (t=0)", () => {
    const current = makeState(0);
    current.players.host.aimX = 0.8;
    current.players.host.aimY = 0.6;
    current.players.host.dashCooldownMs = 2000;
    current.players.host.chargeMs = 150;

    const snapshot = makeState(0);
    snapshot.players.host.aimX = 0;
    snapshot.players.host.aimY = 1;
    snapshot.players.host.dashCooldownMs = 0;
    snapshot.players.host.chargeMs = 0;

    lerpState(current, snapshot, 0);

    expect(current.players.host.aimX).toBeCloseTo(0.8, 5);
    expect(current.players.host.aimY).toBeCloseTo(0.6, 5);
    expect(current.players.host.dashCooldownMs).toBe(0); // Snap-to snapshot value regardless of t
    expect(current.players.host.chargeMs).toBe(0); // Snap-to snapshot value regardless of t
  });

  it("copies ball possessedBy state directly from snapshot", () => {
    const current = makeState(0);
    current.ball.possessedBy = "host";

    const snapshot = makeState(0);
    snapshot.ball.possessedBy = "client";

    lerpState(current, snapshot, 0.1);
    expect(current.ball.possessedBy).toBe("client");

    snapshot.ball.possessedBy = null;
    lerpState(current, snapshot, 0.1);
    expect(current.ball.possessedBy).toBeNull();
  });

  it("copies player input directly from snapshot", () => {
    const current = makeState(0);
    current.players.host.input.moveX = 0;
    current.players.host.input.slap = false;

    const snapshot = makeState(0);
    snapshot.players.host.input.moveX = 1;
    snapshot.players.host.input.slap = true;

    lerpState(current, snapshot, 0.1); // t doesn't affect input copying
    expect(current.players.host.input.moveX).toBe(1);
    expect(current.players.host.input.slap).toBe(true);

    // Verify decoupling (shallow copy)
    expect(current.players.host.input).not.toBe(snapshot.players.host.input);
    snapshot.players.host.input.moveX = 2;
    expect(current.players.host.input.moveX).toBe(1);
  });
});
