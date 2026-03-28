import { describe, it, expect } from "vitest";
import {
  isGameMessage,
  isSignalMessage,
  encodeMessage,
  decodeMessage,
} from "../src/net/messages";
import type { GameMessage } from "../src/net/messages";

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
  const cases: GameMessage[] = [
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
