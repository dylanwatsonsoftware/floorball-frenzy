export type GameMode = "local" | "online";
export type Role = "host" | "client";

export interface InputState {
  moveX: number;
  moveY: number;
  wrist: boolean;
  slap: boolean;
  dash: boolean;
}

export interface Player {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
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
}

export interface GameState {
  t: number;
  ball: Ball;
  players: { host: Player; client: Player };
  score: { host: number; client: number };
}
