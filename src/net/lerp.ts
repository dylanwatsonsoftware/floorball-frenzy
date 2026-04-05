import type { GameState } from "../types/game";

/**
 * Linearly interpolate a GameState snapshot onto current state.
 * `t` in [0, 1]: 0 = keep current, 1 = fully adopt snapshot.
 */
export function lerpState(current: GameState, snapshot: GameState, t: number): void {
  const lerp = (a: number, b: number) => a + (b - a) * t;

  current.t = snapshot.t;

  current.ball.x = lerp(current.ball.x, snapshot.ball.x);
  current.ball.y = lerp(current.ball.y, snapshot.ball.y);
  current.ball.z = lerp(current.ball.z, snapshot.ball.z);
  current.ball.vx = lerp(current.ball.vx, snapshot.ball.vx);
  current.ball.vy = lerp(current.ball.vy, snapshot.ball.vy);
  current.ball.vz = lerp(current.ball.vz, snapshot.ball.vz);
  current.ball.isPerfect = snapshot.ball.isPerfect;

  for (const role of ["host", "client"] as const) {
    current.players[role].x = lerp(current.players[role].x, snapshot.players[role].x);
    current.players[role].y = lerp(current.players[role].y, snapshot.players[role].y);
    current.players[role].vx = lerp(current.players[role].vx, snapshot.players[role].vx);
    current.players[role].vy = lerp(current.players[role].vy, snapshot.players[role].vy);
    current.players[role].input = { ...snapshot.players[role].input };
  }

  current.score.host = snapshot.score.host;
  current.score.client = snapshot.score.client;
}
