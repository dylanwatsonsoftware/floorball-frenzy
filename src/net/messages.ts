import type { InputState, GameState } from "../types/game";

// ─── Game DataChannel messages ─────────────────────────────────────────────────

export type GameMessage =
  | { type: "input"; seq: number; input: InputState }
  | { type: "state"; snapshot: GameState }
  | { type: "start" }
  | { type: "rematch" }
  | { type: "goal"; scorer: "host" | "client" }
  | { type: "ping"; t: number }
  | { type: "pong"; t: number };

// ─── Signaling messages (sent through the Vercel KV relay) ────────────────────

export type SignalMessage =
  | { type: "offer"; sdp: string; roomId: string }
  | { type: "answer"; sdp: string; roomId: string }
  | { type: "ice"; candidate: RTCIceCandidateInit; roomId: string };

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isGameMessage(v: unknown): v is GameMessage {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    obj["type"] === "input" ||
    obj["type"] === "state" ||
    obj["type"] === "start" ||
    obj["type"] === "rematch" ||
    obj["type"] === "goal" ||
    obj["type"] === "ping" ||
    obj["type"] === "pong"
  );
}

export function isSignalMessage(v: unknown): v is SignalMessage {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    (obj["type"] === "offer" || obj["type"] === "answer" || obj["type"] === "ice") &&
    typeof obj["roomId"] === "string"
  );
}

// ─── Serialisation helpers ────────────────────────────────────────────────────

export function encodeMessage(msg: GameMessage): string {
  return JSON.stringify(msg);
}

export function decodeMessage(raw: string): GameMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isGameMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
