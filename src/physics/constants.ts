// ─── Arena ────────────────────────────────────────────────────────────────────
// Real rink: 40m × 20m  →  28 px/m  →  1120 × 560 px
// Canvas: 1280 × 720, field inset 80px each side (left/right), 80px top/bottom
export const PX_PER_M = 28;

export const FIELD_LEFT = 110;
export const FIELD_RIGHT = 1170; // 1060 px ≈ 37.9 m
export const FIELD_TOP = 100;
export const FIELD_BOTTOM = 620; // 520 px  ≈ 18.6 m

export const FIELD_WIDTH = FIELD_RIGHT - FIELD_LEFT;   // 1120
export const FIELD_HEIGHT = FIELD_BOTTOM - FIELD_TOP;  // 560

// Corner radius of the rounded rink boards: 1.5 m → 42 px
export const CORNER_RADIUS = Math.round(1.5 * PX_PER_M); // 42

// ─── Goals ────────────────────────────────────────────────────────────────────
// IFF goal mouth: 1.6 m wide (our y-span). Scaled to 2 m for arcade playability.
export const GOAL_MOUTH_M = 8.0;
export const GOAL_HEIGHT_PX = Math.round(GOAL_MOUTH_M * PX_PER_M); // 56 px

// Goal line sits 3 m from the end wall — leaves visible open space behind goal
export const GOAL_LINE_INSET = Math.round(3 * PX_PER_M); // 84 px
export const GOAL_LINE_LEFT  = FIELD_LEFT  + GOAL_LINE_INSET; // 194
export const GOAL_LINE_RIGHT = FIELD_RIGHT - GOAL_LINE_INSET; // 1086

// Goal cage extends 1.5 m back from the goal mouth toward the end wall.
// The remaining space (GOAL_LINE_INSET - GOAL_CAGE_DEPTH = 1.5 m) is open
// space behind the goal that players and the ball can freely enter.
export const GOAL_CAGE_DEPTH = Math.round(1.5 * PX_PER_M); // 42 px
export const GOAL_Z_THRESHOLD = 120; // ball.z must be below this to score (px)
export const GOAL_TOP    = (FIELD_TOP + FIELD_BOTTOM) / 2 - GOAL_HEIGHT_PX / 2;
export const GOAL_BOTTOM = GOAL_TOP + GOAL_HEIGHT_PX;

// ─── D-zone (crease) ──────────────────────────────────────────────────────────
// 4 m deep from goal line × 5 m tall, centred on goal
export const DZONE_DEPTH  = Math.round(4 * PX_PER_M); // 112 px
export const DZONE_HEIGHT = Math.round(5 * PX_PER_M); // 140 px
export const DZONE_TOP    = (FIELD_TOP + FIELD_BOTTOM) / 2 - DZONE_HEIGHT / 2;
export const DZONE_BOTTOM = DZONE_TOP + DZONE_HEIGHT;

// ─── Player ───────────────────────────────────────────────────────────────────
export const PLAYER_RADIUS    = 20;
export const PLAYER_MAX_SPEED = 700;
export const PLAYER_ACCEL     = 2800;
export const PLAYER_FRICTION  = 0.85;

// ─── Ball ─────────────────────────────────────────────────────────────────────
export const BALL_RADIUS    = 10;
export const BALL_FRICTION  = 0.92;
export const BALL_BOUNCE    = 0.8;
export const GRAVITY        = 900;
export const BALL_BOUNCE_Z  = 0.5;

// ─── Stick ────────────────────────────────────────────────────────────────────
// Stick extends beyond player body; tip is where ball contact happens.
export const STICK_LENGTH = 28; // px beyond player radius (~1 m)
// Max distance (player centre → ball centre) for a shot to connect
export const STICK_REACH  = PLAYER_RADIUS + STICK_LENGTH; // 48 px

// ─── Possession ───────────────────────────────────────────────────────────────
export const CONTROL_RADIUS = 40;

// ─── Dash ─────────────────────────────────────────────────────────────────────
export const DASH_FORCE    = 950;
export const DASH_COOLDOWN = 4000;

// ─── Shooting ─────────────────────────────────────────────────────────────────
export const SHOOT_BASE_POWER    = 500;  // was 400
export const SHOOT_POWER_SCALE   = 700;  // was 600
export const SHOOT_LIFT_SCALE    = 550;
export const SHOOT_MAX_CHARGE_MS = 800;

// ─── One-touch bonus ──────────────────────────────────────────────────────────
export const ONE_TOUCH_WINDOW      = 300;
export const ONE_TOUCH_MULTIPLIER  = 1.25;

// ─── Fixed timestep ───────────────────────────────────────────────────────────
export const FIXED_DT = 1 / 60;
