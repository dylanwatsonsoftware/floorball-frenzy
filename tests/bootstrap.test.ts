import { describe, it, expect } from "vitest";
import type { Ball, Player, InputState, GameState } from "../src/types/game";

describe("type contracts", () => {
  it("Ball has 3D position and velocity fields", () => {
    const ball: Ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    expect(Object.keys(ball)).toEqual(["x", "y", "z", "vx", "vy", "vz"]);
  });

  it("Player has id, position, velocity, aim, dash cooldown, and input", () => {
    const input: InputState = { moveX: 0, moveY: 0, wrist: false, slap: false, dash: false };
    const player: Player = { id: "p1", x: 0, y: 0, vx: 0, vy: 0, aimX: 1, aimY: 0, dashCooldownMs: 0, input };
    expect(player.id).toBe("p1");
    expect(player.input.dash).toBe(false);
  });

  it("GameState contains ball, players, time, and score", () => {
    const input: InputState = { moveX: 0, moveY: 0, wrist: false, slap: false, dash: false };
    const p: Player = { id: "host", x: 0, y: 0, vx: 0, vy: 0, aimX: 1, aimY: 0, dashCooldownMs: 0, input };
    const ball: Ball = { x: 640, y: 360, z: 0, vx: 0, vy: 0, vz: 0 };
    const state: GameState = {
      t: 0,
      remainingTimeMs: 120000,
      ball,
      players: {
        host: p,
        client: { ...p, id: "client", aimX: -1, input: { ...input } },
      },
      score: { host: 0, client: 0 },
    };
    expect(state.remainingTimeMs).toBe(120000);
    expect(state.score.host).toBe(0);
    expect(state.players.host.id).toBe("host");
    expect(state.players.client.aimX).toBe(-1);

    // Verify input was independently cloned (not shared by reference)
    expect(state.players.client.input).not.toBe(state.players.host.input);
  });
});
