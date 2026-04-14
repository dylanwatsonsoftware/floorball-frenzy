import type { InputState, GameState, Ball, Player } from "../types/game";

// ─── Game DataChannel messages ─────────────────────────────────────────────────

export type GameMessage =
  | { type: "input"; seq: number; input: InputState }
  | { type: "state"; snapshot: GameState }
  | { type: "start" }
  | { type: "goal"; scorer: "host" | "client" }
  | { type: "ping"; t: number }
  | { type: "pong"; t: number }
  | { type: "rematch" }
  | { type: "tutorial"; status: "start" | "end" };

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
    obj["type"] === "pong" ||
    obj["type"] === "rematch" ||
    obj["type"] === "tutorial"
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

  if (type === TYPE_STATE && (view.byteLength === 151 || view.byteLength === 155)) {
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

// ─── Binary Snapshot (151 bytes) ──────────────────────────────────────────────

function encodeSnapshot(s: GameState): Uint8Array {
  const buf = new ArrayBuffer(155);
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
  if (s.ball.isScoop) bFlags |= 4;
  if (s.ball.lastHitterEnFuego) bFlags |= 8;
  v.setUint8(29, bFlags);
  v.setFloat32(30, s.ball.boltTimerMs || 0, true);
  v.setUint8(34, s.ball.possessedBy === "host" ? 1 : s.ball.possessedBy === "client" ? 2 : 0);
  v.setFloat32(35, s.ball.scoopTimerMs || 0, true);

  // Players
  const writePlayer = (p: Player, offset: number) => {
    v.setFloat32(offset, p.x, true);
    v.setFloat32(offset + 4, p.y, true);
    v.setFloat32(offset + 8, p.vx, true);
    v.setFloat32(offset + 12, p.vy, true);
    v.setFloat32(offset + 16, p.aimX, true);
    v.setFloat32(offset + 20, p.aimY, true);
    v.setFloat32(offset + 24, p.dashCooldownMs, true);
    v.setUint8(offset + 28, p.dashCharges);
    v.setFloat32(offset + 29, p.chargeMs, true);
    v.setFloat32(offset + 33, p.input.moveX, true);
    v.setFloat32(offset + 37, p.input.moveY, true);
    let pFlags = 0;
    if (p.input.slap) pFlags |= 2;
    if (p.input.dash) pFlags |= 4;
    v.setUint8(offset + 41, pFlags);
    v.setFloat32(offset + 42, p.heat, true);
    v.setFloat32(offset + 46, p.enFuegoTimerMs, true);
    v.setFloat32(offset + 50, p.lastDashTimeMs, true);
    v.setUint8(offset + 54, Math.min(255, p.fakes));
    v.setUint8(offset + 55, Math.min(255, p.parries));
  };

  writePlayer(s.players.host, 39);
  writePlayer(s.players.client, 95);

  v.setUint16(151, s.score.host, true);
  v.setUint16(153, s.score.client, true);

  return new Uint8Array(buf);
}

function decodeSnapshot(v: DataView): GameState {
  const isExtended = v.byteLength === 155;
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
    isScoop: !!(bFlags & 4),
    lastHitterEnFuego: !!(bFlags & 8),
    boltTimerMs: v.getFloat32(30, true),
    possessedBy: bPoss === 1 ? "host" : bPoss === 2 ? "client" : null,
    scoopTimerMs: v.getFloat32(35, true),
  };

  const readPlayer = (offset: number, id: string): Player => {
    const pFlags = v.getUint8(offset + 41);
    return {
      id,
      x: v.getFloat32(offset, true),
      y: v.getFloat32(offset + 4, true),
      vx: v.getFloat32(offset + 8, true),
      vy: v.getFloat32(offset + 12, true),
      aimX: v.getFloat32(offset + 16, true),
      aimY: v.getFloat32(offset + 20, true),
      dashCooldownMs: v.getFloat32(offset + 24, true),
      dashCharges: v.getUint8(offset + 28),
      chargeMs: v.getFloat32(offset + 29, true),
      heat: v.getFloat32(offset + 42, true),
      enFuegoTimerMs: v.getFloat32(offset + 46, true),
      lastDashTimeMs: v.getFloat32(offset + 50, true),
      fakes: isExtended ? v.getUint8(offset + 54) : 0,
      parries: isExtended ? v.getUint8(offset + 55) : 0,
      input: {
        moveX: v.getFloat32(offset + 33, true),
        moveY: v.getFloat32(offset + 37, true),
        slap: !!(pFlags & 2),
        dash: !!(pFlags & 4),
      },
    };
  };

  return {
    t,
    ball,
    players: {
      host: readPlayer(39, "host"),
      client: readPlayer(isExtended ? 95 : 93, "client"),
    },
    score: {
      host: v.getUint16(isExtended ? 151 : 147, true),
      client: v.getUint16(isExtended ? 153 : 149, true),
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
      slap: !!(flags & 2),
      dash: !!(flags & 4),
    },
  };
}
