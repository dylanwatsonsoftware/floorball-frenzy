// ─── Arena ────────────────────────────────────────────────────────────────────
// Real rink: 40m × 20m  →  28 px/m  →  1120 × 560 px
// Canvas: 1280 × 720, field inset 80px each side (left/right), 80px top/bottom
export const PX_PER_M = 28;

export const FIELD_LEFT = 80;
export const FIELD_RIGHT = 1200; // 1120 px = 40 m ✓
export const FIELD_TOP = 80;
export const FIELD_BOTTOM = 640; // 560 px  = 20 m ✓

export const FIELD_WIDTH = FIELD_RIGHT - FIELD_LEFT;   // 1120
export const FIELD_HEIGHT = FIELD_BOTTOM - FIELD_TOP;  // 560

// Corner radius of the rounded rink boards: 1.5 m → 42 px
export const CORNER_RADIUS = Math.round(1.5 * PX_PER_M); // 42

// ─── Goals ────────────────────────────────────────────────────────────────────
// IFF goal mouth: 1.6 m wide (our y-span), ~0.65 m deep net (our x-span)
// Scaled up slightly to 2 m wide for arcade playability
export const GOAL_MOUTH_M = 2.0; // metres (real = 1.6 m)
export const GOAL_HEIGHT_PX = Math.round(GOAL_MOUTH_M * PX_PER_M); // 56 px
export const GOAL_DEPTH = Math.round(0.65 * PX_PER_M); // 18 px net depth
export const GOAL_Z_THRESHOLD = 120; // ball.z must be below this to score (px)
export const GOAL_TOP = (FIELD_TOP + FIELD_BOTTOM) / 2 - GOAL_HEIGHT_PX / 2;
export const GOAL_BOTTOM = GOAL_TOP + GOAL_HEIGHT_PX;

// ─── D-zone (crease) ──────────────────────────────────────────────────────────
// 4 m deep from end wall × 5 m tall, centred on goal
export const DZONE_DEPTH = Math.round(4 * PX_PER_M);  // 112 px
export const DZONE_HEIGHT = Math.round(5 * PX_PER_M); // 140 px
export const DZONE_TOP = (FIELD_TOP + FIELD_BOTTOM) / 2 - DZONE_HEIGHT / 2;
export const DZONE_BOTTOM = DZONE_TOP + DZONE_HEIGHT;

// Player
export const PLAYER_RADIUS = 20;
export const PLAYER_MAX_SPEED = 300;
export const PLAYER_ACCEL = 1200;
export const PLAYER_FRICTION = 0.85; // applied per frame to damp velocity

// Ball
export const BALL_RADIUS = 10;
export const BALL_FRICTION = 0.92; // per-frame horizontal friction multiplier
export const BALL_BOUNCE = 0.8; // wall bounce restitution (xy)
export const GRAVITY = 900;
export const BALL_BOUNCE_Z = 0.5; // vertical bounce restitution

// Possession
export const CONTROL_RADIUS = 40;

// Dash
export const DASH_FORCE = 400;
export const DASH_COOLDOWN = 1000; // ms

// Shooting
export const SHOOT_BASE_POWER = 400;
export const SHOOT_POWER_SCALE = 600;
export const SHOOT_LIFT_SCALE = 300;
export const SHOOT_MAX_CHARGE_MS = 800;

// One-touch bonus
export const ONE_TOUCH_WINDOW = 300; // ms
export const ONE_TOUCH_MULTIPLIER = 1.25;

// Fixed timestep
export const FIXED_DT = 1 / 60;
