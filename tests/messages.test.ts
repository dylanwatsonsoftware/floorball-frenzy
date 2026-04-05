import { describe, it, expect } from "vitest";
import {
  isGameMessage,
  isSignalMessage,
  encodeMessage,
  decodeMessage,
  encodeSnapshot,
  decodeSnapshot,
} from "../src/net/messages";
import type { GameMessage, GameState } from "../src/types/game";

function makeInput() {
  return { moveX: 0, moveY: 0, wrist: false, slap: false, dash: false };
}

describe("isGameMessage", () => {
  it("accepts valid types", () => {
    expect(isGameMessage({ type: "start" })).toBe(true);
    expect(isGameMessage({ type: "ping", t: 123 })).toBe(true);
    expect(isGameMessage({ type: "pong", t: 456 })).toBe(true);
    expect(isGameMessage({ type: "goal", scorer: "host" })).toBe(true);
    expect(isGameMessage({ type: "input", seq: 1, input: {} })).toBe(true);
  });

  it("rejects unknown types", () => {
    expect(isGameMessage({ type: "unknown" })).toBe(false);
    expect(isGameMessage(null)).toBe(false);
    expect(isGameMessage("start")).toBe(false);
    expect(isGameMessage(42)).toBe(false);
  });
});

describe("isSignalMessage", () => {
  it("accepts offer/answer/ice with roomId", () => {
    expect(isSignalMessage({ type: "offer", sdp: "...", roomId: "abc" })).toBe(true);
    expect(isSignalMessage({ type: "answer", sdp: "...", roomId: "abc" })).toBe(true);
    expect(isSignalMessage({ type: "ice", candidate: {}, roomId: "abc" })).toBe(true);
  });

  it("rejects missing roomId", () => {
    expect(isSignalMessage({ type: "offer", sdp: "..." })).toBe(false);
  });

  it("rejects game message types", () => {
    expect(isSignalMessage({ type: "start", roomId: "abc" })).toBe(false);
  });
});

describe("encode/decode roundtrip", () => {
  const cases: any[] = [
    { type: "start" },
    { type: "ping", t: 1000 },
    { type: "pong", t: 1001 },
    { type: "goal", scorer: "client" },
    {
      type: "input",
      seq: 42,
      input: { moveX: 1, moveY: -0.5, wrist: false, slap: true, dash: false },
    },
  ];

  for (const msg of cases) {
    it(`roundtrips "${msg.type}" message`, () => {
      const encoded = encodeMessage(msg);
      const decoded = decodeMessage(encoded);
      expect(decoded).toEqual(msg);
    });
  }

  it("returns null for malformed JSON", () => {
    expect(decodeMessage("{bad json")).toBeNull();
  });

  it("returns null for valid JSON with unknown type", () => {
    expect(decodeMessage(JSON.stringify({ type: "hack" }))).toBeNull();
  });
});

describe("Binary Snapshot", () => {
  it("encodes and decodes a complex state accurately", () => {
    const s: any = {
      t: 12345.678,
      remainingTimeMs: 45000.5,
      ball: {
        x: 100.1, y: 200.2, z: 30.3,
        vx: 400.4, vy: 500.5, vz: 60.6,
        isPerfect: true,
        possessedBy: "host",
      },
      players: {
        host: {
          id: "host", x: 10, y: 20, vx: 1, vy: 2,
          aimX: 0.707, aimY: 0.707,
          dashCooldownMs: 500,
          input: { moveX: 1, moveY: 0, wrist: true, slap: false, dash: true },
        },
        client: {
          id: "client", x: 90, y: 80, vx: -1, vy: -2,
          aimX: -1, aimY: 0,
          dashCooldownMs: 0,
          input: { moveX: -0.5, moveY: 0.5, wrist: false, slap: true, dash: false },
        },
      },
      score: { host: 3, client: 2 },
    };

    const buf = encodeSnapshot(s);
    expect(buf.byteLength).toBe(118);
    const decoded = decodeSnapshot(buf);

    expect(decoded!.t).toBeCloseTo(s.t, 5);
    expect(decoded!.remainingTimeMs).toBeCloseTo(s.remainingTimeMs, 5);
    expect(decoded!.ball.x).toBeCloseTo(s.ball.x, 2);
    expect(decoded!.ball.vx).toBeCloseTo(s.ball.vx, 2);
    expect(decoded!.ball.isPerfect).toBe(true);
    expect(decoded!.ball.possessedBy).toBe("host");

    expect(decoded!.players.host.x).toBeCloseTo(10, 2);
    expect(decoded!.players.host.aimX).toBeCloseTo(0.707, 2);
    expect(decoded!.players.host.input.wrist).toBe(true);
    expect(decoded!.players.host.input.dash).toBe(true);
    expect(decoded!.players.host.input.slap).toBe(false);

    expect(decoded!.players.client.input.slap).toBe(true);
    expect(decoded!.players.client.input.moveX).toBeCloseTo(-0.5, 2);

    expect(decoded!.score.host).toBe(3);
    expect(decoded!.score.client).toBe(2);
  });
});
