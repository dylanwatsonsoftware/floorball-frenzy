import { describe, it, expect } from "vitest";
import { lerpState } from "../src/net/lerp";
import type { GameState, Player, InputState } from "../src/types/game";

function makeInput(): InputState {
  return { moveX: 0, moveY: 0, wrist: false, slap: false, dash: false };
}
function makePlayer(x: number, y: number): Player {
  return { id: "p", x, y, vx: 0, vy: 0, input: makeInput() };
}
function makeState(ballX: number, score = { host: 0, client: 0 }): GameState {
  return {
    t: 0,
    ball: { x: ballX, y: 360, z: 0, vx: 0, vy: 0, vz: 0 },
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

  it("interpolates player and ball velocities", () => {
    const current = makeState(0);
    current.ball.vx = 100;
    current.players.host.vx = 50;

    const snapshot = makeState(0);
    snapshot.ball.vx = 200;
    snapshot.players.host.vx = 150;

    lerpState(current, snapshot, 0.5);
    expect(current.ball.vx).toBeCloseTo(150, 5);
    expect(current.players.host.vx).toBeCloseTo(100, 5);
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
  });
});
