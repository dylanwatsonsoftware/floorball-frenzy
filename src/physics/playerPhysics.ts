import type { Player, InputState } from "../types/game";
import {
  PLAYER_MAX_SPEED,
  PLAYER_ACCEL,
  PLAYER_FRICTION,
  PLAYER_RADIUS,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FIELD_BOTTOM,
  DASH_FORCE,
  DASH_COOLDOWN,
  MAX_DASH_CHARGES,
  HEAT_DECAY_RATE,
  EN_FUEGO_SPEED_BOOST,
} from "./constants";

export interface PlayerExtended extends Player {}

/**
 * Advance player state by dt seconds given the current input.
 * dashCooldownMs is decremented here; caller supplies the elapsed ms.
 */
export function stepPlayer(
  player: PlayerExtended,
  input: InputState,
  dt: number,
  elapsedMs: number,
  totalTimeMs = 0
): void {
  // Heat decay
  if (player.enFuegoTimerMs <= 0) {
    player.heat = Math.max(0, player.heat - HEAT_DECAY_RATE * dt);
  } else {
    player.enFuegoTimerMs = Math.max(0, player.enFuegoTimerMs - elapsedMs);
    if (player.enFuegoTimerMs <= 0) {
      player.heat = 0;
    }
    // En Fuego grants instant dash recharge
    if (player.dashCharges < MAX_DASH_CHARGES) {
      player.dashCooldownMs = 0;
    }
  }

  // Dash cooldown countdown
  if (player.dashCharges < MAX_DASH_CHARGES) {
    player.dashCooldownMs = Math.max(0, player.dashCooldownMs - elapsedMs);
    if (player.dashCooldownMs <= 0) {
      player.dashCharges++;
      if (player.dashCharges < MAX_DASH_CHARGES) {
        player.dashCooldownMs = DASH_COOLDOWN;
      } else {
        player.dashCooldownMs = 0;
      }
    }
  }

  // Dash impulse — direction is move input; caller injects aim when standing still
  if (input.dash && player.dashCharges > 0) {
    const len = Math.hypot(input.moveX, input.moveY);
    if (len > 0) {
      player.vx += (input.moveX / len) * DASH_FORCE;
      player.vy += (input.moveY / len) * DASH_FORCE;
    }
    player.dashCharges--;
    player.lastDashTimeMs = totalTimeMs;
    if (player.dashCooldownMs <= 0) {
      player.dashCooldownMs = DASH_COOLDOWN;
    }
  }

  // Fake Shot (Deceptive Dash)
  const speedForFake = Math.hypot(player.vx, player.vy);
  const inputLen = Math.hypot(input.moveX, input.moveY);
  if (player.chargeMs > 200 && speedForFake > 100 && inputLen > 0.1) {
    const dot = (player.vx / speedForFake) * (input.moveX / inputLen) + (player.vy / speedForFake) * (input.moveY / inputLen);
    if (dot < -0.8) {
      player.vx += (input.moveX / inputLen) * DASH_FORCE * 0.6;
      player.vy += (input.moveY / inputLen) * DASH_FORCE * 0.6;
      player.lastFakeShotTimeMs = totalTimeMs;
      player.fakes = (player.fakes || 0) + 1;
      // We don't reset chargeMs here as it's owned by ShootState in GameScene
    }
  }

  // Acceleration from input
  if (input.moveX !== 0 || input.moveY !== 0) {
    const len = Math.hypot(input.moveX, input.moveY);
    player.vx += (input.moveX / len) * PLAYER_ACCEL * dt;
    player.vy += (input.moveY / len) * PLAYER_ACCEL * dt;
  }

  // Clamp to max speed
  const speed = Math.hypot(player.vx, player.vy);
  const maxSpeed = player.enFuegoTimerMs > 0 ? (PLAYER_MAX_SPEED * EN_FUEGO_SPEED_BOOST) : PLAYER_MAX_SPEED;
  if (speed > maxSpeed) {
    const scale = maxSpeed / speed;
    player.vx *= scale;
    player.vy *= scale;
  }

  // Friction (always)
  player.vx *= PLAYER_FRICTION;
  player.vy *= PLAYER_FRICTION;

  // Integrate position
  player.x += player.vx * dt;
  player.y += player.vy * dt;

  // Clamp within field bounds
  player.x = Math.max(FIELD_LEFT + PLAYER_RADIUS, Math.min(FIELD_RIGHT - PLAYER_RADIUS, player.x));
  player.y = Math.max(FIELD_TOP + PLAYER_RADIUS, Math.min(FIELD_BOTTOM - PLAYER_RADIUS, player.y));
}

/**
 * Create a PlayerExtended at the given starting position.
 */
export function createPlayer(id: string, x: number, y: number): PlayerExtended {
  return {
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    aimX: 1,
    aimY: 0,
    dashCooldownMs: 0,
    dashCharges: MAX_DASH_CHARGES,
    lastDashTimeMs: -1000,
    chargeMs: 0,
    heat: 0,
    enFuegoTimerMs: 0,
    lastFakeShotTimeMs: -1000,
    fakes: 0,
    input: { moveX: 0, moveY: 0, slap: false, dash: false },
  };
}
