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
  HEAT_MAX,
  HEAT_MODE_SPEED_BOOST,
  HEAT_DASH_BONUS,
} from "./constants";

export interface PlayerExtended extends Player {
  dashCooldownMs: number;
}

/**
 * Advance player state by dt seconds given the current input.
 * dashCooldownMs is decremented here; caller supplies the elapsed ms.
 */
export function stepPlayer(
  player: PlayerExtended,
  input: InputState,
  dt: number,
  elapsedMs: number
): boolean {
  let heatTriggered = false;

  // Heat Mode decay
  if (player.heatModeMs > 0) {
    player.heatModeMs = Math.max(0, player.heatModeMs - elapsedMs);
    if (player.heatModeMs === 0) {
      player.heat = 0; // Reset heat when mode ends
    }
  }

  // Dash cooldown countdown
  if (player.dashCooldownMs > 0) {
    player.dashCooldownMs = Math.max(0, player.dashCooldownMs - elapsedMs);
  }

  const isHeatMode = player.heatModeMs > 0;

  // Dash impulse — direction is move input; caller injects aim when standing still
  if (input.dash && player.dashCooldownMs === 0) {
    const len = Math.hypot(input.moveX, input.moveY);
    if (len > 0) {
      player.vx += (input.moveX / len) * DASH_FORCE;
      player.vy += (input.moveY / len) * DASH_FORCE;
    }
    // Set base cooldown; shared handler will apply multiplier if heat triggers
    player.dashCooldownMs = DASH_COOLDOWN;

    // Heat accumulation from dash
    if (!isHeatMode) {
      player.heat = Math.min(HEAT_MAX, player.heat + HEAT_DASH_BONUS);
      if (player.heat >= HEAT_MAX) {
        heatTriggered = true;
      }
    }
  }

  // Acceleration from input
  if (input.moveX !== 0 || input.moveY !== 0) {
    const len = Math.hypot(input.moveX, input.moveY);
    player.vx += (input.moveX / len) * PLAYER_ACCEL * dt;
    player.vy += (input.moveY / len) * PLAYER_ACCEL * dt;
  }

  // Clamp to max speed
  const maxSpeed = isHeatMode ? PLAYER_MAX_SPEED * HEAT_MODE_SPEED_BOOST : PLAYER_MAX_SPEED;
  const speed = Math.hypot(player.vx, player.vy);
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

  return heatTriggered;
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
    chargeMs: 0,
    heat: 0,
    heatModeMs: 0,
    input: { moveX: 0, moveY: 0, slap: false, dash: false },
  };
}
