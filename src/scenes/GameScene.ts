import Phaser from "phaser";
import type { Ball, GameMode, InputState } from "../types/game";
import { NEUTRAL_INPUT } from "../types/game";
import type { PlayerExtended } from "../physics/playerPhysics";
import { createPlayer, stepPlayer } from "../physics/playerPhysics";
import { stepBall, resetBall, applyPossessionAssist } from "../physics/ballPhysics";
import {
  resolvePlayerBallCollision,
  resolveStickTipCollision,
  resolvePlayerPlayerCollision,
  resolvePlayerEnvironment,
} from "../physics/collision";
import { stickDir as stickDirPure, ballInRange } from "../physics/stickUtils";
import {
  createShootState,
  updateShootCharge,
  releaseShot,
} from "../physics/shooting";
import type { ShootState } from "../physics/shooting";
import { getNextAIInput } from "../physics/simpleAI";
import { VirtualJoystick } from "../ui/VirtualJoystick";
import { ActionButtons } from "../ui/ActionButtons";
import {
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FIELD_BOTTOM,
  GOAL_TOP,
  GOAL_BOTTOM,
  GOAL_LINE_LEFT,
  GOAL_LINE_RIGHT,
  PLAYER_RADIUS,
  PLAYER_MAX_SPEED,
  BALL_RADIUS,
  FIXED_DT,
  ONE_TOUCH_WINDOW,
  SHOOT_MAX_CHARGE_MS as SHOOT_MAX_CHARGE_MS_LOCAL,
  CORNER_RADIUS,
  DZONE_DEPTH,
  DZONE_TOP,
  DZONE_BOTTOM,
  GOAL_CAGE_DEPTH,
  HOUSE_DEPTH,
  HOUSE_TOP,
  HOUSE_BOTTOM,
  PX_PER_M,
  STICK_REACH,
  DASH_COOLDOWN,
  MAX_DASH_CHARGES,
  DASH_STEAL_WINDOW,
  DASH_STEAL_FORCE,
  BOLT_SHOT_BOOST,
  BOLT_SHOT_DURATION_MS,
  MAX_HEAT,
  HEAT_GAIN_PERFECT,
  HEAT_GAIN_STEAL,
  HEAT_GAIN_DASH,
  HEAT_GAIN_GOAL,
  EN_FUEGO_DURATION_MS,
  POSSESSION_PULL_FACTOR,
  POSSESSION_PULL_CAP,
  COLOR_RED,
  COLOR_BLUE,
  COLOR_RED_STR,
  COLOR_BLUE_STR,
} from "../physics/constants";

const WINNING_SCORE = 5;

/** Tracks the last player to touch the ball for one-touch bonus. */
interface LastTouch {
  playerId: string;
  timeMs: number;
}

export class GameScene extends Phaser.Scene {
  protected _mode: GameMode = "local";

  // Entities
  protected host!: PlayerExtended;
  protected client!: PlayerExtended;
  protected ball!: Ball;

  // Score
  protected score = { host: 0, client: 0 };

  // Shooting state per player
  protected _hostShoot!: ShootState;
  protected _clientShoot!: ShootState;

  // Last aim direction per player (used when shooting)
  protected _hostAim = { x: 1, y: 0 };
  protected _clientAim = { x: -1, y: 0 };

  // Smoothed aim used for stick direction/rendering — capped at 45°/step
  // to prevent instant 180° flips that drop the ball.
  protected _hostAimSmooth = { x: 1, y: 0 };
  protected _clientAimSmooth = { x: -1, y: 0 };

  // One-touch tracking
  private _lastTouch: LastTouch = { playerId: "", timeMs: 0 };
  protected _elapsedMs = 0; // total game time in ms

  // Was slap held last frame? (to detect release)
  protected _hostSlapWasDown = false;
  protected _clientSlapWasDown = false;

  // After firing a shot, skip possession for this many ms so the ball escapes
  protected _hostShotCooldownMs = 0;
  protected _clientShotCooldownMs = 0;
  private static readonly SHOT_COOLDOWN_MS = 200;

  // Touch UI (present on mobile; keyboard still works on desktop)
  protected _hostJoy!: VirtualJoystick;
  protected _hostButtons!: ActionButtons;
  protected _controlMode: "stick" | "follow" = "stick";

  // Graphics / display objects
  private _field!: Phaser.GameObjects.Graphics;
  private _hostStickSprite!: Phaser.GameObjects.Sprite;
  private _clientStickSprite!: Phaser.GameObjects.Sprite;
  private _hostSprite!: Phaser.GameObjects.Sprite;
  private _clientSprite!: Phaser.GameObjects.Sprite;
  private _ballGraphics!: Phaser.GameObjects.Graphics;
  private _indicatorGraphics!: Phaser.GameObjects.Graphics;
  private _underPlayerGraphics!: Phaser.GameObjects.Graphics;
  // Ball orientation as quaternion [w, x, y, z]; updated each frame via rolling rotation
  protected _ballQuat: [number, number, number, number] = [1, 0, 0, 0];

  protected static readonly DRIBBLE_AMP = 22;          // px half-sweep width
  protected static readonly DRIBBLE_FREQ = 3.2;         // tic-tacs per second
  protected static readonly DRIBBLE_DIST = STICK_REACH * 0.91; // how far in front

  // 16 dot positions on a unit sphere (Fibonacci spiral — evenly spread, ~8 visible per frame)
  protected static readonly BALL_DOTS: [number, number, number][] = (() => {
    const n = 26;
    const φ = Math.PI * (3 - Math.sqrt(5)); // golden angle
    return Array.from({ length: n }, (_, i) => {
      const z = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const θ = φ * i;
      return [Math.cos(θ) * r, Math.sin(θ) * r, z] as [number, number, number];
    });
  })();
  private _ballShadow!: Phaser.GameObjects.Arc;
  private _dashRingGfx!: Phaser.GameObjects.Graphics;
  private _hudOverlayGfx!: Phaser.GameObjects.Graphics;
  private _fireGraphics!: Phaser.GameObjects.Graphics;
  private _fireParticles: Array<{
    x: number; y: number; vx: number; vy: number;
    life: number; maxLife: number; size: number;
  }> = [];
  private _scoreText!: Phaser.GameObjects.Text;
  protected _messageText!: Phaser.GameObjects.Text;
  private _hudGfx!: Phaser.GameObjects.Graphics;
  private _teamLabelRed!: Phaser.GameObjects.Text;
  private _teamLabelBlue!: Phaser.GameObjects.Text;
  private _scoreEyebrow!: Phaser.GameObjects.Text;
  private _backBtnObjs: Phaser.GameObjects.GameObject[] = [];
  private _helpBtn!: Phaser.GameObjects.Arc;
  private _helpText!: Phaser.GameObjects.Text;

  protected _addUI(objs: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]): void {
    const arr = Array.isArray(objs) ? objs : [objs];
    this.cameras.main.ignore(arr);
  }

  // Fixed timestep accumulator
  private _accumulator = 0;

  // Frozen while showing goal message
  protected _frozenMs = 0;
  // If true, the current freeze is for a goal/score (which resets the round)
  protected _isGoalPause = false;

  // Shot animation (countdown ms per player; used by _drawSticks)
  protected _hostShotAnimMs = 0;
  protected _clientShotAnimMs = 0;

  // Dash ghosting
  private _ghosts: Array<{
    x: number;
    y: number;
    rotation: number;
    frame: number;
    alpha: number;
    life: number;
    color: number;
  }> = [];
  private static readonly GHOST_LIFETIME = 360;
  private _ghostGraphics!: Phaser.GameObjects.Graphics;

  // Dribble state
  protected _hostDribblePhase = 0;
  protected _clientDribblePhase = 0;
  protected _hostHasPossession = false;
  protected _clientHasPossession = false;

  protected _matchOverObjects: Phaser.GameObjects.GameObject[] = [];
  protected _rematchBtn: Phaser.GameObjects.Rectangle | null = null;
  protected _rematchBtnText: Phaser.GameObjects.Text | null = null;

  // AI start delay for local matches
  protected _aiDelayMs = 2000;
  protected _playerTouched = false;
  // Camera targets
  protected _camZoom = 1;
  protected _camX = 640;
  protected _camY = 360;
  protected _hasReceivedInput = false;
  protected _uiCam!: Phaser.Cameras.Scene2D.Camera;

  protected get _isAuthoritative(): boolean {
    return this._mode === "local";
  }


  // Keys
  protected _wasd!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    dash: Phaser.Input.Keyboard.Key;
    slap: Phaser.Input.Keyboard.Key;
  };
  protected _arrows!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    dash: Phaser.Input.Keyboard.Key;
    slap: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { mode: GameMode }): void {
    this._controlMode = (localStorage.getItem("floorball:controls") as "stick" | "follow") || "stick";
    this._mode = data.mode ?? "local";
    this.score = { host: 0, client: 0 };
    this._accumulator = 0;
    this._frozenMs = 0;
    this._isGoalPause = false;
    this._elapsedMs = 0;
    this._hostSlapWasDown = false;
    this._clientSlapWasDown = false;
    this._aiDelayMs = 2000;
    this._playerTouched = false;
  }

  create(): void {
    const midX = (FIELD_LEFT + FIELD_RIGHT) / 2;
    const midY = (FIELD_TOP + FIELD_BOTTOM) / 2;

    this.host = createPlayer("host", midX - 200, midY);
    this.client = createPlayer("client", midX + 200, midY);
    this.ball = { x: midX, y: midY, z: 0, vx: 0, vy: 0, vz: 0, possessedBy: null };

    this._hostShoot = createShootState();
    this._clientShoot = createShootState();
    this._lastTouch = { playerId: "", timeMs: 0 };
    this._hostAim = { x: 1, y: 0 };
    this._clientAim = { x: -1, y: 0 };
    this._hostAimSmooth = { x: 1, y: 0 };
    this._clientAimSmooth = { x: -1, y: 0 };

    // Static field
    this._field = this.add.graphics();
    this._drawField();

    // Stick sprites (depth 6, above players)
    this._hostStickSprite = this.add.sprite(0, 0, "stick_black").setDepth(6).setScale(0.9);
    this._clientStickSprite = this.add.sprite(0, 0, "stick_black").setDepth(6).setScale(0.9);

    // Ball shadow
    this._ballShadow = this.add.circle(midX, midY, BALL_RADIUS, 0x000000, 0.3).setDepth(4);
    // Dash cooldown rings (drawn below players)
    this._dashRingGfx = this.add.graphics().setDepth(4.5).setVisible(false);
    // Dash ghosts
    this._ghostGraphics = this.add.graphics().setDepth(4.6);
    // Fire trail — drawn behind the ball
    this._fireGraphics = this.add.graphics().setDepth(5.5);
    // Ball drawn each frame via Graphics for physically correct rolling animation
    this._ballGraphics = this.add.graphics().setDepth(6);
    this._indicatorGraphics = this.add.graphics().setDepth(10); // Above players and ball
    this._underPlayerGraphics = this.add.graphics().setDepth(4.4); // Below players (5)
    this._hudOverlayGfx = this.add.graphics().setDepth(15).setScrollFactor(0); // Fixed UI layer

    // Players (depth 5 — above stick, below ball)
    // Origin y=0.56 puts the rotation pivot at the character body center (slightly below frame mid)
    this._hostSprite = this.add.sprite(this.host.x, this.host.y, "char_host").setDepth(5).setScale(1.26).setOrigin(0.5, 0.56);
    this._clientSprite = this.add.sprite(this.client.x, this.client.y, "char_client").setDepth(5).setScale(1.26).setOrigin(0.5, 0.56);

    // ── Top HUD bar ────────────────────────────────────────────────────────────
    this._hudGfx = this.add.graphics().setDepth(14).setScrollFactor(0);

    // Team labels with color
    this._teamLabelRed = this.add.text(0, 0, "RED", { fontSize: "14px", color: COLOR_RED_STR, fontStyle: "bold", letterSpacing: 3 })
      .setOrigin(0.5).setDepth(15).setScrollFactor(0);
    this._teamLabelBlue = this.add.text(0, 0, "BLUE", { fontSize: "14px", color: COLOR_BLUE_STR, fontStyle: "bold", letterSpacing: 3 })
      .setOrigin(0.5).setDepth(15).setScrollFactor(0);

    // "SCORE" eyebrow inside pill
    this._scoreEyebrow = this.add
      .text(0, 14, "SCORE", {
        fontSize: "9px", color: "#555577", fontStyle: "bold", letterSpacing: 2,
      })
      .setOrigin(0.5, 0)
      .setDepth(15)
      .setScrollFactor(0);

    // Score — updated every frame
    this._scoreText = this.add
      .text(0, 55, "0  —  0", { fontSize: "32px", color: "#ffffff", fontStyle: "bold" })
      .setOrigin(0.5)
      .setDepth(15)
      .setScrollFactor(0);

    // Goal / win message
    this._messageText = this.add
      .text(0, 360, "", {
        fontSize: "48px",
        color: "#ffff00",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(16)
      .setScrollFactor(0);


    // Keyboard bindings
    const kb = this.input.keyboard!;
    this._wasd = {
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      dash: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      slap: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
    };
    if (this._mode === "online") {
      this._arrows = {
        up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
        down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
        left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
        right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
        dash: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        slap: kb.addKey(Phaser.Input.Keyboard.KeyCodes.PERIOD),
      };
    }

    kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC).on("down", () => {
      this._confirmLeave();
    });

    // Back button — top-left, inside HUD bar
    this._backBtnObjs = this._makeButton(64, 47, 100, 38, "‹  BACK", "", 0x555566, 0x222233, () => this._confirmLeave(), 0.6, 16);

    // Help button - top-right, inside HUD bar
    this._helpBtn = this.add.circle(0, 47, 20, 0x555566, 1).setDepth(16).setInteractive({ useHandCursor: true }).setScrollFactor(0);
    this._helpText = this.add.text(0, 47, "?", { fontSize: "20px", fontStyle: "bold", color: "#ffffff" }).setOrigin(0.5).setDepth(17).setScrollFactor(0);
    this._helpBtn.on("pointerup", () => {
      this.scene.pause();
      this.scene.launch("TutorialScene", {
        onComplete: () => {
          this.scene.resume();
        }
      });
    });

    this._uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height).setName("UI");

    // UI elements should be ignored by the world camera and world elements by the UI camera.
    const uiElements = [this._hudGfx, this._scoreText, this._messageText, this._helpBtn, this._helpText, this._hudOverlayGfx, ...this._backBtnObjs, this._teamLabelRed, this._teamLabelBlue, this._scoreEyebrow];
    this._addUI(uiElements);

    // Touch UI — buttons are always present
    const initOffsetX = Math.floor(Math.max(0, this.scale.width - 1280) / 2);
    this._hostButtons = new ActionButtons(this, 1190 + initOffsetX, 360);
    this._addUI(this._hostButtons.getGameObjects());

    // Joystick only if in stick mode
    this._hostJoy = new VirtualJoystick(this, -initOffsetX, 0, 768 + initOffsetX, 720, 60);
    this._addUI(this._hostJoy.getGameObjects());
    this._hostJoy.enabled = (this._controlMode === "stick");

    // All world objects created so far should be ignored by the UI camera.
    this._uiCam.ignore(this.children.list.filter(c => !uiElements.includes(c as any) &&
      !this._hostButtons.getGameObjects().includes(c as any) &&
      !this._hostJoy.getGameObjects().includes(c as any)));

    this._repositionUI();
    const resizeHandler = () => this._repositionUI();
    this.scale.on("resize", resizeHandler);
    this.events.once("shutdown", () => this.scale.off("resize", resizeHandler));

    // Initialize Animations
    this._createAnimations();

    // Enable multi-touch
    this.input.addPointer(3);

    this._checkTutorial();
  }

  private _checkTutorial(): void {
    if (this._mode === "local" && !localStorage.getItem("floorball:tutorialDone")) {
      this.scene.pause();
      this.scene.launch("TutorialScene", {
        onComplete: () => {
          localStorage.setItem("floorball:tutorialDone", "true");
          this.scene.resume();
        }
      });
    }
  }

  private _createAnimations(): void {
    if (!this.anims.exists("dribble_host")) {
      // Row 1 (frames 0–7): dribbling (used when player has ball)
      this.anims.create({
        key: "dribble_host",
        frames: this.anims.generateFrameNumbers("char_host", { start: 0, end: 7 }),
        frameRate: 8,
        repeat: -1,
      });
      this.anims.create({
        key: "dribble_client",
        frames: this.anims.generateFrameNumbers("char_client", { start: 0, end: 7 }),
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  update(_time: number, delta: number): void {
    if (this._frozenMs > 0) {
      this._frozenMs -= delta;
      if (this._frozenMs <= 0) {
        this._frozenMs = 0;
        if (this._isGoalPause) {
          this._messageText.setText("");
          this._resetRound();
          this._isGoalPause = false;
        }
      }
      return;
    }

    // Cap delta so returning from a background tab doesn't cause a
    // multi-second catch-up spiral through hundreds of fixed steps.
    const clampedDelta = Math.min(delta, 200);
    this._accumulator += clampedDelta / 1000;
    while (this._accumulator >= FIXED_DT) {
      this._fixedUpdate(FIXED_DT);
      this._accumulator -= FIXED_DT;
    }

    this._updateCamera(delta);

    // Decay shot animation timers
    this._hostShotAnimMs = Math.max(0, this._hostShotAnimMs - delta);
    this._clientShotAnimMs = Math.max(0, this._clientShotAnimMs - delta);

    if (this.ball.isScoop && this.ball.scoopTimerMs !== undefined) {
      this.ball.scoopTimerMs -= delta;
      if (this.ball.scoopTimerMs <= 0) {
        this.ball.isScoop = false;
        this.ball.scoopTimerMs = 0;
      }
    }

    // Update ball orientation quaternion from rolling this frame
    const ballSpeed = Math.hypot(this.ball.vx, this.ball.vy);
    if (ballSpeed > 5) {
      // Rolling axis: perpendicular to travel direction in the ground plane
      const ax = -this.ball.vy / ballSpeed;
      const ay = this.ball.vx / ballSpeed;
      const angle = (ballSpeed * Math.min(delta, 200) / 1000) / BALL_RADIUS;
      const ha = angle / 2;
      const s = Math.sin(ha);
      const [dw, dx, dy, dz] = [Math.cos(ha), ax * s, ay * s, 0];
      // Compose: _ballQuat = dq * _ballQuat
      const [qw, qx, qy, qz] = this._ballQuat;
      this._ballQuat = [
        dw * qw - dx * qx - dy * qy - dz * qz,
        dw * qx + dx * qw + dy * qz - dz * qy,
        dw * qy - dx * qz + dy * qw + dz * qx,
        dw * qz + dx * qy - dy * qx + dz * qw,
      ];
      // Normalize to prevent numerical drift
      const len = Math.hypot(...this._ballQuat);
      this._ballQuat = this._ballQuat.map(v => v / len) as [number, number, number, number];
    }

    this._syncSprites();
    this._updateIndicators();
    this._updateGhosts(delta);
    this._updateFire(delta);
  }

  protected _confirmLeave(): void {
    this.scene.start("MenuScene");
  }

  protected _fixedUpdate(dt: number): void {
    const elapsedMs = dt * 1000;
    this._elapsedMs += elapsedMs;

    const hostInput = this._readHostInput();

    if (this._mode === "local") {
      const isNeutral = hostInput.moveX === 0 && hostInput.moveY === 0 && !hostInput.slap && !hostInput.dash;
      if (!this._playerTouched && !isNeutral) {
        this._playerTouched = true;
        this._aiDelayMs = Math.min(this._aiDelayMs, 500);
      }
      if (this._aiDelayMs > 0) {
        this._aiDelayMs -= elapsedMs;
      }
    }

    this._runPhysics(hostInput, this._readClientInput(), dt, elapsedMs);
  }

  protected _updateCamera(deltaMs: number): void {
    const cam = this.cameras.main;
    const worldW = 1280;
    const worldH = 720;

    // Center of action: weighted average of players and ball
    // Local player has more weight
    const isHostLocal = (this._mode === "local" || this._isAuthoritative);
    const localP = isHostLocal ? this.host : this.client;
    const otherP = isHostLocal ? this.client : this.host;

    // Check if ball is possessed by local player (no weight) or close to local player (reduced weight)
    const distToBall = Math.hypot(this.ball.x - localP.x, this.ball.y - localP.y);
    const DRIBBLE_BUFFER = 60; // px — ball within this distance reduces shake during dribbling
    let ballInfluence = 0.35;
    if (this.ball.possessedBy === localP.id) {
      ballInfluence = 0; // No weight when local player has possession
    } else if (distToBall < DRIBBLE_BUFFER) {
      ballInfluence = 0.1; // Reduced weight when ball is nearby but not possessed
    }

    // Weights: Local(0.45), Ball(ballInfluence), Other(adjusted)
    const otherWeight = 1.0 - 0.45 - ballInfluence;
    let targetX = localP.x * 0.45 + this.ball.x * ballInfluence + otherP.x * otherWeight;
    let targetY = localP.y * 0.45 + this.ball.y * ballInfluence + otherP.y * otherWeight;

    // "Direction of Travel" Lead for local player (up to 30% of screen width)
    const speed = Math.hypot(localP.vx, localP.vy);
    if (speed > 100) {
      const leadFactor = Math.min(speed / PLAYER_MAX_SPEED, 1) * 0.30 * (worldW / 2);
      const nx = localP.vx / speed;
      const ny = localP.vy / speed;
      targetX += nx * leadFactor;
      targetY += ny * leadFactor;
    }

    // Fit players and ball with padding
    const entities = [
      { x: this.host.x, y: this.host.y },
      { x: this.client.x, y: this.client.y },
      { x: this.ball.x, y: this.ball.y }
    ];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const e of entities) {
      minX = Math.min(minX, e.x);
      maxX = Math.max(maxX, e.x);
      minY = Math.min(minY, e.y);
      maxY = Math.max(maxY, e.y);
    }

    const padding = 120;
    const requiredW = (maxX - minX) + padding * 2;
    const requiredH = (maxY - minY) + padding * 2;

    // Target zoom: fit entities, but don't go below full-field zoom
    const baseZoom = Math.min(cam.width / worldW, cam.height / worldH);
    let targetZoom = Math.min(cam.width / requiredW, cam.height / requiredH);

    // Zoom out if charging a shot or if the ball is moving fast (e.g. just after a hit)
    const localShoot = isHostLocal ? this._hostShoot : this._clientShoot;
    const ballSpeed = Math.hypot(this.ball.vx, this.ball.vy);
    const FAST_BALL_THRESHOLD = 800; // px/s

    if (localShoot.charging || ballSpeed > FAST_BALL_THRESHOLD) {
      targetZoom = Math.min(targetZoom, baseZoom * 1.2); // Zoom out a bit relative to current required zoom
    }

    // Start fully zoomed out until first input
    if (!this._hasReceivedInput) {
      targetZoom = baseZoom;
    } else {
      // Clamp zoom: [baseZoom, baseZoom * 1.5]
      targetZoom = Phaser.Math.Clamp(targetZoom, baseZoom, baseZoom * 1.5);
    }

    // Smooth lerp for zoom and position
    const lerpPos = 1 - Math.pow(0.001, deltaMs / 1000); // Responsive smoothing
    
    // Different lerp speeds for zoom in vs out: zoom in slower, zoom out faster
    const isZoomingIn = targetZoom > this._camZoom;
    const lerpZoom = isZoomingIn 
      ? 1 - Math.pow(0.30, deltaMs / 1000)   // Slower zoom in
      : 1 - Math.pow(0.002, deltaMs / 1000); // Faster zoom out

    this._camX += (targetX - this._camX) * lerpPos;
    this._camY += (targetY - this._camY) * lerpPos;
    this._camZoom += (targetZoom - this._camZoom) * lerpZoom;

    cam.setZoom(this._camZoom);

    // Keep camera bounds within the world, taking zoom into account
    const viewW = cam.width / this._camZoom;
    const viewH = cam.height / this._camZoom;

    let minCamX, maxCamX, minCamY, maxCamY;

    if (viewW >= worldW) {
      // Zoomed out further than the world width: lock to center
      minCamX = maxCamX = worldW / 2;
    } else {
      // Zoomed in: allow movement within world bounds
      minCamX = viewW / 2;
      maxCamX = worldW - viewW / 2;
    }

    if (viewH >= worldH) {
      // Zoomed out further than the world height: lock to center
      minCamY = maxCamY = worldH / 2;
    } else {
      // Zoomed in: allow movement within world bounds
      minCamY = viewH / 2;
      maxCamY = worldH - viewH / 2;
    }

    const centerX = Phaser.Math.Clamp(this._camX, minCamX, maxCamX);
    const centerY = Phaser.Math.Clamp(this._camY, minCamY, maxCamY);

    cam.centerOn(centerX, centerY);
  }

  /**
   * Core physics step with explicit inputs.
   * Called by _fixedUpdate (local) and directly by OnlineGameScene (host/client)
   * with network-received input so there is no indirection.
   * @param isClientPrediction If true, skip authoritative possession/ownership logic.
   */
  protected _runPhysics(
    hostInput: InputState,
    clientInput: InputState,
    dt: number,
    elapsedMs: number,
    isClientPrediction = false
  ): void {
    if (hostInput.moveX !== 0 || hostInput.moveY !== 0) {
      this._hostAim = { x: hostInput.moveX, y: hostInput.moveY };
    }
    if (clientInput.moveX !== 0 || clientInput.moveY !== 0) {
      this._clientAim = { x: clientInput.moveX, y: clientInput.moveY };
    }

    // Advance smoothed aim — capped at 45°/step to prevent instant flips dropping the ball
    this._hostAimSmooth = this._lerpAim(this._hostAimSmooth, this._hostAim);
    this._clientAimSmooth = this._lerpAim(this._clientAimSmooth, this._clientAim);

    // Inject aim direction so dash fires forward even when standing still
    const hostInputActual = (hostInput.dash && hostInput.moveX === 0 && hostInput.moveY === 0)
      ? { ...hostInput, moveX: this._hostAimSmooth.x, moveY: this._hostAimSmooth.y }
      : hostInput;
    const clientInputActual = (clientInput.dash && clientInput.moveX === 0 && clientInput.moveY === 0)
      ? { ...clientInput, moveX: this._clientAimSmooth.x, moveY: this._clientAimSmooth.y }
      : clientInput;

    const hostDashBefore = this.host.dashCharges;
    const clientDashBefore = this.client.dashCharges;

    stepPlayer(this.host, hostInputActual, dt, elapsedMs);
    stepPlayer(this.client, clientInputActual, dt, elapsedMs);

    if (this.host.dashCharges < hostDashBefore) this._gainHeat("host", HEAT_GAIN_DASH);
    if (this.client.dashCharges < clientDashBefore) this._gainHeat("client", HEAT_GAIN_DASH);

    this.host.aimX = this._hostAimSmooth.x;
    this.host.aimY = this._hostAimSmooth.y;
    this.client.aimX = this._clientAimSmooth.x;
    this.client.aimY = this._clientAimSmooth.y;

    if (this._hostSlapWasDown && !hostInput.slap) {
      if (this._hostShoot.chargeMs > 0) this._doSlapShot("host");
      this._hostShoot.chargeMs = 0;
      this._hostShoot.charging = false;
    }
    if (this._clientSlapWasDown && !clientInput.slap) {
      if (this._clientShoot.chargeMs > 0) this._doSlapShot("client");
      this._clientShoot.chargeMs = 0;
      this._clientShoot.charging = false;
    }
    this._hostSlapWasDown = hostInput.slap;
    this._clientSlapWasDown = clientInput.slap;
    updateShootCharge(this._hostShoot, hostInput.slap, elapsedMs);
    updateShootCharge(this._clientShoot, clientInput.slap, elapsedMs);

    this.host.chargeMs = this._hostShoot.chargeMs;
    this.client.chargeMs = this._clientShoot.chargeMs;

    // Tick down shot cooldowns
    this._hostShotCooldownMs = Math.max(0, this._hostShotCooldownMs - elapsedMs);
    this._clientShotCooldownMs = Math.max(0, this._clientShotCooldownMs - elapsedMs);

    // Use smoothed aim for stick direction so stick doesn't teleport on direction change
    const hostStick = this._stickDir(this.host, this._hostAimSmooth);
    const clientStick = this._stickDir(this.client, this._clientAimSmooth);
    resolvePlayerPlayerCollision(this.host, this.client, (p1, p2) => this._onPlayerPlayerContact(p1, p2));
    resolvePlayerEnvironment(this.host);
    resolvePlayerEnvironment(this.client);
    resolvePlayerBallCollision(this.host, this.ball);
    resolvePlayerBallCollision(this.client, this.ball);
    resolveStickTipCollision(this.host, this.ball, hostStick.x, hostStick.y);
    resolveStickTipCollision(this.client, this.ball, clientStick.x, clientStick.y);

    // Possession: if client prediction, ONLY allow keeping current possession, don't allow taking it.
    // This prevents local prediction from fighting the authoritative host state.
    if (isClientPrediction) {
      if (this._hostHasPossession) {
        this._hostHasPossession = this._applyStickPossession(this.host, hostStick, this._hostDribblePhase, this._hostShoot.charging, this._hostShotCooldownMs > 0);
        if (this._hostHasPossession) this._hostDribblePhase += dt * 2 * Math.PI * GameScene.DRIBBLE_FREQ;
      } else if (this._clientHasPossession) {
        this._clientHasPossession = this._applyStickPossession(this.client, clientStick, this._clientDribblePhase, this._clientShoot.charging, this._clientShotCooldownMs > 0);
        if (this._clientHasPossession) this._clientDribblePhase += dt * 2 * Math.PI * GameScene.DRIBBLE_FREQ;
      }
    } else {
      this._hostHasPossession = this._applyStickPossession(this.host, hostStick, this._hostDribblePhase, this._hostShoot.charging, this._hostShotCooldownMs > 0);
      if (this._hostHasPossession) {
        this._hostDribblePhase += dt * 2 * Math.PI * GameScene.DRIBBLE_FREQ;
        this._clientHasPossession = false;
        if (this._isAuthoritative) this.ball.possessedBy = "host";
      } else {
        this._clientHasPossession = this._applyStickPossession(this.client, clientStick, this._clientDribblePhase, this._clientShoot.charging, this._clientShotCooldownMs > 0);
        if (this._clientHasPossession) {
          this._clientDribblePhase += dt * 2 * Math.PI * GameScene.DRIBBLE_FREQ;
          if (this._isAuthoritative) this.ball.possessedBy = "client";
        } else {
          if (this._isAuthoritative) this.ball.possessedBy = null;
        }
      }
    }

    this._updateLastTouch();

    // Inject current dash and slap state into ActionButtons for visual feedback
    const localPlayer = this._mode === "online" ? (this._isAuthoritative ? this.host : this.client) : this.host;
    this._hostButtons.updateDashState(localPlayer.dashCharges, localPlayer.dashCooldownMs);
    this._hostButtons.updateSlapState(localPlayer.chargeMs);

    if (!isClientPrediction) {
      const goal = stepBall(this.ball, dt);
      if (goal) this._onGoal(goal);
    }
  }

  protected _updateLastTouch(): void {
    const CONTACT = 32; // slightly larger than PLAYER_RADIUS+BALL_RADIUS
    if (Math.hypot(this.host.x - this.ball.x, this.host.y - this.ball.y) < CONTACT) {
      this._lastTouch = { playerId: "host", timeMs: this._elapsedMs };
    } else if (Math.hypot(this.client.x - this.ball.x, this.client.y - this.ball.y) < CONTACT) {
      this._lastTouch = { playerId: "client", timeMs: this._elapsedMs };
    }
  }

  private _isOneTouch(shooterId: string): boolean {
    return (
      this._lastTouch.playerId !== "" &&
      this._lastTouch.playerId !== shooterId &&
      this._elapsedMs - this._lastTouch.timeMs < ONE_TOUCH_WINDOW
    );
  }

  /** Returns true if ball is near the stick tip or player body. */
  private _ballInRange(who: "host" | "client"): boolean {
    const player = who === "host" ? this.host : this.client;
    const aim = who === "host" ? this._hostAimSmooth : this._clientAimSmooth;
    return ballInRange(player, this.ball, aim);
  }

  /**
   * Returns the perpendicular-to-aim unit vector pointing toward the ball.
   * This is the direction the stick extends — beside the player, not in front.
   */
  protected _stickDir(
    _player: { x: number; y: number },
    aim: { x: number; y: number }
  ): { x: number; y: number } {
    return stickDirPure(aim);
  }

  /**
   * When ball is near the stick tip, carry it:
   *  - velocity coupling: ball velocity is pulled toward player velocity (0.35/step)
   *  - position correction: ball is pulled toward the tip surface (45% of gap/step)
   *  - speed gate: if ball arrives too fast (incoming pass/shot), skip possession
   *    so the collision system handles the deflection instead
   */
  protected _applyStickPossession(
    player: PlayerExtended,
    stickDir: { x: number; y: number },
    dribblePhase: number,
    isCharging = false,
    shotCooldownActive = false
  ): boolean {
    if (shotCooldownActive) return false;

    // In online mode, if someone else has possession, don't try to take it
    if (this._mode === "online" && this.ball.possessedBy && this.ball.possessedBy !== player.id) {
      return false;
    }

    // Aim direction is 90° CW from stickDir (stickDir is 90° CCW from aim)
    const aNx = stickDir.y;
    const aNy = -stickDir.x;

    // Dribble target: oscillates side-to-side in front of the player
    // Blade tip — used as target during charging and for shot snapping
    const bladeTipX = player.x + stickDir.x * STICK_REACH + aNx * PLAYER_RADIUS * 0.84;
    const bladeTipY = player.y + stickDir.y * STICK_REACH + aNy * PLAYER_RADIUS * 0.84;

    // During slap-shot charge, pull ball back to blade so it's ready to hit
    if (isCharging) {
      const distToBlade = Math.hypot(this.ball.x - bladeTipX, this.ball.y - bladeTipY);
      if (distToBlade > 75) return false;
      if (Math.hypot(this.ball.vx - player.vx, this.ball.vy - player.vy) > 600) return false;

      // Velocity coupling: 0.40 total (0.15 from assist + 0.25 here)
      applyPossessionAssist(this.ball, player.vx, player.vy);
      this.ball.vx += (player.vx - this.ball.vx) * 0.25;
      this.ball.vy += (player.vy - this.ball.vy) * 0.25;

      // Pull toward blade tip: smoother interpolation to prevent teleporting
      const dx = bladeTipX - this.ball.x;
      const dy = bladeTipY - this.ball.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.1) {
        const moveDist = Math.min(dist * POSSESSION_PULL_FACTOR, POSSESSION_PULL_CAP);
        this.ball.x += (dx / dist) * moveDist;
        this.ball.y += (dy / dist) * moveDist;
      }
      return true;
    }

    const { DRIBBLE_AMP, DRIBBLE_DIST } = GameScene;
    const side = Math.sin(dribblePhase) * DRIBBLE_AMP;
    const targetX = player.x + aNx * DRIBBLE_DIST + stickDir.x * side;
    const targetY = player.y + aNy * DRIBBLE_DIST + stickDir.y * side;

    // Possession zone: centred in front of player, generous 75px radius for easy pickup
    const zoneRadius = 75;
    const zoneCX = player.x + aNx * DRIBBLE_DIST;
    const zoneCY = player.y + aNy * DRIBBLE_DIST;
    if (Math.hypot(this.ball.x - zoneCX, this.ball.y - zoneCY) > zoneRadius) return false;

    if (Math.hypot(this.ball.vx - player.vx, this.ball.vy - player.vy) > 600) return false;

    // Velocity coupling: 0.40 total (0.15 from assist + 0.25 here)
    applyPossessionAssist(this.ball, player.vx, player.vy);
    this.ball.vx += (player.vx - this.ball.vx) * 0.25;
    this.ball.vy += (player.vy - this.ball.vy) * 0.25;

    // Pull toward dribble target: smoother interpolation to prevent teleporting
    const dx = targetX - this.ball.x;
    const dy = targetY - this.ball.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.1) {
      const moveDist = Math.min(dist * POSSESSION_PULL_FACTOR, POSSESSION_PULL_CAP);
      this.ball.x += (dx / dist) * moveDist;
      this.ball.y += (dy / dist) * moveDist;
    }

    return true;
  }

  /** Spawns a brief visual effect on the ball for a one-touch shot. */
  private _spawnOneTouchJuice(): void {
    // Brief particle burst on the ball
    const visualY = this.ball.y - this.ball.z * 0.6;
    for (let i = 0; i < 8; i++) {
      this._fireParticles.push({
        x: this.ball.x,
        y: visualY,
        vx: (Math.random() - 0.5) * 500,
        vy: (Math.random() - 0.5) * 500,
        life: 300,
        maxLife: 300,
        size: 6 + Math.random() * 4,
      });
    }
  }

  /** Snap ball to the static blade tip so shots always connect when possessed. */
  protected _snapBallToBlade(who: "host" | "client"): void {
    const player = who === "host" ? this.host : this.client;
    const aim = who === "host" ? this._hostAimSmooth : this._clientAimSmooth;
    const stick = this._stickDir(player, aim);
    const aNx = stick.y, aNy = -stick.x;
    this.ball.x = player.x + stick.x * STICK_REACH + aNx * PLAYER_RADIUS * 0.84;
    this.ball.y = player.y + stick.y * STICK_REACH + aNy * PLAYER_RADIUS * 0.84;
  }


  protected _doSlapShot(who: "host" | "client"): void {
    // Always play the swing animation on release
    if (who === "host") this._hostShotAnimMs = 280;
    else this._clientShotAnimMs = 280;
    const hasPossession = who === "host" ? this._hostHasPossession : this._clientHasPossession;
    if (hasPossession) {
      this._snapBallToBlade(who);
    } else if (!this._ballInRange(who)) {
      return;
    }
    const state = who === "host" ? this._hostShoot : this._clientShoot;
    const aim = who === "host" ? this._hostAimSmooth : this._clientAimSmooth;
    const player = who === "host" ? this.host : this.client;
    const isOT = this._isOneTouch(who);
    if (isOT) this._spawnOneTouchJuice();
    // Bolt shot triggers if we dashed very recently
    const isBolt = player.dashCooldownMs > DASH_COOLDOWN - 200 && player.dashCharges < MAX_DASH_CHARGES;
    const isPerfect = releaseShot(state, this.ball, aim.x, aim.y, isOT, player.vx, player.vy);
    this.ball.isPerfect = isPerfect;
    if (isPerfect) this._gainHeat(who, HEAT_GAIN_PERFECT);

    if (this.ball.isScoop) {
      this._playScoopSound();
    }

    if (isBolt) {
      this.ball.vx *= BOLT_SHOT_BOOST;
      this.ball.vy *= BOLT_SHOT_BOOST;
      this.ball.isBolt = true;
      this.ball.boltTimerMs = BOLT_SHOT_DURATION_MS;
    } else {
      this.ball.isBolt = false;
      this.ball.boltTimerMs = 0;
    }

    if (isPerfect || isBolt) {
      this._spawnPerfectJuice(this.ball.x, this.ball.y);
      this._frozenMs = isPerfect ? 50 : 30; // Hit-stop
    }
    this._lastTouch = { playerId: who, timeMs: this._elapsedMs };
    if (who === "host") this._hostShotCooldownMs = GameScene.SHOT_COOLDOWN_MS;
    else this._clientShotCooldownMs = GameScene.SHOT_COOLDOWN_MS;
  }

  protected _readHostInput(): InputState {
    const k = this._wasd;
    let mx = 0;
    let my = 0;
    if (k.left.isDown) mx -= 1;
    if (k.right.isDown) mx += 1;
    if (k.up.isDown) my -= 1;
    if (k.down.isDown) my += 1;

    if (this._controlMode === "follow") {
      // Follow-touch steering: move toward pointer if active and not over a button
      const pts = [this.input.pointer1, this.input.pointer2, this.input.pointer3];
      for (const pointer of pts) {
        if (pointer.isDown && !this._hostButtons.contains(pointer.worldX, pointer.worldY)) {
          const dx = pointer.worldX - this.host.x;
          const dy = pointer.worldY - this.host.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 15) {
            mx = dx / dist;
            my = dy / dist;
          } else {
            mx = 0;
            my = 0;
          }
          break;
        }
      }
    } else {
      // Virtual joystick steering
      if (this._hostJoy.isActive()) {
        mx = this._hostJoy.value.x;
        my = this._hostJoy.value.y;
      }
    }

    const touch = this._hostButtons.read();

    const input = {
      moveX: mx,
      moveY: my,
      slap: k.slap.isDown || touch.slapHeld,
      dash: k.dash.isDown || touch.dash,
    };

    // Mark that input has been received
    if (input.moveX !== 0 || input.moveY !== 0 || input.slap || input.dash) {
      this._hasReceivedInput = true;
    }

    return input;
  }

  protected _readClientInput(): InputState {
    if (this._mode === "local") {
      if (this._aiDelayMs > 0) return NEUTRAL_INPUT;
      return getNextAIInput(this.client, this.ball, this.host);
    }

    return NEUTRAL_INPUT;
  }

  protected _onPlayerPlayerContact(p1: PlayerExtended, p2: PlayerExtended): void {
    // Check if either player is dashing
    const p1Dashing = p1.dashCooldownMs > DASH_COOLDOWN - DASH_STEAL_WINDOW && p1.dashCharges < MAX_DASH_CHARGES;
    const p2Dashing = p2.dashCooldownMs > DASH_COOLDOWN - DASH_STEAL_WINDOW && p2.dashCharges < MAX_DASH_CHARGES;

    if (p1Dashing && this._clientHasPossession) {
      this._pokeBall(p1);
    } else if (p2Dashing && this._hostHasPossession) {
      this._pokeBall(p2);
    }
  }

  private _pokeBall(dashingPlayer: PlayerExtended): void {
    this.ball.vx = dashingPlayer.vx * DASH_STEAL_FORCE;
    this.ball.vy = dashingPlayer.vy * DASH_STEAL_FORCE;
    this.ball.isPerfect = false;
    this.ball.isBolt = false;
    this.ball.boltTimerMs = 0;
    this._hostHasPossession = false;
    this._clientHasPossession = false;
    this._hostShotCooldownMs = 150;
    this._clientShotCooldownMs = 150;

    this._gainHeat(dashingPlayer.id as "host" | "client", HEAT_GAIN_STEAL);

    // Juice for poke
    this.cameras.main.shake(150, 0.008);
    this._frozenMs = 40; // hit-stop on steal

    // Impact sparks using fire system
    for (let i = 0; i < 12; i++) {
      this._fireParticles.push({
        x: this.ball.x,
        y: this.ball.y - this.ball.z * 0.6,
        vx: (Math.random() - 0.5) * 800,
        vy: (Math.random() - 0.5) * 800,
        life: 250,
        maxLife: 250,
        size: 8 + Math.random() * 6,
      });
    }
  }

  protected _gainHeat(who: "host" | "client", amt: number): void {
    const p = who === "host" ? this.host : this.client;
    if (p.enFuegoTimerMs > 0) return;
    p.heat = Math.min(MAX_HEAT, p.heat + amt);
    if (p.heat >= MAX_HEAT) {
      p.heat = MAX_HEAT;
      p.enFuegoTimerMs = EN_FUEGO_DURATION_MS;
      this._playEnFuegoSound();
      this.cameras.main.flash(400, 255, 100, 0);
    }
  }

  protected _onGoal(scorer: "host" | "client"): void {
    this.score[scorer]++;
    this._gainHeat(scorer, HEAT_GAIN_GOAL);
    const isWin = this.score[scorer] >= WINNING_SCORE;
    const label = scorer === "host" ? "Red scores!" : "Blue scores!";
    if (isWin) {
      this._messageText.setText(`${scorer === "host" ? "Red" : "Blue"} wins!`);
      this._frozenMs = 5000; // Give time for the overlay
      this._isGoalPause = true;
      this._updateWinStreak(scorer);
      this.time.delayedCall(1000, () => this._showMatchOver(scorer));
      this.cameras.main.shake(500, 0.02);
    } else {
      this._messageText.setText(`${label}  ${this.score.host} — ${this.score.client}`);
      this._frozenMs = 1500;
      this._isGoalPause = true;
      this.cameras.main.shake(250, 0.01);
    }
    this._playGoalCheer(isWin);
  }

  private _updateWinStreak(winner: "host" | "client"): void {
    const key = "floorball:streak";
    const data = JSON.parse(localStorage.getItem(key) || '{"winner":"","count":0}');
    if (data.winner === winner) {
      data.count++;
    } else {
      data.winner = winner;
      data.count = 1;
    }
    localStorage.setItem(key, JSON.stringify(data));
  }

  protected _showMatchOver(winner: "host" | "client"): void {
    const cx = this.scale.width / 2, cy = 360;
    const data = JSON.parse(localStorage.getItem("floorball:streak") || '{"winner":"","count":0}');
    const streakText = data.count > 1 ? `WIN STREAK: ${data.count}` : "FIRST WIN!";

    // Overlay background
    const bg = this.add.rectangle(cx, cy, 600, 350, 0x000000, 0.9).setDepth(30).setScrollFactor(0);

    const title = this.add.text(cx, cy - 100, "MATCH OVER", { fontSize: "32px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5).setDepth(31).setScrollFactor(0);
    const winLabel = this.add.text(cx, cy - 40, `${winner === "host" ? "RED" : "BLUE"} TEAM WINS!`, { fontSize: "40px", color: "#ffff00", fontStyle: "bold" }).setOrigin(0.5).setDepth(31).setScrollFactor(0);
    const streakLabel = this.add.text(cx, cy + 20, streakText, { fontSize: "24px", color: "#00cc66", fontStyle: "bold" }).setOrigin(0.5).setDepth(31).setScrollFactor(0);

    // Rematch button
    const rematchBtn = this.add.rectangle(cx, cy + 100, 250, 60, winner === "host" ? COLOR_RED : COLOR_BLUE, 1).setDepth(31).setInteractive({ useHandCursor: true }).setScrollFactor(0);
    const rematchText = this.add.text(cx, cy + 100, "REMATCH", { fontSize: "24px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5).setDepth(31).setScrollFactor(0);
    this._rematchBtn = rematchBtn;
    this._rematchBtnText = rematchText;

    rematchBtn.on("pointerover", () => { rematchBtn.setScale(1.05); rematchBtn.setFillStyle(0x00ee77); });
    rematchBtn.on("pointerout", () => { rematchBtn.setScale(1.0); rematchBtn.setFillStyle(0x00cc66); });

    rematchBtn.on("pointerup", () => this._handleRematchClick(rematchBtn, rematchText));

    this.tweens.add({
      targets: rematchBtn,
      scale: 1.05,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut"
    });

    // Menu button
    const menuBtn = this.add.rectangle(cx, cy + 170, 250, 60, 0x444466, 1).setDepth(31).setInteractive({ useHandCursor: true }).setScrollFactor(0);
    const menuText = this.add.text(cx, cy + 170, "MENU", { fontSize: "24px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5).setDepth(31).setScrollFactor(0);

    menuBtn.on("pointerover", () => { menuBtn.setScale(1.05); menuBtn.setFillStyle(0x555577); });
    menuBtn.on("pointerout", () => { menuBtn.setScale(1.0); menuBtn.setFillStyle(0x444466); });

    menuBtn.on("pointerup", () => this.scene.start("MenuScene"));

    this._matchOverObjects = [bg, title, winLabel, streakLabel, this._rematchBtn, this._rematchBtnText, menuBtn, menuText];
    this._addUI(this._matchOverObjects);
  }

  protected _clearMatchOver(): void {
    this._matchOverObjects.forEach(obj => obj.destroy());
    this._matchOverObjects = [];
    this._rematchBtn = null;
    this._rematchBtnText = null;
  }

  protected _resetMatch(): void {
    this.score = { host: 0, client: 0 };
    this._resetRound();
    this._frozenMs = 0;
    this._isGoalPause = false;
    this._messageText.setText("");
    this._hostShotCooldownMs = 0;
    this._clientShotCooldownMs = 0;

    this.host.heat = 0;
    this.host.enFuegoTimerMs = 0;
    this.client.heat = 0;
    this.client.enFuegoTimerMs = 0;
  }

  protected _handleRematchClick(btn: Phaser.GameObjects.Rectangle, text: Phaser.GameObjects.Text): void {
    text.setText("WAITING...");
    btn.disableInteractive();
    btn.setAlpha(0.6);
    this.scene.restart();
  }

  private _playEnFuegoSound(): void {
    try {
      const ctx = (this.game.sound as any).context;
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.2);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch { /* audio not available */ }
  }

  private _playScoopSound(): void {
    try {
      const ctx = (this.game.sound as any).context;
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
      g.gain.setValueAtTime(0.2, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch { /* audio not available */ }
  }

  private _playGoalCheer(isWin: boolean): void {
    try {
      const ctx = (this.game.sound as any).context;
      if (!ctx) return;
      const duration = isWin ? 3.5 : 2.0;

      // ── Crowd noise: filtered white noise ──────────────────────────────────
      const bufLen = Math.ceil(ctx.sampleRate * duration);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
      const crowd = ctx.createBufferSource();
      crowd.buffer = buf;

      // Band-pass: crowd cheer lives around 800–3 kHz
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1200;
      bp.Q.value = 0.6;

      const crowdGain = ctx.createGain();
      crowdGain.gain.setValueAtTime(0, ctx.currentTime);
      crowdGain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.12);
      crowdGain.gain.setValueAtTime(0.35, ctx.currentTime + duration - 0.4);
      crowdGain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);

      crowd.connect(bp);
      bp.connect(crowdGain);
      crowdGain.connect(ctx.destination);
      crowd.start(ctx.currentTime);

      // ── Goal horn: two blasts ───────────────────────────────────────────────
      const hornFreqs = isWin ? [220, 277, 330, 440] : [220, 277];
      hornFreqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        const t0 = ctx.currentTime + i * 0.28;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.18, t0 + 0.03);
        g.gain.setValueAtTime(0.18, t0 + 0.22);
        g.gain.linearRampToValueAtTime(0, t0 + 0.28);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.3);
      });
    } catch { /* audio not available */ }
  }

  protected _updateFire(deltaMs: number): void {
    const speed = Math.hypot(this.ball.vx, this.ball.vy);
    const FIRE_THRESHOLD = 350; // px/s — below this, no fire
    const visualY = this.ball.y - this.ball.z * 0.6;

    // Spawn particles proportional to how fast the ball is going
    if (speed > FIRE_THRESHOLD || this.ball.isScoop) {
      const excess = Math.max(0, speed - FIRE_THRESHOLD);
      let spawnCount = Math.random() < (excess / 400) ? 2 : 1;
      if (this.ball.isScoop) spawnCount += 2;

      const invSpeed = 1 / (speed || 1);
      const dvx = -this.ball.vx * invSpeed; // direction behind ball
      const dvy = -this.ball.vy * invSpeed;

      for (let i = 0; i < spawnCount; i++) {
        const maxLife = 180 + Math.random() * 120;
        this._fireParticles.push({
          x: this.ball.x + dvx * BALL_RADIUS * 0.5,
          y: visualY + dvy * BALL_RADIUS * 0.5,
          vx: dvx * (60 + Math.random() * 80) + (Math.random() - 0.5) * 70,
          vy: dvy * (60 + Math.random() * 80) + (Math.random() - 0.5) * 70,
          life: maxLife,
          maxLife,
          size: (this.ball.isScoop ? 4 : 3) + Math.random() * 5,
        });
      }
    }

    // Update and draw
    const dt = deltaMs / 1000;
    this._fireGraphics.clear();
    this._fireParticles = this._fireParticles.filter(p => {
      p.life -= deltaMs;
      if (p.life <= 0) return false;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const t = p.life / p.maxLife; // 1=fresh, 0=dead

      let color = 0xff0000;
      if (this.ball.isPerfect) {
        // bright yellow (t=1) → orange (t=0.5) → pure red (t<0.5)
        const r = 0xff;
        const g = t > 0.5 ? Math.round((t - 0.5) * 2 * 220) : 0;
        color = (r << 16) | (g << 8);
      } else if (this.ball.isBolt) {
        // Bright Violet/Pink (t=1) -> White (t=0.5) -> Violet (t=0)
        const r = 255;
        const b = 255;
        const g = Math.round(Math.max(0, 1 - Math.abs(t - 0.5) * 2) * 255);
        color = (r << 16) | (g << 8) | b;
      } else if (this.ball.isScoop) {
        // White to Gold
        const r = 255;
        const g = 200 + Math.round(t * 55);
        const b = Math.round(t * 150);
        color = (r << 16) | (g << 8) | b;
      } else {
        // Cyan (t=1) -> White (t=0.5) -> Cyan (t=0)
        const g = 255;
        const b = 255;
        const r = Math.round(Math.max(0, 1 - Math.abs(t - 0.5) * 2) * 255);
        color = (r << 16) | (g << 8) | b;
      }

      this._fireGraphics.fillStyle(color, Math.min(1, t * 1.1));
      this._fireGraphics.fillCircle(p.x, p.y, p.size * t);
      return true;
    });
  }

  private _spawnPerfectJuice(x: number, y: number): void {
    this.cameras.main.shake(150, 0.005);

    // Expanding shockwave ring
    const ring = this.add.graphics().setDepth(20);
    const data = { r: 10, a: 1 };
    this.tweens.add({
      targets: data,
      r: 100,
      a: 0,
      duration: 300,
      ease: "Cubic.out",
      onUpdate: () => {
        ring.clear();
        ring.lineStyle(4, 0xffffff, data.a);
        ring.strokeCircle(x, y, data.r);
      },
      onComplete: () => ring.destroy(),
    });
  }

  /** Draw a floorball at local coords (cx, cy) into gfx with given radius and quaternion. */
  protected _drawBallAt(
    gfx: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    radius: number,
    quat: [number, number, number, number]
  ): void {
    gfx.fillStyle(0xffffff, 1);
    gfx.fillCircle(cx, cy, radius);
    const [qw, qx, qy, qz] = quat;
    const dotBaseR = Math.max(1, radius * 0.22);
    gfx.fillStyle(0xcccccc, 1);
    for (const [bx, by, bz] of GameScene.BALL_DOTS) {
      const tx = 2 * (qy * bz - qz * by);
      const ty = 2 * (qz * bx - qx * bz);
      const tz = 2 * (qx * by - qy * bx);
      const wx = bx + qw * tx + qy * tz - qz * ty;
      const wy = by + qw * ty + qz * tx - qx * tz;
      const wz = bz + qw * tz + qx * ty - qy * tx;
      if (wz <= 0) continue;
      const sx = cx + wx * radius;
      const sy = cy + wy * radius - wz * radius * 0.6;
      const dotR = dotBaseR * wz;
      if (Math.hypot(sx - cx, sy - cy) + dotR > radius) continue;
      gfx.fillCircle(sx, sy, dotR);
    }
  }

  protected _updateIndicators(): void {
    const g = this._indicatorGraphics;
    const gu = this._underPlayerGraphics;
    const h = this._hudOverlayGfx;
    g.clear();
    gu.clear();
    h.clear();

    const drawForPlayer = (
      player: PlayerExtended,
      aim: { x: number; y: number },
      isLocal: boolean,
      shootState: ShootState,
      hasPossession: boolean,
      teamColor: number
    ) => {
      // 1. Aim direction indicator — gradient arrow that grows with charge
      // Only appears when charging AND has possession
      if (shootState.charging && hasPossession) {
        const nx = aim.x;
        const ny = aim.y;
        const px = -ny; // Perpendicular
        const py = nx;

        const chargeRatio = Math.min(shootState.chargeMs / SHOOT_MAX_CHARGE_MS_LOCAL, 1);
        const maxLen = 140;
        const lineLen = 30 + chargeRatio * maxLen;
        const headLen = 20;
        const stemW = 8;
        const headW = 24;

        // Visual origin is the ball center
        const bx = this.ball.x;
        const by = this.ball.y - this.ball.z * 0.6;

        const ax = bx + nx * lineLen;
        const ay = by + ny * lineLen;
        const hx = ax - nx * headLen;
        const hy = ay - ny * headLen;

        // Team color gradient
        g.fillGradientStyle(teamColor, 0xffffff, teamColor, 0xffffff, 0.9, 0.9, 0.9, 0.9);

        g.beginPath();
        // Arrow Stem
        g.moveTo(bx + px * (stemW / 2), by + py * (stemW / 2));
        g.lineTo(hx + px * (stemW / 2), hy + py * (stemW / 2));
        // Arrow Head
        g.lineTo(hx + px * (headW / 2), hy + py * (headW / 2));
        g.lineTo(ax, ay);
        g.lineTo(hx - px * (headW / 2), hy - py * (headW / 2));
        // Back down stem
        g.lineTo(hx - px * (stemW / 2), hy - py * (stemW / 2));
        g.lineTo(bx - px * (stemW / 2), by - py * (stemW / 2));
        g.closePath();
        g.fillPath();

        // Optional thin white outline for pop
        g.lineStyle(1, 0xffffff, 0.4);
        g.strokePath();
      }

      // 1.5 Heat Meter in HUD
      const isRed = teamColor === COLOR_RED;
      const barW = 180;
      const barH = 10;
      const midX = this.scale.width / 2;
      const barX = isRed ? midX - 380 : midX + 380 - barW;
      const barY = 55;

      // BG
      h.fillStyle(0x222222, 0.8);
      h.fillRoundedRect(barX, barY, barW, barH, 4);

      // Fill
      const heatRatio = player.heat / MAX_HEAT;
      const isFuego = player.enFuegoTimerMs > 0;
      const fillColor = isFuego ? 0xffaa00 : teamColor;
      h.fillStyle(fillColor, 1);
      h.fillRoundedRect(barX, barY, barW * heatRatio, barH, 4);

      if (isFuego) {
        // Pulsing outline
        const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 100);
        h.lineStyle(2, 0xffffff, pulse);
        h.strokeRoundedRect(barX - 2, barY - 2, barW + 4, barH + 4, 5);
      }

      // 2. Ownership "YOU" indicator
      if (isLocal) {
        // Team colored oval below the character
        gu.lineStyle(3, teamColor, 0.8);
        gu.strokeEllipse(player.x + 5, player.y + 30, 60, 30);

        // Small triangle above
        const ty = player.y - PLAYER_RADIUS - 30;
        g.fillStyle(teamColor, 1);
        g.fillTriangle(
          player.x - 6, ty - 8,
          player.x + 6, ty - 8,
          player.x, ty
        );
      }
    };

    if (this._mode === "local") {
      drawForPlayer(this.host, this._hostAimSmooth, true, this._hostShoot, this._hostHasPossession, COLOR_RED);
      drawForPlayer(this.client, this._clientAimSmooth, false, this._clientShoot, this._clientHasPossession, COLOR_BLUE);
    } else {
      const isHostLocal = this._isAuthoritative;
      drawForPlayer(this.host, this._hostAimSmooth, isHostLocal, this._hostShoot, this._hostHasPossession, COLOR_RED);
      drawForPlayer(this.client, this._clientAimSmooth, !isHostLocal, this._clientShoot, this._clientHasPossession, COLOR_BLUE);
    }
  }

  protected _syncSprites(): void {
    // Ball rises visually as z increases; scale grows noticeably with height
    const visualY = this.ball.y - this.ball.z * 0.6;
    if (this.ball.isScoop) {
      // Add extra white glow
      this._ballGraphics.lineStyle(4, 0xffffff, 0.6);
      this._ballGraphics.strokeCircle(this.ball.x, visualY, BALL_RADIUS + 4);
    }
    const displayR = BALL_RADIUS * (1 + this.ball.z * 0.003);
    const depth = 6 + this.ball.z * 0.01;
    this._ballGraphics.clear().setPosition(this.ball.x, visualY).setDepth(depth);

    this._drawBallAt(this._ballGraphics, 0, 0, displayR, this._ballQuat);

    // Shadow stays at ground position, shrinks and fades as ball rises
    const shadowScale = Math.max(0.3, 1 - this.ball.z * 0.004);
    const shadowAlpha = Math.max(0, 0.45 - this.ball.z * 0.002);
    this._ballShadow.setPosition(this.ball.x, this.ball.y).setScale(shadowScale).setAlpha(shadowAlpha);

    const hostHasBall = this._hostHasPossession;
    const clientHasBall = this._clientHasPossession;
    const toggleFrame = Math.floor(this.time.now / 200) % 2;

    this._hostSprite.setPosition(this.host.x, this.host.y);
    this._hostSprite.setRotation(Math.atan2(this._hostAimSmooth.y, this._hostAimSmooth.x) - Math.PI / 2);
    if (this.host.enFuegoTimerMs > 0) {
      const p = 0.7 + 0.3 * Math.sin(this.time.now / 50);
      this._hostSprite.setTint(0xffaa00).setAlpha(p);
    } else {
      this._hostSprite.clearTint().setAlpha(1);
    }

    if (hostHasBall) {
      this._hostSprite.anims.play("dribble_host", true);
    } else if (Math.abs(this.host.vx) > 10 || Math.abs(this.host.vy) > 10) {
      this._hostSprite.anims.stop();
      this._hostSprite.setFrame(toggleFrame);
    } else {
      this._hostSprite.anims.stop();
      this._hostSprite.setFrame(1);
    }

    this._clientSprite.setPosition(this.client.x, this.client.y);
    this._clientSprite.setRotation(Math.atan2(this._clientAimSmooth.y, this._clientAimSmooth.x) - Math.PI / 2);
    if (this.client.enFuegoTimerMs > 0) {
      const p = 0.7 + 0.3 * Math.sin(this.time.now / 50);
      this._clientSprite.setTint(0xffaa00).setAlpha(p);
    } else {
      this._clientSprite.clearTint().setAlpha(1);
    }

    if (clientHasBall) {
      this._clientSprite.anims.play("dribble_client", true);
    } else if (Math.abs(this.client.vx) > 10 || Math.abs(this.client.vy) > 10) {
      this._clientSprite.anims.stop();
      this._clientSprite.setFrame(toggleFrame);
    } else {
      this._clientSprite.anims.stop();
      this._clientSprite.setFrame(1);
    }

    // Draw sticks
    this._drawSticks();

    // Dash cooldown rings
    this._updateDashRings();

    this._scoreText.setText(`${this.score.host}  —  ${this.score.client}`);
  }

  private _updateGhosts(delta: number): void {
    // Spawn ghosts
    const DASH_BURST = DASH_COOLDOWN - 200;
    const hostFuego = this.host.enFuegoTimerMs > 0;
    if ((hostFuego || (this.host.dashCooldownMs > DASH_BURST && this.host.dashCharges < MAX_DASH_CHARGES)) && Math.floor(this.time.now / 40) % 2 === 0) {
      this._ghosts.push({
        x: this.host.x,
        y: this.host.y,
        rotation: this._hostSprite.rotation,
        frame: this._hostSprite.frame.name as unknown as number,
        alpha: 0.5,
        life: GameScene.GHOST_LIFETIME,
        color: hostFuego ? 0xffaa00 : COLOR_RED,
      });
    }
    const clientFuego = this.client.enFuegoTimerMs > 0;
    if ((clientFuego || (this.client.dashCooldownMs > DASH_BURST && this.client.dashCharges < MAX_DASH_CHARGES)) && Math.floor(this.time.now / 40) % 2 === 0) {
      this._ghosts.push({
        x: this.client.x,
        y: this.client.y,
        rotation: this._clientSprite.rotation,
        frame: this._clientSprite.frame.name as unknown as number,
        alpha: 0.5,
        life: GameScene.GHOST_LIFETIME,
        color: clientFuego ? 0xffaa00 : COLOR_BLUE,
      });
    }

    this._ghostGraphics.clear();
    this._ghosts = this._ghosts.filter(g => {
      g.life -= delta;
      if (g.life <= 0) return false;
      const t = g.life / GameScene.GHOST_LIFETIME;
      this._ghostGraphics.fillStyle(g.color, g.alpha * t);
      // Since we are using sprites with frames, but Graphics doesn't easily draw sprites,
      // I'll just draw a tinted circle as a "ghost" for now to keep it lightweight,
      // or I could use a pool of sprites. Let's do tinted circles for "juice" feel.
      this._ghostGraphics.fillCircle(g.x, g.y, PLAYER_RADIUS);
      return true;
    });
  }

  private _updateDashRings(): void {
    const gfx = this._dashRingGfx;
    gfx.clear();
    for (const player of [this.host, this.client]) {
      if (player.dashCooldownMs <= 0) continue;
      // Arc sweeps clockwise from the top as cooldown recovers (0 = just used, 1 = ready)
      const progress = 1 - player.dashCooldownMs / DASH_COOLDOWN;
      const r = PLAYER_RADIUS + 7;
      const start = -Math.PI / 2;
      const end = start + progress * Math.PI * 2;
      const color = player.id === "host" ? COLOR_RED : COLOR_BLUE;
      gfx.lineStyle(3, color, 0.85);
      gfx.beginPath();
      gfx.arc(player.x, player.y, r, start, end, false);
      gfx.strokePath();
    }
  }

  protected _resetRound(): void {
    resetBall(this.ball);
    this.ball.isScoop = false;
    this.ball.scoopTimerMs = 0;
    const midX = (FIELD_LEFT + FIELD_RIGHT) / 2;
    const midY = (FIELD_TOP + FIELD_BOTTOM) / 2;
    this.host.x = midX - 200;
    this.host.y = midY;
    this.host.vx = 0;
    this.host.vy = 0;
    this.client.x = midX + 200;
    this.client.y = midY;
    this.client.vx = 0;
    this.client.vy = 0;
    this._hostShoot.chargeMs = 0;
    this._hostShoot.charging = false;
    this._clientShoot.chargeMs = 0;
    this._clientShoot.charging = false;
    this.host.dashCharges = MAX_DASH_CHARGES;
    this.host.dashCooldownMs = 0;
    this.client.dashCharges = MAX_DASH_CHARGES;
    this.client.dashCooldownMs = 0;
    this._aiDelayMs = 2000;
    this._playerTouched = false;
    this._hasReceivedInput = false;
  }

  protected _drawSticks(): void {
    const drawStick = (
      player: { x: number; y: number },
      aim: { x: number; y: number },
      sprite: Phaser.GameObjects.Sprite,
      animMs: number,
      maxAnimMs: number,
      chargeMs: number,
      isSlap: boolean,
      hasPossession: boolean,
      dribblePhase: number,
    ): void => {
      const aimLen = Math.hypot(aim.x, aim.y);
      if (aimLen === 0) return;
      const aNx = aim.x / aimLen;
      const aNy = aim.y / aimLen;
      const sd = this._stickDir(player, aim); // perpendicular rest direction

      // While dribbling with no shot animation, point stick toward the ball's dribble position
      if (hasPossession && animMs === 0 && chargeMs === 0) {
        const { DRIBBLE_AMP, DRIBBLE_DIST } = GameScene;
        const side = Math.sin(dribblePhase) * DRIBBLE_AMP;
        const dirX = aNx * DRIBBLE_DIST + sd.x * side;
        const dirY = aNy * DRIBBLE_DIST + sd.y * side;
        const dLen = Math.hypot(dirX, dirY) || 1;
        const nx = dirX / dLen;
        const ny = dirY / dLen;
        const baseX = player.x + nx * (PLAYER_RADIUS * 0.87) + aNx * (PLAYER_RADIUS * 0.40);
        const baseY = player.y + ny * (PLAYER_RADIUS * 0.87) + aNy * (PLAYER_RADIUS * 0.40);
        sprite.setPosition(baseX, baseY);
        sprite.setRotation(Math.atan2(ny, nx));
        sprite.setFrame(6);
        return;
      }

      // angleDeg: rotation from rest. Negative = backswing, Positive = forward swing.
      // Rotates in the (sd, aimNorm) plane:  dir = cos(a)*sd + sin(a)*aimNorm
      let angleDeg = 0;

      if (animMs > 0) {
        const progress = 1 - animMs / maxAnimMs; // 0 → 1 as animation plays out
        if (isSlap) {
          // Slap release: start at full backswing, sweep hard forward, settle
          // 0–0.45: -90° → +85°   (power stroke)
          // 0.45–1: +85° → 0°    (follow-through return)
          if (progress < 0.45) {
            angleDeg = -90 + (175 * progress / 0.45);
          } else {
            angleDeg = 85 * (1 - (progress - 0.45) / 0.55);
          }
        } else {
          // Wrist shot: quick 30% wind-back then snap forward, return
          // 0–0.20: 0° → -27°    (brief wind-back)
          // 0.20–0.60: -27° → +60°  (hit)
          // 0.60–1:  +60° → 0°   (return)
          if (progress < 0.20) {
            angleDeg = -27 * (progress / 0.20);
          } else if (progress < 0.60) {
            angleDeg = -27 + 87 * ((progress - 0.20) / 0.40);
          } else {
            angleDeg = 60 * (1 - (progress - 0.60) / 0.40);
          }
        }
      } else if (chargeMs > 0) {
        // Charging slap: wind back to -90° as charge builds up to max
        const windupFrac = Math.min(chargeMs / SHOOT_MAX_CHARGE_MS_LOCAL, 1);
        angleDeg = -90 * windupFrac;
      }

      const rad = angleDeg * (Math.PI / 180);
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const dirX = c * sd.x + s * aNx;
      const dirY = c * sd.y + s * aNy;

      const dLen = Math.hypot(dirX, dirY) || 1;
      const nx = dirX / dLen;
      const ny = dirY / dLen;

      const baseX = player.x + nx * (PLAYER_RADIUS * 1.82) + aNx * (PLAYER_RADIUS * 0.84);
      const baseY = player.y + ny * (PLAYER_RADIUS * 1.82) + aNy * (PLAYER_RADIUS * 0.84);

      sprite.setPosition(baseX, baseY);
      sprite.setRotation(Math.atan2(ny, nx));
      sprite.setFrame(6);
    };

    drawStick(this.host, this._hostAimSmooth, this._hostStickSprite, this._hostShotAnimMs, 280, this._hostShoot.chargeMs, this._hostShotAnimMs === 280, this._hostHasPossession, this._hostDribblePhase);
    drawStick(this.client, this._clientAimSmooth, this._clientStickSprite, this._clientShotAnimMs, 280, this._clientShoot.chargeMs, this._clientShotAnimMs === 280, this._clientHasPossession, this._clientDribblePhase);
  }

  /**
   * Rotates `current` toward `target`, capped at 45° per fixed step.
   * Using angle-space lerp so opposite directions converge correctly.
   */
  protected _lerpAim(
    current: { x: number; y: number },
    target: { x: number; y: number }
  ): { x: number; y: number } {
    const MAX_RAD = Math.PI / 4; // 45° per fixed step
    const curAngle = Math.atan2(current.y, current.x);
    const tgtAngle = Math.atan2(target.y, target.x);
    let delta = tgtAngle - curAngle;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    const newAngle = curAngle + Math.max(-MAX_RAD, Math.min(MAX_RAD, delta));
    return { x: Math.cos(newAngle), y: Math.sin(newAngle) };
  }

  protected _repositionUI(): void {
    const sw = this.scale.width;
    const sh = this.scale.height;
    const midX = sw / 2;
    const HUD_H = 95;

    this._uiCam.setViewport(0, 0, sw, sh).setScroll(0, 0);

    const extra = Math.max(0, sw - 1280);
    const initOffsetX = Math.floor(extra / 2);
    this._hostButtons.reposition(1190 + initOffsetX, 360);
    this._hostJoy.reposition(-initOffsetX, 0, 768 + initOffsetX, 720);

    // Redraw HUD
    if (this._hudGfx) {
      const gfx = this._hudGfx;
      gfx.clear();
      // Left team panel (Red tint)
      gfx.fillGradientStyle(0x2a0a10, 0x2a0a10, 0x06060e, 0x06060e, 1);
      gfx.fillRect(0, 0, midX, HUD_H);
      // Right team panel (Blue tint)
      gfx.fillGradientStyle(0x06060e, 0x06060e, 0x0a182a, 0x0a182a, 1);
      gfx.fillRect(midX, 0, sw - midX, HUD_H);
      // Bottom separator
      gfx.lineStyle(1, 0xffffff, 0.12);
      gfx.lineBetween(0, HUD_H, sw, HUD_H);
      // Team color accent lines along the top
      gfx.lineStyle(3, COLOR_RED, 1);
      gfx.lineBetween(0, 0, midX - 80, 0);
      gfx.lineStyle(3, COLOR_BLUE, 1);
      gfx.lineBetween(midX + 80, 0, sw, 0);
      // Center score zone pill
      gfx.fillStyle(0x08080f, 0.9);
      gfx.fillRoundedRect(midX - 160, 8, 320, HUD_H - 16, 12);
      gfx.lineStyle(1, 0xffffff, 0.12);
      gfx.strokeRoundedRect(midX - 160, 8, 320, HUD_H - 16, 12);
    }

    if (this._teamLabelRed) this._teamLabelRed.setPosition(midX - 440, HUD_H / 2);
    if (this._teamLabelBlue) this._teamLabelBlue.setPosition(midX + 440, HUD_H / 2);
    if (this._scoreEyebrow) this._scoreEyebrow.setPosition(midX, 14);
    if (this._scoreText) this._scoreText.setPosition(midX, 55);
    if (this._messageText) this._messageText.setPosition(midX, 360);

    if (this._helpBtn) this._helpBtn.setPosition(sw - 64, 47);
    if (this._helpText) this._helpText.setPosition(sw - 64, 47);

    // If match over is visible, reposition those too
    if (this._matchOverObjects.length > 0 && (this._matchOverObjects[0] as unknown as Phaser.GameObjects.Components.Visible).visible) {
      this._matchOverObjects.forEach(obj => {
        if (obj instanceof Phaser.GameObjects.Rectangle || obj instanceof Phaser.GameObjects.Text) {
           // Most match over elements are at cx = scale.width / 2
           // Big background pill is also centered.
           if (obj.scrollFactorX === 0) {
              obj.setX(midX);
           }
        }
      });
    }
  }

  shutdown(): void {
    history.replaceState(null, "", window.location.pathname);
  }

  private _drawField(): void {
    const g = this._field;
    g.clear();

    const W = FIELD_RIGHT - FIELD_LEFT;
    const H = FIELD_BOTTOM - FIELD_TOP;
    const midX = (FIELD_LEFT + FIELD_RIGHT) / 2;
    const midY = (FIELD_TOP + FIELD_BOTTOM) / 2;
    const r = CORNER_RADIUS;
    const goalH = GOAL_BOTTOM - GOAL_TOP;

    // ── Field surface — bright teal matching real floorball courts ────────────
    g.fillStyle(0x2cc0b0, 1);
    g.fillRoundedRect(FIELD_LEFT, FIELD_TOP, W, H, r);

    // ── All white markings ────────────────────────────────────────────────────
    g.lineStyle(2, 0xffffff, 0.9);

    // Centre line
    g.lineBetween(midX, FIELD_TOP, midX, FIELD_BOTTOM);
    // Centre tick marks on top/bottom border
    g.lineBetween(midX - 6, FIELD_TOP, midX + 6, FIELD_TOP);
    g.lineBetween(midX - 6, FIELD_BOTTOM, midX + 6, FIELD_BOTTOM);

    // Centre circle
    g.strokeCircle(midX, midY, Math.round(2.85 * PX_PER_M));
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(midX, midY, 4);

    // Corner faceoff crosses
    g.lineStyle(2, 0xffffff, 0.8);
    const cs = 10;
    const fcx1 = FIELD_LEFT + Math.round(3.5 * PX_PER_M);
    const fcx2 = FIELD_RIGHT - Math.round(3.5 * PX_PER_M);
    const fcy1 = FIELD_TOP + Math.round(1.5 * PX_PER_M);
    const fcy2 = FIELD_BOTTOM - Math.round(1.5 * PX_PER_M);
    for (const [cx, cy] of [[fcx1, fcy1], [fcx1, fcy2], [fcx2, fcy1], [fcx2, fcy2]]) {
      g.lineBetween(cx - cs, cy, cx + cs, cy);
      g.lineBetween(cx, cy - cs, cx, cy + cs);
    }

    // ── Goals — IFF-spec goal area + goalkeeper area + stylized cage ────────────
    //
    // Outer goal area (crease): 4 m deep × 5 m wide, in front of goal mouth
    // Inner goalkeeper area (house): 1 m deep × 2.5 m wide, directly at goal mouth
    // Cage: 1.5 m deep behind goal mouth, 2 m tall (arcade scaled from 1.6 m)
    //

    const drawGoal = (left: boolean): void => {
      const mouthX = left ? GOAL_LINE_LEFT : GOAL_LINE_RIGHT;
      const cageBackX = left ? mouthX - GOAL_CAGE_DEPTH : mouthX + GOAL_CAGE_DEPTH;
      const netFillX = left ? cageBackX : mouthX;

      const teamColor = left ? COLOR_BLUE : COLOR_RED;

      // Crease extends into the field from the goal mouth (field side only, per IFF rules)
      const creaseX = left ? mouthX : mouthX - DZONE_DEPTH;
      // House extends into the field from the goal mouth (field side only, per IFF rules)
      const houseX = left ? mouthX : mouthX - HOUSE_DEPTH;

      // ── Net fill + crosshatch ────────────────────────────────────────────────
      g.fillStyle(0x0a1210, 1);
      g.fillRect(netFillX, GOAL_TOP, GOAL_CAGE_DEPTH, goalH);

      g.lineStyle(1, 0xffffff, 0.18);
      const nx0 = netFillX;
      const nx1 = netFillX + GOAL_CAGE_DEPTH;
      for (let yy = GOAL_TOP; yy <= GOAL_BOTTOM; yy += 8) {
        g.lineBetween(nx0, yy, nx1, yy);
      }
      for (let xx = nx0; xx <= nx1; xx += 8) {
        g.lineBetween(xx, GOAL_TOP, xx, GOAL_BOTTOM);
      }

      // ── Outer goal area (crease): 4 m × 5 m, field side only ───────────────
      g.fillStyle(teamColor, 0.06);
      g.fillRect(creaseX, DZONE_TOP, DZONE_DEPTH, DZONE_BOTTOM - DZONE_TOP);
      g.lineStyle(2, teamColor, 0.55);
      g.strokeRect(creaseX, DZONE_TOP, DZONE_DEPTH, DZONE_BOTTOM - DZONE_TOP);

      // ── Inner goalkeeper area (house): 1 m × 2.5 m, field side only ─────────
      g.fillStyle(teamColor, 0.18);
      g.fillRect(houseX, HOUSE_TOP, HOUSE_DEPTH, HOUSE_BOTTOM - HOUSE_TOP);
      g.lineStyle(2, teamColor, 0.9);
      g.strokeRect(houseX, HOUSE_TOP, HOUSE_DEPTH, HOUSE_BOTTOM - HOUSE_TOP);

      // ── Goal cage frame ──────────────────────────────────────────────────────
      g.lineStyle(3, 0xffffff, 0.9);
      g.strokeRect(netFillX, GOAL_TOP, GOAL_CAGE_DEPTH, goalH);

      // ── Mouth posts (team-colored circles at goal line corners) ──────────────
      const postR = 5;
      g.fillStyle(teamColor, 1);
      g.fillCircle(mouthX, GOAL_TOP, postR);
      g.fillCircle(mouthX, GOAL_BOTTOM, postR);
      g.lineStyle(2, 0xffffff, 0.8);
      g.strokeCircle(mouthX, GOAL_TOP, postR);
      g.strokeCircle(mouthX, GOAL_BOTTOM, postR);

      // ── Goal line (team color, only across mouth opening) ────────────────────
      g.lineStyle(3, teamColor, 0.9);
      g.lineBetween(mouthX, GOAL_TOP, mouthX, GOAL_BOTTOM);
    };

    drawGoal(true);   // left goal (green team)
    drawGoal(false);  // right goal (red team)

    // ── Rink border (drawn last, on top of everything) ────────────────────────
    g.lineStyle(4, 0xffffff, 1);
    g.strokeRoundedRect(FIELD_LEFT, FIELD_TOP, W, H, r);
  }

  protected _makeButton(
    x: number, y: number,
    w: number, h: number,
    label: string, sublabel: string,
    color: number, colorDark: number,
    onClick: () => void,
    scale = 1.0,
    depth = 0
  ): Phaser.GameObjects.GameObject[] {
    const W_BTN = w, H_BTN = h;
    const colorHex = `#${color.toString(16).padStart(6, "0")}`;

    const glow = this.add.rectangle(x, y, W_BTN + 8 * scale, H_BTN + 8 * scale, color, 0).setStrokeStyle(3 * scale, color, 0.25).setDepth(depth).setScrollFactor(0);
    const gradGfx = this.add.graphics().setDepth(depth).setScrollFactor(0);
    const drawGrad = (alpha: number) => {
      gradGfx.clear();
      gradGfx.fillGradientStyle(color, color, colorDark, colorDark, alpha);
      gradGfx.fillRoundedRect(x - W_BTN / 2, y - H_BTN / 2, W_BTN, H_BTN, 10 * scale);
    };
    drawGrad(0.18);
    const border = this.add.rectangle(x, y, W_BTN, H_BTN, 0x000000, 0)
      .setStrokeStyle(1.5 * scale, color, 0.7).setInteractive({ useHandCursor: true }).setDepth(depth).setScrollFactor(0);
    const accentGfx = this.add.graphics().setDepth(depth).setScrollFactor(0);
    accentGfx.lineStyle(2 * scale, color, 0.6);
    accentGfx.lineBetween(x - W_BTN / 2 + 12 * scale, y - H_BTN / 2 + 1, x + W_BTN / 2 - 12 * scale, y - H_BTN / 2 + 1);

    const hasSub = sublabel !== "";
    const titleOffsetY = hasSub ? -12 * scale : 0;
    const title = this.add.text(x, y + titleOffsetY, label, {
      fontSize: `${26 * scale}px`, fontStyle: "bold", color: "#ffffff",
      shadow: { offsetX: 0, offsetY: 1 * scale, color: colorHex, blur: 8 * scale, stroke: false, fill: true },
    }).setOrigin(0.5).setDepth(depth + 1).setScrollFactor(0);
    title.disableInteractive();

    const objs: Phaser.GameObjects.GameObject[] = [glow, gradGfx, border, accentGfx, title];

    if (hasSub) {
      const sub = this.add.text(x, y + 18 * scale, sublabel, {
        fontSize: `${12 * scale}px`, color: "#ffffff", letterSpacing: 3 * scale,
      }).setOrigin(0.5).setDepth(depth + 1).setScrollFactor(0);
      sub.disableInteractive();
      objs.push(sub);
    }

    border.on("pointerover", () => { drawGrad(0.35); glow.setStrokeStyle(3 * scale, color, 0.55); title.setShadow(0, 0, colorHex, 16 * scale, false, true); });
    border.on("pointerout", () => { drawGrad(0.18); glow.setStrokeStyle(3 * scale, color, 0.25); title.setShadow(0, 1 * scale, colorHex, 8 * scale, false, true); });
    border.on("pointerup", onClick);

    this._addUI(objs);

    return objs;
  }
}
