import type { Ball } from "../types/game";
import {
  SHOOT_BASE_POWER,
  SHOOT_POWER_SCALE,
  SHOOT_LIFT_SCALE,
  SHOOT_MAX_CHARGE_MS,
  ONE_TOUCH_MULTIPLIER,
  PERFECT_SHOT_WINDOW,
  PERFECT_SHOT_BOOST,
  WRIST_SNAP_MAX_CHARGE,
  WRIST_SNAP_MIN_SPEED_FRAC,
  PLAYER_MAX_SPEED,
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
 * chargeMs is allowed to exceed SHOOT_MAX_CHARGE_MS so overcharge is detectable.
 */
export function updateShootCharge(
  state: ShootState,
  slapHeld: boolean,
  elapsedMs: number
): void {
  if (slapHeld) {
    state.charging = true;
    // Allow up to 2× max so overcharge can be detected by releaseShot
    state.chargeMs = Math.min(state.chargeMs + elapsedMs, SHOOT_MAX_CHARGE_MS * 2);
  } else {
    state.charging = false;
  }
}

/**
 * Fire a charged slap shot. Call when slap button is released.
 *
 * Power curve (triangle):
 *   0 → SHOOT_MAX_CHARGE_MS  : ramps from base to base + SHOOT_POWER_SCALE
 *   SHOOT_MAX_CHARGE_MS → 2× : ramps back down to base (overcharge penalty)
 *
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
  isHeatMode = false
): { isPerfect: boolean; isWristSnap: boolean } {
  const playerSpeed = Math.hypot(playerVx, playerVy);
  const isWristSnap = state.chargeMs > 0 &&
                      state.chargeMs < WRIST_SNAP_MAX_CHARGE &&
                      playerSpeed > PLAYER_MAX_SPEED * WRIST_SNAP_MIN_SPEED_FRAC;

  let isPerfect = Math.abs(state.chargeMs - SHOOT_MAX_CHARGE_MS) < PERFECT_SHOT_WINDOW;

  // Heat mode or Wrist Snap automatically makes it a "Perfect" shot (Thunder Slap/Snap)
  if (isHeatMode || isWristSnap) isPerfect = true;

  const t = Math.min(state.chargeMs / SHOOT_MAX_CHARGE_MS, 2); // 0..2
  // Triangle: ramp up 0→1, ramp down 1→2
  let chargeFrac = t <= 1 ? t : 2 - t;

  // Wrist snap uses a minimum charge fraction for power if it triggered
  if (isWristSnap && chargeFrac < 0.3) chargeFrac = 0.3;

  let power = SHOOT_BASE_POWER + chargeFrac * SHOOT_POWER_SCALE;
  if (oneTouch) power *= ONE_TOUCH_MULTIPLIER;
  if (isWristSnap) power *= 1.15;
  if (isPerfect) power *= PERFECT_SHOT_BOOST;

  const len = Math.hypot(aimX, aimY);
  const nx = len > 0 ? aimX / len : 1;
  const ny = len > 0 ? aimY / len : 0;

  ball.vx = nx * power + playerVx;
  ball.vy = ny * power + playerVy;
  ball.vz = chargeFrac * SHOOT_LIFT_SCALE;

  state.chargeMs = 0;
  state.charging = false;

  return { isPerfect, isWristSnap };
}
