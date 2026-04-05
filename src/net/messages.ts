import type { InputState, GameState } from "../types/game";

// ─── Game DataChannel messages ─────────────────────────────────────────────────

export type GameMessage =
  | { type: "input"; seq: number; input: InputState }
  | { type: "state"; snapshot: GameState | ArrayBuffer }
  | { type: "start" }
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

export function encodeMessage(msg: GameMessage): string | ArrayBuffer {
  if (msg.type === "state" && !(msg.snapshot instanceof ArrayBuffer)) {
    return encodeSnapshot(msg.snapshot);
  }
  return JSON.stringify(msg);
}

export function decodeMessage(raw: string | ArrayBuffer): GameMessage | null {
  if (raw instanceof ArrayBuffer) {
    const snapshot = decodeSnapshot(raw);
    return snapshot ? { type: "state", snapshot } : null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isGameMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ─── Binary Snapshot Encoding (approx 126 bytes) ──────────────────────────────

export function encodeSnapshot(s: GameState): ArrayBuffer {
  const buf = new ArrayBuffer(126);
  const v = new DataView(buf);

  v.setFloat64(0, s.t);
  v.setFloat64(8, s.remainingTimeMs);

  // Ball
  v.setFloat32(16, s.ball.x);
  v.setFloat32(20, s.ball.y);
  v.setFloat32(24, s.ball.z);
  v.setFloat32(28, s.ball.vx);
  v.setFloat32(32, s.ball.vy);
  v.setFloat32(36, s.ball.vz);
  v.setUint8(40, s.ball.isPerfect ? 1 : 0);
  const posBy = s.ball.possessedBy === "host" ? 1 : s.ball.possessedBy === "client" ? 2 : 0;
  v.setUint8(41, posBy);

  // Players
  let off = 42;
  for (const role of ["host", "client"] as const) {
    const p = s.players[role];
    v.setFloat32(off, p.x); off += 4;
    v.setFloat32(off, p.y); off += 4;
    v.setFloat32(off, p.vx); off += 4;
    v.setFloat32(off, p.vy); off += 4;
    v.setFloat32(off, p.aimX); off += 4;
    v.setFloat32(off, p.aimY); off += 4;
    v.setFloat32(off, p.dashCooldownMs); off += 4;
    v.setFloat32(off, p.chargeMs); off += 4;
    v.setFloat32(off, p.input.moveX); off += 4;
    v.setFloat32(off, p.input.moveY); off += 4;
    let mask = 0;
    if (p.input.wrist) mask |= 1;
    if (p.input.slap)  mask |= 2;
    if (p.input.dash)  mask |= 4;
    v.setUint8(off, mask); off += 1;
  }

  // Score
  v.setUint8(124, s.score.host);
  v.setUint8(125, s.score.client);

  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): GameState | null {
  if (buf.byteLength < 126) return null;
  const v = new DataView(buf);

  const t = v.getFloat64(0);
  const remainingTimeMs = v.getFloat64(8);

  const ball = {
    x: v.getFloat32(16),
    y: v.getFloat32(20),
    z: v.getFloat32(24),
    vx: v.getFloat32(28),
    vy: v.getFloat32(32),
    vz: v.getFloat32(36),
    isPerfect: v.getUint8(40) === 1,
    possessedBy: [null, "host", "client"][v.getUint8(41)] as any,
  };

  const players: any = {};
  let off = 42;
  for (const role of ["host", "client"] as const) {
    const x = v.getFloat32(off); off += 4;
    const y = v.getFloat32(off); off += 4;
    const vx = v.getFloat32(off); off += 4;
    const vy = v.getFloat32(off); off += 4;
    const aimX = v.getFloat32(off); off += 4;
    const aimY = v.getFloat32(off); off += 4;
    const dashCooldownMs = v.getFloat32(off); off += 4;
    const chargeMs = v.getFloat32(off); off += 4;
    const moveX = v.getFloat32(off); off += 4;
    const moveY = v.getFloat32(off); off += 4;
    const mask = v.getUint8(off); off += 1;
    players[role] = {
      id: role,
      x, y, vx, vy, aimX, aimY, dashCooldownMs, chargeMs,
      input: {
        moveX, moveY,
        wrist: !!(mask & 1),
        slap:  !!(mask & 2),
        dash:  !!(mask & 4),
      },
    };
  }

  const score = {
    host: v.getUint8(124),
    client: v.getUint8(125),
  };

  return { t, remainingTimeMs, ball, players, score };
}
