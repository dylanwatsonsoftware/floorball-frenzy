import Phaser from "phaser";
import type { Ball, GameMode, InputState } from "../types/game";
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
  BALL_RADIUS,
  FIXED_DT,
  ONE_TOUCH_WINDOW,
  SHOOT_MAX_CHARGE_MS as SHOOT_MAX_CHARGE_MS_LOCAL,
  HEAT_MAX,
  HEAT_DRIBBLE_RATE,
  HEAT_GOAL_BONUS,
  HEAT_MODE_DURATION,
  HEAT_MODE_DASH_COOLDOWN_MULT,
  WRIST_SNAP_MAX_CHARGE,
  WRIST_SNAP_MIN_SPEED_FRAC,
  WRIST_SNAP_POWER_BOOST,
  PLAYER_MAX_SPEED,
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
  DASH_STEAL_WINDOW,
  DASH_STEAL_FORCE,
  BOLT_SHOT_BOOST,
  BOLT_SHOT_DURATION_MS,
  POSSESSION_PULL_FACTOR,
  POSSESSION_PULL_CAP,
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
  private _hudOverlayGfx!: Phaser.GameObjects.Graphics;
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
  private _fireGraphics!: Phaser.GameObjects.Graphics;
  private _fireParticles: Array<{
    x: number; y: number; vx: number; vy: number;
    life: number; maxLife: number; size: number;
  }> = [];
  private _scoreText!: Phaser.GameObjects.Text;
  protected _messageText!: Phaser.GameObjects.Text;

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
    this._dashRingGfx = this.add.graphics().setDepth(4.5);
    // Dash ghosts
    this._ghostGraphics = this.add.graphics().setDepth(4.6);
    // Fire trail — drawn behind the ball
    this._fireGraphics = this.add.graphics().setDepth(5.5);
    // Ball drawn each frame via Graphics for physically correct rolling animation
    this._ballGraphics = this.add.graphics().setDepth(6);
    this._indicatorGraphics = this.add.graphics().setDepth(10); // Above players and ball
    this._underPlayerGraphics = this.add.graphics().setDepth(4.4); // Below players (5)
    this._hudOverlayGfx = this.add.graphics().setDepth(15); // Above scoreboard

    // Players (depth 5 — above stick, below ball)
    // Origin y=0.56 puts the rotation pivot at the character body center (slightly below frame mid)
    this._hostSprite = this.add.sprite(this.host.x, this.host.y, "char_host").setDepth(5).setScale(1.26).setOrigin(0.5, 0.56);
    this._clientSprite = this.add.sprite(this.client.x, this.client.y, "char_client").setDepth(5).setScale(1.26).setOrigin(0.5, 0.56);

    // ── Top HUD bar ────────────────────────────────────────────────────────────
    const HUD_H = 95;
    const hudGfx = this.add.graphics().setDepth(14);

    // Left team panel (green tint)
    hudGfx.fillGradientStyle(0x0a2a18, 0x0a2a18, 0x06060e, 0x06060e, 1);
    hudGfx.fillRect(0, 0, 640, HUD_H);
    // Right team panel (red/dark tint)
    hudGfx.fillGradientStyle(0x06060e, 0x06060e, 0x2a0a10, 0x2a0a10, 1);
    hudGfx.fillRect(640, 0, 640, HUD_H);
    // Bottom separator
    hudGfx.lineStyle(1, 0xffffff, 0.12);
    hudGfx.lineBetween(0, HUD_H, 1280, HUD_H);
    // Team color accent lines along the top
    hudGfx.lineStyle(3, 0x00cc66, 1);
    hudGfx.lineBetween(0, 0, 560, 0);
    hudGfx.lineStyle(3, 0xdd2244, 1);
    hudGfx.lineBetween(720, 0, 1280, 0);
    // Center score zone pill
    hudGfx.fillStyle(0x08080f, 0.9);
    hudGfx.fillRoundedRect(480, 8, 320, HUD_H - 16, 12);
    hudGfx.lineStyle(1, 0xffffff, 0.12);
    hudGfx.strokeRoundedRect(480, 8, 320, HUD_H - 16, 12);

    // Team labels with color
    this.add.text(200, HUD_H / 2, "HOME", { fontSize: "14px", color: "#00cc66", fontStyle: "bold", letterSpacing: 3 })
      .setOrigin(0.5).setDepth(15);
    this.add.text(1080, HUD_H / 2, "AWAY", { fontSize: "14px", color: "#dd2244", fontStyle: "bold", letterSpacing: 3 })
      .setOrigin(0.5).setDepth(15);

    // "SCORE" eyebrow inside pill
    this.add
      .text(640, 14, "SCORE", {
        fontSize: "9px", color: "#555577", fontStyle: "bold", letterSpacing: 2,
      })
      .setOrigin(0.5, 0)
      .setDepth(15);

    // Score — updated every frame
    this._scoreText = this.add
      .text(640, 55, "0  —  0", { fontSize: "32px", color: "#ffffff", fontStyle: "bold" })
      .setOrigin(0.5)
      .setDepth(15);

    // Goal / win message
    this._messageText = this.add
      .text(640, 360, "", {
        fontSize: "48px",
        color: "#ffff00",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(16);


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
    this._arrows = {
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      dash: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      slap: kb.addKey(Phaser.Input.Keyboard.KeyCodes.PERIOD),
    };

    kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC).on("down", () => {
      this._confirmLeave();
    });

    // Back button — top-left, inside HUD bar
    this._makeButton(64, 47, 100, 38, "‹  BACK", "", 0x555566, 0x222233, () => this._confirmLeave(), 0.6, 16);

    // Center the 1280×720 game world in the available canvas on wider screens.
    // Re-apply on every resize so mobile browser-chrome changes don't break it.
    const applyScroll = () => {
      const extra = Math.max(0, this.scale.width - 1280);
      this.cameras.main.scrollX = -Math.floor(extra / 2);
    };
    applyScroll();
    this.scale.on("resize", applyScroll);
    this.events.once("shutdown", () => this.scale.off("resize", applyScroll));

    // Touch UI — buttons are always present
    this._hostButtons = new ActionButtons(this, 1210, 360);

    // Joystick only if in stick mode
    const initOffsetX = Math.floor(Math.max(0, this.scale.width - 1280) / 2);
    this._hostJoy = new VirtualJoystick(this, -initOffsetX, 0, 768 + initOffsetX, 720, 60);
    this._hostJoy.enabled = (this._controlMode === "stick");

    // Initialize Animations
    this._createAnimations();

    // Enable multi-touch
    this.input.addPointer(3);
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

    // Decay shot animation timers
    this._hostShotAnimMs = Math.max(0, this._hostShotAnimMs - delta);
    this._clientShotAnimMs = Math.max(0, this._clientShotAnimMs - delta);

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
    this._updateHUD(delta);
    this._updateGhosts(delta);
    this._updateFire(delta);
  }

  protected _confirmLeave(): void {
    this.scene.start("MenuScene");
  }

  protected _fixedUpdate(dt: number): void {
    const elapsedMs = dt * 1000;
    this._elapsedMs += elapsedMs;
    this._runPhysics(this._readHostInput(), this._readClientInput(), dt, elapsedMs);
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

    if (stepPlayer(this.host, hostInputActual, dt, elapsedMs)) {
      this._activateHeatMode(this.host);
    }
    if (stepPlayer(this.client, clientInputActual, dt, elapsedMs)) {
      this._activateHeatMode(this.client);
    }

    this.host.aimX = this._hostAimSmooth.x;
    this.host.aimY = this._hostAimSmooth.y;
    this.client.aimX = this._clientAimSmooth.x;
    this.client.aimY = this._clientAimSmooth.y;

    this.host.chargeMs = this._hostShoot.chargeMs;
    this.client.chargeMs = this._clientShoot.chargeMs;

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
        if (this._hostHasPossession) {
          this._hostDribblePhase += dt * 2 * Math.PI * GameScene.DRIBBLE_FREQ;
          this._accumulateHeat(this.host, dt);
        }
      } else if (this._clientHasPossession) {
        this._clientHasPossession = this._applyStickPossession(this.client, clientStick, this._clientDribblePhase, this._clientShoot.charging, this._clientShotCooldownMs > 0);
        if (this._clientHasPossession) {
          this._clientDribblePhase += dt * 2 * Math.PI * GameScene.DRIBBLE_FREQ;
          this._accumulateHeat(this.client, dt);
        }
      }
    } else {
      this._hostHasPossession = this._applyStickPossession(this.host, hostStick, this._hostDribblePhase, this._hostShoot.charging, this._hostShotCooldownMs > 0);
      if (this._hostHasPossession) {
        this._hostDribblePhase += dt * 2 * Math.PI * GameScene.DRIBBLE_FREQ;
        this._accumulateHeat(this.host, dt);
        this._clientHasPossession = false;
        if (this._isAuthoritative) this.ball.possessedBy = "host";
      } else {
        this._clientHasPossession = this._applyStickPossession(this.client, clientStick, this._clientDribblePhase, this._clientShoot.charging, this._clientShotCooldownMs > 0);
        if (this._clientHasPossession) {
          this._clientDribblePhase += dt * 2 * Math.PI * GameScene.DRIBBLE_FREQ;
          this._accumulateHeat(this.client, dt);
          if (this._isAuthoritative) this.ball.possessedBy = "client";
        } else {
          if (this._isAuthoritative) this.ball.possessedBy = null;
        }
      }
    }

    this._updateLastTouch();

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

      // Velocity coupling: 0.35 total (0.1 from assist + 0.25 here)
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

    // Velocity coupling: 0.35 total (0.1 from assist + 0.25 here)
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

    const speed = Math.hypot(player.vx, player.vy);
    const isHeatMode = player.heatModeMs > 0;
    const isBolt = (player.dashCooldownMs > DASH_COOLDOWN - 200) || isHeatMode;

    // Wrist Snap Detection
    const isWristSnap = state.chargeMs < WRIST_SNAP_MAX_CHARGE && speed > PLAYER_MAX_SPEED * WRIST_SNAP_MIN_SPEED_FRAC;

    let isPerfect = releaseShot(state, this.ball, aim.x, aim.y, isOT, player.vx, player.vy);

    if (isWristSnap) {
      this.ball.vx *= WRIST_SNAP_POWER_BOOST;
      this.ball.vy *= WRIST_SNAP_POWER_BOOST;
      this.ball.isPerfect = true; // Wrist snap is always "Perfect"
      isPerfect = true;
    }

    this.ball.isPerfect = isPerfect;

    if (isBolt) {
      this.ball.vx *= BOLT_SHOT_BOOST;
      this.ball.vy *= BOLT_SHOT_BOOST;
      this.ball.isBolt = true;
      this.ball.boltTimerMs = BOLT_SHOT_DURATION_MS;
    } else {
      this.ball.isBolt = false;
      this.ball.boltTimerMs = 0;
    }

    if (isPerfect || isBolt || isWristSnap) {
      this._spawnPerfectJuice(this.ball.x, this.ball.y, isWristSnap);
      let hitstop = 0;
      if (isWristSnap) hitstop = 40;
      else if (isPerfect) hitstop = 50;
      else if (isBolt) hitstop = 30;
      this._frozenMs = Math.max(this._frozenMs, hitstop);
      this._playThunderSlapSound(isBolt);
    }
    this._lastTouch = { playerId: who, timeMs: this._elapsedMs };
    if (who === "host") this._hostShotCooldownMs = GameScene.SHOT_COOLDOWN_MS;
    else this._clientShotCooldownMs = GameScene.SHOT_COOLDOWN_MS;
  }

  private _accumulateHeat(player: PlayerExtended, dt: number): void {
    if (player.heatModeMs > 0) return;
    player.heat = Math.min(HEAT_MAX, player.heat + HEAT_DRIBBLE_RATE * dt);
    if (player.heat >= HEAT_MAX) {
      this._activateHeatMode(player);
    }
  }

  private _activateHeatMode(player: PlayerExtended): void {
    player.heatModeMs = HEAT_MODE_DURATION;
    // Apply dash cooldown reduction if they just dashed to trigger heat
    if (player.dashCooldownMs === DASH_COOLDOWN) {
      player.dashCooldownMs *= HEAT_MODE_DASH_COOLDOWN_MULT;
    }
    this._frozenMs = Math.max(this._frozenMs, 80);
    this.cameras.main.shake(200, 0.012);
    this._spawnHeatActivationJuice(player.x, player.y);
    this._playHeatActivationSound();
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

    return {
      moveX: mx,
      moveY: my,
      slap: k.slap.isDown || touch.slapHeld,
      dash: k.dash.isDown || touch.dash,
    };
  }

  protected _readClientInput(): InputState {
    const k = this._arrows;
    let mx = 0;
    let my = 0;
    if (k.left.isDown) mx -= 1;
    if (k.right.isDown) mx += 1;
    if (k.up.isDown) my -= 1;
    if (k.down.isDown) my += 1;
    return { moveX: mx, moveY: my, slap: k.slap.isDown, dash: k.dash.isDown };
  }

  protected _onPlayerPlayerContact(p1: PlayerExtended, p2: PlayerExtended): void {
    // Check if either player is dashing
    const p1Dashing = p1.dashCooldownMs > DASH_COOLDOWN - DASH_STEAL_WINDOW;
    const p2Dashing = p2.dashCooldownMs > DASH_COOLDOWN - DASH_STEAL_WINDOW;

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

  protected _onGoal(scorer: "host" | "client"): void {
    const p = scorer === "host" ? this.host : this.client;
    if (p.heatModeMs <= 0) {
      p.heat = Math.min(HEAT_MAX, p.heat + HEAT_GOAL_BONUS);
      if (p.heat >= HEAT_MAX) this._activateHeatMode(p);
    }

    this.score[scorer]++;
    const isWin = this.score[scorer] >= WINNING_SCORE;
    const label = scorer === "host" ? "Green scores!" : "Black scores!";
    if (isWin) {
      this._messageText.setText(`${scorer === "host" ? "Green" : "Black"} wins!`);
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
    const cx = 640, cy = 360;
    const data = JSON.parse(localStorage.getItem("floorball:streak") || '{"winner":"","count":0}');
    const streakText = data.count > 1 ? `WIN STREAK: ${data.count}` : "FIRST WIN!";

    // Overlay background
    const bg = this.add.rectangle(cx, cy, 600, 350, 0x000000, 0.9).setDepth(30);

    const title = this.add.text(cx, cy - 100, "MATCH OVER", { fontSize: "32px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5).setDepth(31);
    const winLabel = this.add.text(cx, cy - 40, `${winner === "host" ? "GREEN" : "BLACK"} TEAM WINS!`, { fontSize: "40px", color: "#ffff00", fontStyle: "bold" }).setOrigin(0.5).setDepth(31);
    const streakLabel = this.add.text(cx, cy + 20, streakText, { fontSize: "24px", color: "#00cc66", fontStyle: "bold" }).setOrigin(0.5).setDepth(31);

    // Rematch button
    const isStreak = data.count > 1;
    const btnColor = isStreak ? 0xffcc00 : 0x00cc66;
    const btnText = isStreak ? "KEEP THE STREAK!" : "REMATCH";
    const rematchBtn = this.add.rectangle(cx, cy + 100, 280, 60, btnColor, 1).setDepth(31).setInteractive({ useHandCursor: true });
    const rematchText = this.add.text(cx, cy + 100, btnText, { fontSize: isStreak ? "18px" : "24px", color: isStreak ? "#000000" : "#ffffff", fontStyle: "bold" }).setOrigin(0.5).setDepth(31);

    if (isStreak) {
      this.tweens.add({
        targets: rematchBtn,
        alpha: 0.8,
        duration: 400,
        yoyo: true,
        repeat: -1,
      });
    }

    rematchBtn.on("pointerover", () => { rematchBtn.setScale(1.05); if (!isStreak) rematchBtn.setFillStyle(0x00ee77); });
    rematchBtn.on("pointerout", () => { rematchBtn.setScale(1.0); rematchBtn.setFillStyle(btnColor); });

    rematchBtn.on("pointerup", () => this._handleRematchClick(rematchBtn, rematchText));

    // Menu button
    const menuBtn = this.add.rectangle(cx, cy + 170, 250, 60, 0x444466, 1).setDepth(31).setInteractive({ useHandCursor: true });
    const menuText = this.add.text(cx, cy + 170, "MENU", { fontSize: "24px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5).setDepth(31);

    menuBtn.on("pointerover", () => { menuBtn.setScale(1.05); menuBtn.setFillStyle(0x555577); });
    menuBtn.on("pointerout", () => { menuBtn.setScale(1.0); menuBtn.setFillStyle(0x444466); });

    menuBtn.on("pointerup", () => this.scene.start("MenuScene"));

    this._matchOverObjects = [bg, title, winLabel, streakLabel, rematchBtn, rematchText, menuBtn, menuText];
  }

  protected _clearMatchOver(): void {
    this._matchOverObjects.forEach(obj => obj.destroy());
    this._matchOverObjects = [];
  }

  protected _resetMatch(): void {
    this.score = { host: 0, client: 0 };
    this._resetRound();
    this._frozenMs = 0;
    this._isGoalPause = false;
    this._messageText.setText("");
    this._hostShotCooldownMs = 0;
    this._clientShotCooldownMs = 0;
  }

  protected _handleRematchClick(btn: Phaser.GameObjects.Rectangle, text: Phaser.GameObjects.Text): void {
    text.setText("WAITING...");
    btn.disableInteractive();
    btn.setAlpha(0.6);
    this.scene.restart();
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
    if (speed > FIRE_THRESHOLD) {
      const excess = speed - FIRE_THRESHOLD;
      const spawnCount = Math.random() < (excess / 400) ? 2 : 1;
      const invSpeed = 1 / speed;
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
          size: 3 + Math.random() * 5,
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
        // Cyan (t=1) -> White (t=0.5) -> Cyan (0)
        const g = 255;
        const b = 255;
        const r = Math.round(Math.max(0, 1 - Math.abs(t - 0.5) * 2) * 255);
        color = (r << 16) | (g << 8) | b;
      } else if (this.ball.isBolt) {
        // Bright Violet/Pink (t=1) -> White (t=0.5) -> Violet (t=0)
        const r = 255;
        const b = 255;
        const g = Math.round(Math.max(0, 1 - Math.abs(t - 0.5) * 2) * 255);
        color = (r << 16) | (g << 8) | b;
      } else {
        // Classic Fire: bright yellow (t=1) → orange (t=0.5) → pure red (t<0.5)
        const r = 0xff;
        const g = t > 0.5 ? Math.round((t - 0.5) * 2 * 220) : 0;
        color = (r << 16) | (g << 8);
      }

      this._fireGraphics.fillStyle(color, Math.min(1, t * 1.1));
      this._fireGraphics.fillCircle(p.x, p.y, p.size * t);
      return true;
    });
  }

  private _spawnPerfectJuice(x: number, y: number, isWristSnap = false): void {
    this.cameras.main.shake(150, 0.005);

    // Expanding shockwave ring
    const ring = this.add.graphics().setDepth(20);
    const data = { r: 10, a: 1 };
    const color = isWristSnap ? 0x00ffff : 0xffffff;
    this.tweens.add({
      targets: data,
      r: 100,
      a: 0,
      duration: 300,
      ease: "Cubic.out",
      onUpdate: () => {
        ring.clear();
        ring.lineStyle(4, color, data.a);
        ring.strokeCircle(x, y, data.r);
      },
      onComplete: () => ring.destroy(),
    });
  }

  private _spawnHeatActivationJuice(x: number, y: number): void {
    // White screen flash
    const flash = this.add.rectangle(640, 360, 1280, 720, 0xffffff, 0).setDepth(100).setScrollFactor(0);
    this.tweens.add({
      targets: flash,
      fillAlpha: 0.25,
      duration: 50,
      yoyo: true,
      onComplete: () => flash.destroy(),
    });

    // Fire burst
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 200 + Math.random() * 400;
      this._fireParticles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 400 + Math.random() * 200,
        maxLife: 600,
        size: 10 + Math.random() * 10,
      });
    }
  }

  private _playThunderSlapSound(isBolt: boolean): void {
    try {
      const ctx = (this.game.sound as any).context;
      if (!ctx) return;
      const t0 = ctx.currentTime;

      // 1. "Wooden Crack" - high frequency burst
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1200, t0);
      osc.frequency.exponentialRampToValueAtTime(100, t0 + 0.1);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.4, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.01, t0 + 0.15);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.15);

      // 2. "Sub-Bass Thump" (only for Bolt/Perfect)
      const sub = ctx.createOscillator();
      const subG = ctx.createGain();
      sub.type = "sine";
      sub.frequency.setValueAtTime(80, t0);
      sub.frequency.exponentialRampToValueAtTime(40, t0 + 0.2);
      subG.gain.setValueAtTime(isBolt ? 0.6 : 0.3, t0);
      subG.gain.exponentialRampToValueAtTime(0.01, t0 + 0.25);
      sub.connect(subG);
      subG.connect(ctx.destination);
      sub.start(t0);
      sub.stop(t0 + 0.25);
    } catch { /* ignore */ }
  }

  private _playHeatActivationSound(): void {
    try {
      const ctx = (this.game.sound as any).context;
      if (!ctx) return;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(200, t0);
      osc.frequency.exponentialRampToValueAtTime(800, t0 + 0.4);

      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.3, t0 + 0.05);
      g.gain.linearRampToValueAtTime(0, t0 + 0.5);

      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.5);
    } catch { /* audio not available */ }
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
    g.clear();
    gu.clear();

    const drawForPlayer = (
      player: PlayerExtended,
      aim: { x: number; y: number },
      isLocal: boolean,
      shootState: ShootState,
      hasPossession: boolean
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

        // Orange to Yellow gradient
        g.fillGradientStyle(0xff8800, 0xffff00, 0xff8800, 0xffff00, 0.9, 0.9, 0.9, 0.9);

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

      // 2. Ownership "YOU" indicator
      if (isLocal) {
        // Yellow oval below the character
        gu.lineStyle(3, 0xffff00, 0.8);
        gu.strokeEllipse(player.x + 5, player.y + 30, 60, 30);

        // Small triangle above
        const ty = player.y - PLAYER_RADIUS - 30;
        g.fillStyle(0xffff00, 1);
        g.fillTriangle(
          player.x - 6, ty - 8,
          player.x + 6, ty - 8,
          player.x, ty
        );
      }
    };

    if (this._mode === "local") {
      drawForPlayer(this.host, this._hostAimSmooth, true, this._hostShoot, this._hostHasPossession);
      drawForPlayer(this.client, this._clientAimSmooth, false, this._clientShoot, this._clientHasPossession);
    } else {
      const isHostLocal = this._isAuthoritative;
      drawForPlayer(this.host, this._hostAimSmooth, isHostLocal, this._hostShoot, this._hostHasPossession);
      drawForPlayer(this.client, this._clientAimSmooth, !isHostLocal, this._clientShoot, this._clientHasPossession);
    }
  }

  protected _syncSprites(): void {
    const isHeatModeHost = this.host.heatModeMs > 0;
    const isHeatModeClient = this.client.heatModeMs > 0;

    // Heat Mode particles (flaming stick)
    const activeHeat = [];
    if (isHeatModeHost) activeHeat.push({ p: this.host, aim: this._hostAimSmooth });
    if (isHeatModeClient) activeHeat.push({ p: this.client, aim: this._clientAimSmooth });

    for (const { p, aim } of activeHeat) {
      const sd = this._stickDir(p, aim);
      const bx = p.x + sd.x * STICK_REACH;
      const by = p.y + sd.y * STICK_REACH;

      if (Math.random() < 0.4) {
        this._fireParticles.push({
          x: bx + (Math.random() - 0.5) * 20,
          y: by + (Math.random() - 0.5) * 20,
          vx: (Math.random() - 0.5) * 100,
          vy: -50 - Math.random() * 100,
          life: 300,
          maxLife: 300,
          size: 4 + Math.random() * 6,
        });
      }
    }

    // Ball rises visually as z increases; scale grows noticeably with height
    const visualY = this.ball.y - this.ball.z * 0.6;
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
    if (this.host.dashCooldownMs > DASH_BURST && Math.floor(this.time.now / 40) % 2 === 0) {
      this._ghosts.push({
        x: this.host.x,
        y: this.host.y,
        rotation: this._hostSprite.rotation,
        frame: this._hostSprite.frame.name as unknown as number,
        alpha: 0.5,
        life: GameScene.GHOST_LIFETIME,
        color: 0x00cc66,
      });
    }
    if (this.client.dashCooldownMs > DASH_BURST && Math.floor(this.time.now / 40) % 2 === 0) {
      this._ghosts.push({
        x: this.client.x,
        y: this.client.y,
        rotation: this._clientSprite.rotation,
        frame: this._clientSprite.frame.name as unknown as number,
        alpha: 0.5,
        life: GameScene.GHOST_LIFETIME,
        color: 0xdd2244,
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

  private _updateHUD(_delta: number): void {
    const g = this._hudOverlayGfx;
    g.clear();

    const drawHeatBar = (x: number, y: number, w: number, h: number, heat: number, isHeatMode: boolean) => {
      // Background
      g.fillStyle(0x000000, 0.5);
      g.fillRoundedRect(x, y, w, h, 4);

      if (heat <= 0) return;

      const fillW = (heat / HEAT_MAX) * w;
      if (isHeatMode) {
        // Pulsing orange bar
        const pulse = 0.8 + Math.sin(this.time.now / 50) * 0.2;
        g.fillGradientStyle(0xff8800, 0xffbb00, 0xff4400, 0xff8800, pulse);
      } else {
        // Cyan bar
        g.fillGradientStyle(0x00ffff, 0x00ffff, 0x0088ff, 0x0088ff, 0.9);
      }
      g.fillRoundedRect(x, y, fillW, h, 4);

      // Border
      g.lineStyle(1, 0xffffff, 0.2);
      g.strokeRoundedRect(x, y, w, h, 4);
    };

    // Host heat bar (bottom of pill, left half)
    drawHeatBar(495, 82, 140, 8, this.host.heat, this.host.heatModeMs > 0);
    // Client heat bar (bottom of pill, right half)
    drawHeatBar(645, 82, 140, 8, this.client.heat, this.client.heatModeMs > 0);
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
      gfx.lineStyle(3, 0x00ff66, 0.85);
      gfx.beginPath();
      gfx.arc(player.x, player.y, r, start, end, false);
      gfx.strokePath();
    }
  }

  protected _resetRound(): void {
    resetBall(this.ball);
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

      const teamColor = left ? 0x004422 : 0xdd2244;

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

  private _makeButton(
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

    const glow = this.add.rectangle(x, y, W_BTN + 8 * scale, H_BTN + 8 * scale, color, 0).setStrokeStyle(3 * scale, color, 0.25).setDepth(depth);
    const gradGfx = this.add.graphics().setDepth(depth);
    const drawGrad = (alpha: number) => {
      gradGfx.clear();
      gradGfx.fillGradientStyle(color, color, colorDark, colorDark, alpha);
      gradGfx.fillRoundedRect(x - W_BTN / 2, y - H_BTN / 2, W_BTN, H_BTN, 10 * scale);
    };
    drawGrad(0.18);
    const border = this.add.rectangle(x, y, W_BTN, H_BTN, 0x000000, 0)
      .setStrokeStyle(1.5 * scale, color, 0.7).setInteractive({ useHandCursor: true }).setDepth(depth);
    const accentGfx = this.add.graphics().setDepth(depth);
    accentGfx.lineStyle(2 * scale, color, 0.6);
    accentGfx.lineBetween(x - W_BTN / 2 + 12 * scale, y - H_BTN / 2 + 1, x + W_BTN / 2 - 12 * scale, y - H_BTN / 2 + 1);

    const hasSub = sublabel !== "";
    const titleOffsetY = hasSub ? -12 * scale : 0;
    const title = this.add.text(x, y + titleOffsetY, label, {
      fontSize: `${26 * scale}px`, fontStyle: "bold", color: "#ffffff",
      shadow: { offsetX: 0, offsetY: 1 * scale, color: colorHex, blur: 8 * scale, stroke: false, fill: true },
    }).setOrigin(0.5).setDepth(depth + 1);
    title.disableInteractive();

    const objs: Phaser.GameObjects.GameObject[] = [glow, gradGfx, border, accentGfx, title];

    if (hasSub) {
      const sub = this.add.text(x, y + 18 * scale, sublabel, {
        fontSize: `${12 * scale}px`, color: "#ffffff", letterSpacing: 3 * scale,
      }).setOrigin(0.5).setDepth(depth + 1);
      sub.disableInteractive();
      objs.push(sub);
    }

    border.on("pointerover", () => { drawGrad(0.35); glow.setStrokeStyle(3 * scale, color, 0.55); title.setShadow(0, 0, colorHex, 16 * scale, false, true); });
    border.on("pointerout", () => { drawGrad(0.18); glow.setStrokeStyle(3 * scale, color, 0.25); title.setShadow(0, 1 * scale, colorHex, 8 * scale, false, true); });
    border.on("pointerup", onClick);

    return objs;
  }
}
