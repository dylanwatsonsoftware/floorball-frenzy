import { describe, it, expect } from "vitest";
import type { Ball, Player, InputState, GameState } from "../src/types/game";

describe("type contracts", () => {
  it("Ball has 3D position and velocity fields", () => {
    const ball: Ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, possessedBy: null };
    expect(Object.keys(ball)).toContain("x");
    expect(Object.keys(ball)).toContain("y");
    expect(Object.keys(ball)).toContain("z");
    expect(Object.keys(ball)).toContain("vx");
    expect(Object.keys(ball)).toContain("vy");
    expect(Object.keys(ball)).toContain("vz");
    expect(Object.keys(ball)).toContain("possessedBy");
  });

  it("Player has id, position, velocity, and input", () => {
    const input: InputState = { moveX: 0, moveY: 0, slap: false, dash: false };
    const player: Player = { id: "p1", x: 0, y: 0, vx: 0, vy: 0, aimX: 1, aimY: 0, dashCooldownMs: 0, dashBurstMs: 0, chargeMs: 0, heat: 0, heatModeMs: 0, input };
    expect(player.id).toBe("p1");
    expect(player.input.dash).toBe(false);
  });

  it("GameState contains ball, players, and score", () => {
    const input: InputState = { moveX: 0, moveY: 0, slap: false, dash: false };
    const p: Player = { id: "host", x: 0, y: 0, vx: 0, vy: 0, aimX: 1, aimY: 0, dashCooldownMs: 0, dashBurstMs: 0, chargeMs: 0, heat: 0, heatModeMs: 0, input };
    const ball: Ball = { x: 640, y: 360, z: 0, vx: 0, vy: 0, vz: 0, possessedBy: null };
    const state: GameState = {
      t: 0,
      ball,
      players: { host: p, client: { ...p, id: "client" } },
      score: { host: 0, client: 0 },
    };
    expect(state.score.host).toBe(0);
    expect(state.players.host.id).toBe("host");
  });
});
