export type GameMode = "local" | "online";
export type Role = "host" | "client";

export interface InputState {
  moveX: number;
  moveY: number;
  slap: boolean;
  dash: boolean;
}

export const NEUTRAL_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  slap: false,
  dash: false,
};

export interface Player {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aimX: number;
  aimY: number;
  dashCooldownMs: number;
  dashCharges: number;
  lastDashTimeMs: number;
  chargeMs: number;
  heat: number;
  enFuegoTimerMs: number;
  input: InputState;
}

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  isPerfect?: boolean;
  isBolt?: boolean;
  isTrailblazer?: boolean;
  boltTimerMs?: number;
  isScoop?: boolean;
  scoopTimerMs?: number;
  possessedBy: string | null;
}

export interface GameState {
  t: number;
  ball: Ball;
  players: { host: Player; client: Player };
  score: { host: number; client: number };
}
