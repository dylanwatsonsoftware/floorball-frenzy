import type { InputState, GameState, Ball, Player } from "../types/game";

// ─── Game DataChannel messages ─────────────────────────────────────────────────

export type GameMessage =
  | { type: "input"; seq: number; input: InputState }
  | { type: "state"; snapshot: GameState }
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

const TYPE_STATE = 0x01;
const TYPE_INPUT = 0x02;

export function encodeMessage(msg: GameMessage): string | Uint8Array {
  if (msg.type === "state") {
    return encodeSnapshot(msg.snapshot);
  }
  if (msg.type === "input") {
    return encodeInput(msg.seq, msg.input);
  }
  return JSON.stringify(msg);
}

export function decodeMessage(raw: string | ArrayBufferLike | Uint8Array): GameMessage | null {
  if (typeof raw !== "string") {
    const view = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const type = view[0];
    const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);

    if (type === TYPE_STATE && view.byteLength === 121) {
      return { type: "state", snapshot: decodeSnapshot(dv) };
    }
    if (type === TYPE_INPUT && view.byteLength === 14) {
      const { seq, input } = decodeInput(dv);
      return { type: "input", seq, input };
    }
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isGameMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ─── Binary Snapshot (121 bytes) ──────────────────────────────────────────────

function encodeSnapshot(s: GameState): Uint8Array {
  const buf = new ArrayBuffer(121);
  const v = new DataView(buf);
  v.setUint8(0, TYPE_STATE);
  v.setFloat32(1, s.t, true);

  // Ball (pos 5)
  v.setFloat32(5, s.ball.x, true);
  v.setFloat32(9, s.ball.y, true);
  v.setFloat32(13, s.ball.z, true);
  v.setFloat32(17, s.ball.vx, true);
  v.setFloat32(21, s.ball.vy, true);
  v.setFloat32(25, s.ball.vz, true);
  let bFlags = 0;
  if (s.ball.isPerfect) bFlags |= 1;
  if (s.ball.isBolt) bFlags |= 2;
  v.setUint8(29, bFlags);
  v.setFloat32(30, s.ball.boltTimerMs || 0, true);
  v.setUint8(34, s.ball.possessedBy === "host" ? 1 : s.ball.possessedBy === "client" ? 2 : 0);

  // Players
  const writePlayer = (p: Player, offset: number) => {
    v.setFloat32(offset, p.x, true);
    v.setFloat32(offset + 4, p.y, true);
    v.setFloat32(offset + 8, p.vx, true);
    v.setFloat32(offset + 12, p.vy, true);
    v.setFloat32(offset + 16, p.aimX, true);
    v.setFloat32(offset + 20, p.aimY, true);
    v.setFloat32(offset + 24, p.dashCooldownMs, true);
    v.setFloat32(offset + 28, p.chargeMs, true);
    v.setFloat32(offset + 32, p.input.moveX, true);
    v.setFloat32(offset + 36, p.input.moveY, true);
    let pFlags = 0;
    if (p.input.wrist) pFlags |= 1;
    if (p.input.slap) pFlags |= 2;
    if (p.input.dash) pFlags |= 4;
    v.setUint8(offset + 40, pFlags);
  };

  writePlayer(s.players.host, 35);
  writePlayer(s.players.client, 76);

  v.setUint16(117, s.score.host, true);
  v.setUint16(119, s.score.client, true);

  return new Uint8Array(buf);
}

function decodeSnapshot(v: DataView): GameState {
  const t = v.getFloat32(1, true);

  const bFlags = v.getUint8(29);
  const bPoss = v.getUint8(34);
  const ball: Ball = {
    x: v.getFloat32(5, true),
    y: v.getFloat32(9, true),
    z: v.getFloat32(13, true),
    vx: v.getFloat32(17, true),
    vy: v.getFloat32(21, true),
    vz: v.getFloat32(25, true),
    isPerfect: !!(bFlags & 1),
    isBolt: !!(bFlags & 2),
    boltTimerMs: v.getFloat32(30, true),
    possessedBy: bPoss === 1 ? "host" : bPoss === 2 ? "client" : null,
  };

  const readPlayer = (offset: number, id: string): Player => {
    const pFlags = v.getUint8(offset + 40);
    return {
      id,
      x: v.getFloat32(offset, true),
      y: v.getFloat32(offset + 4, true),
      vx: v.getFloat32(offset + 8, true),
      vy: v.getFloat32(offset + 12, true),
      aimX: v.getFloat32(offset + 16, true),
      aimY: v.getFloat32(offset + 20, true),
      dashCooldownMs: v.getFloat32(offset + 24, true),
      chargeMs: v.getFloat32(offset + 28, true),
      input: {
        moveX: v.getFloat32(offset + 32, true),
        moveY: v.getFloat32(offset + 36, true),
        wrist: !!(pFlags & 1),
        slap: !!(pFlags & 2),
        dash: !!(pFlags & 4),
      },
    };
  };

  return {
    t,
    ball,
    players: {
      host: readPlayer(35, "host"),
      client: readPlayer(76, "client"),
    },
    score: {
      host: v.getUint16(117, true),
      client: v.getUint16(119, true),
    },
  };
}

// ─── Binary Input (14 bytes) ──────────────────────────────────────────────────

function encodeInput(seq: number, i: InputState): Uint8Array {
  const buf = new ArrayBuffer(14);
  const v = new DataView(buf);
  v.setUint8(0, TYPE_INPUT);
  v.setUint32(1, seq, true);
  v.setFloat32(5, i.moveX, true);
  v.setFloat32(9, i.moveY, true);
  let flags = 0;
  if (i.wrist) flags |= 1;
  if (i.slap) flags |= 2;
  if (i.dash) flags |= 4;
  v.setUint8(13, flags);
  return new Uint8Array(buf);
}

function decodeInput(v: DataView): { seq: number; input: InputState } {
  const seq = v.getUint32(1, true);
  const flags = v.getUint8(13);
  return {
    seq,
    input: {
      moveX: v.getFloat32(5, true),
      moveY: v.getFloat32(9, true),
      wrist: !!(flags & 1),
      slap: !!(flags & 2),
      dash: !!(flags & 4),
    },
  };
}
