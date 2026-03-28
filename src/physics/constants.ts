// Arena dimensions (canvas: 1280x720)
export const FIELD_LEFT = 80;
export const FIELD_RIGHT = 1200;
export const FIELD_TOP = 80;
export const FIELD_BOTTOM = 640;

export const FIELD_WIDTH = FIELD_RIGHT - FIELD_LEFT;
export const FIELD_HEIGHT = FIELD_BOTTOM - FIELD_TOP;

// Goal dimensions (centered on left/right walls)
export const GOAL_DEPTH = 40; // how far the goal extends outward (visual)
export const GOAL_HEIGHT_PX = 140; // vertical span of goal mouth in game coords
export const GOAL_Z_THRESHOLD = 120; // ball.z must be below this to score
export const GOAL_TOP = (FIELD_TOP + FIELD_BOTTOM) / 2 - GOAL_HEIGHT_PX / 2;
export const GOAL_BOTTOM = GOAL_TOP + GOAL_HEIGHT_PX;

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
