import { describe, it, expect } from "vitest";
import { encodeMessage, decodeMessage } from "../src/net/messages";
import type { GameState, InputState } from "../src/types/game";

describe("Binary Serialization", () => {
  const mockInput: InputState = {
    moveX: 0.5,
    moveY: -0.8,
    wrist: true,
    slap: false,
    dash: true,
  };

  const mockState: GameState = {
    t: 12345.67,
    ball: {
      x: 640.5,
      y: 360.2,
      z: 15.3,
      vx: 100.1,
      vy: -50.4,
      vz: 20.2,
      isPerfect: true,
      isBolt: false,
      boltTimerMs: 400.5,
      possessedBy: "host",
    },
    players: {
      host: {
        id: "host",
        x: 300.1,
        y: 300.2,
        vx: 10.5,
        vy: 10.6,
        aimX: 0.707,
        aimY: 0.707,
        dashCooldownMs: 1500.5,
        chargeMs: 200.1,
        input: { ...mockInput, slap: true },
      },
      client: {
        id: "client",
        x: 900.1,
        y: 300.2,
        vx: -10.5,
        vy: -10.6,
        aimX: -0.707,
        aimY: -0.707,
        dashCooldownMs: 0,
        chargeMs: 0,
        input: mockInput,
      },
    },
    score: { host: 3, client: 2 },
  };

  it("encodes and decodes a GameState snapshot accurately", () => {
    const encoded = encodeMessage({ type: "state", snapshot: mockState });
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect((encoded as Uint8Array).length).toBe(121);

    const decoded = decodeMessage(encoded);
    expect(decoded?.type).toBe("state");
    if (decoded?.type === "state") {
      const s = decoded.snapshot;
      expect(s.t).toBeCloseTo(mockState.t, 2);
      expect(s.ball.x).toBeCloseTo(mockState.ball.x, 2);
      expect(s.ball.isPerfect).toBe(true);
      expect(s.ball.isBolt).toBe(false);
      expect(s.ball.possessedBy).toBe("host");
      expect(s.players.host.x).toBeCloseTo(mockState.players.host.x, 2);
      expect(s.players.host.input.slap).toBe(true);
      expect(s.players.client.input.slap).toBe(false);
      expect(s.score.host).toBe(3);
      expect(s.score.client).toBe(2);
    }
  });

  it("encodes and decodes a player input accurately", () => {
    const encoded = encodeMessage({ type: "input", seq: 1234, input: mockInput });
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect((encoded as Uint8Array).length).toBe(14);

    const decoded = decodeMessage(encoded);
    expect(decoded?.type).toBe("input");
    if (decoded?.type === "input") {
      expect(decoded.seq).toBe(1234);
      expect(decoded.input.moveX).toBeCloseTo(mockInput.moveX, 2);
      expect(decoded.input.wrist).toBe(true);
      expect(decoded.input.slap).toBe(false);
      expect(decoded.input.dash).toBe(true);
    }
  });

  it("correctly decodes binary messages from a sliced Uint8Array (non-zero byteOffset)", () => {
    const encoded = encodeMessage({ type: "input", seq: 5678, input: mockInput }) as Uint8Array;

    // Create a larger buffer and place the encoded message at an offset
    const padding = 10;
    const largerBuf = new ArrayBuffer(encoded.byteLength + padding * 2);
    const largerView = new Uint8Array(largerBuf);
    largerView.set(encoded, padding);

    const sliced = largerView.subarray(padding, padding + encoded.byteLength);
    expect(sliced.byteOffset).toBe(padding);

    const decoded = decodeMessage(sliced);
    expect(decoded?.type).toBe("input");
    if (decoded?.type === "input") {
      expect(decoded.seq).toBe(5678);
      expect(decoded.input.moveX).toBeCloseTo(mockInput.moveX, 2);
    }
  });

  it("encodes and decodes snapshots with boundary and large scores accurately", () => {
    const cases = [
      { host: 255, client: 255 },
      { host: 256, client: 1024 },
      { host: 1234, client: 5678 },
    ];
    for (const score of cases) {
      const state: GameState = { ...mockState, score };
      const encoded = encodeMessage({ type: "state", snapshot: state }) as Uint8Array;
      const decoded = decodeMessage(encoded);
      expect(decoded?.type).toBe("state");
      if (decoded?.type === "state") {
        expect(decoded.snapshot.score.host).toBe(score.host);
        expect(decoded.snapshot.score.client).toBe(score.client);
      }
    }
  });

  it("returns null for truncated binary payloads", () => {
    const encoded = encodeMessage({ type: "state", snapshot: mockState }) as Uint8Array;
    const truncated = encoded.subarray(0, 100); // 100 < 121
    expect(decodeMessage(truncated)).toBeNull();
  });

  it("returns null for unknown binary type bytes", () => {
    const invalid = new Uint8Array([0xFF, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(decodeMessage(invalid)).toBeNull();
  });

  it("falls back to JSON for other message types", () => {
    const msg = { type: "goal", scorer: "host" } as const;
    const encoded = encodeMessage(msg);
    expect(typeof encoded).toBe("string");
    expect(JSON.parse(encoded as string)).toEqual(msg);

    const decoded = decodeMessage(encoded as string);
    expect(decoded).toEqual(msg);
  });
});
