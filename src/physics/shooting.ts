import type { Ball } from "../types/game";
import {
  SHOOT_BASE_POWER,
  SHOOT_POWER_SCALE,
  SHOOT_LIFT_SCALE,
  SHOOT_MAX_CHARGE_MS,
  ONE_TOUCH_MULTIPLIER,
} from "./constants";

export interface ShootState {
  chargeMs: number;
  charging: boolean;
}

export function createShootState(): ShootState {
  return { chargeMs: 0, charging: false };
}

/**
 * Call every fixed-step frame. Accumulates charge while slap is held.
 */
export function updateShootCharge(
  state: ShootState,
  slapHeld: boolean,
  elapsedMs: number
): void {
  if (slapHeld) {
    state.charging = true;
    state.chargeMs = Math.min(state.chargeMs + elapsedMs, SHOOT_MAX_CHARGE_MS);
  } else {
    state.charging = false;
  }
}

/**
 * Fire a charged slap shot. Call when slap button is released.
 * Resets charge to 0 after firing.
 */
export function releaseShot(
  state: ShootState,
  ball: Ball,
  aimX: number,
  aimY: number,
  oneTouch: boolean,
  playerVx = 0,
  playerVy = 0,
): void {
  const charge = state.chargeMs / SHOOT_MAX_CHARGE_MS; // 0..1
  let power = SHOOT_BASE_POWER + charge * SHOOT_POWER_SCALE;
  if (oneTouch) power *= ONE_TOUCH_MULTIPLIER;

  // Normalise aim direction
  const len = Math.hypot(aimX, aimY);
  const nx = len > 0 ? aimX / len : 1;
  const ny = len > 0 ? aimY / len : 0;

  // Add player momentum so moving shots feel natural
  ball.vx = nx * power + playerVx;
  ball.vy = ny * power + playerVy;
  ball.vz = charge * SHOOT_LIFT_SCALE;

  state.chargeMs = 0;
  state.charging = false;
}

/**
 * Instant wrist shot — base power, no lift, no charge needed.
 */
export function wristShot(
  ball: Ball,
  aimX: number,
  aimY: number,
  oneTouch: boolean
): void {
  let power = SHOOT_BASE_POWER;
  if (oneTouch) power *= ONE_TOUCH_MULTIPLIER;

  const len = Math.hypot(aimX, aimY);
  const nx = len > 0 ? aimX / len : 1;
  const ny = len > 0 ? aimY / len : 0;

  ball.vx = nx * power;
  ball.vy = ny * power;
  ball.vz = 0;
}
