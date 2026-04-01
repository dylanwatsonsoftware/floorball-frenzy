import Phaser from "phaser";
import type { Ball, GameMode, InputState } from "../types/game";
import type { PlayerExtended } from "../physics/playerPhysics";
import { createPlayer, stepPlayer } from "../physics/playerPhysics";
import { stepBall, resetBall, applyPossessionAssist } from "../physics/ballPhysics";
import { resolvePlayerBallCollision, resolveStickTipCollision } from "../physics/collision";
import { stickDir as stickDirPure, ballInRange } from "../physics/stickUtils";
import {
  createShootState,
  updateShootCharge,
  releaseShot,
  wristShot,
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
  CORNER_RADIUS,
  DZONE_DEPTH,
  DZONE_TOP,
  DZONE_BOTTOM,
  GOAL_CAGE_DEPTH,
  PX_PER_M,
  STICK_REACH,
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
  private _hostShotCooldownMs = 0;
  private _clientShotCooldownMs = 0;
  private static readonly SHOT_COOLDOWN_MS = 200;

  // Touch UI (present on mobile; keyboard still works on desktop)
  protected _hostJoy!: VirtualJoystick;
  protected _hostButtons!: ActionButtons;

  // Graphics / display objects
  private _field!: Phaser.GameObjects.Graphics;
  private _hostStickSprite!: Phaser.GameObjects.Sprite;
  private _clientStickSprite!: Phaser.GameObjects.Sprite;
  private _hostSprite!: Phaser.GameObjects.Sprite;
  private _clientSprite!: Phaser.GameObjects.Sprite;
  private _ballGraphics!: Phaser.GameObjects.Graphics;
  // Ball orientation as quaternion [w, x, y, z]; updated each frame via rolling rotation
  protected _ballQuat: [number, number, number, number] = [1, 0, 0, 0];

  // 16 dot positions on a unit sphere (Fibonacci spiral — evenly spread, ~8 visible per frame)
  private static readonly BALL_DOTS: [number, number, number][] = (() => {
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
  private _hostChargeBar!: Phaser.GameObjects.Rectangle;
  private _clientChargeBar!: Phaser.GameObjects.Rectangle;
  private _scoreText!: Phaser.GameObjects.Text;
  protected _messageText!: Phaser.GameObjects.Text;

  // Fixed timestep accumulator
  private _accumulator = 0;

  // Frozen while showing goal message
  protected _frozenMs = 0;

  // Shot animation (countdown ms per player; used by _drawSticks)
  protected _hostShotAnimMs = 0;
  protected _clientShotAnimMs = 0;


  // Keys
  protected _wasd!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    dash: Phaser.Input.Keyboard.Key;
    wrist: Phaser.Input.Keyboard.Key;
    slap: Phaser.Input.Keyboard.Key;
  };
  protected _arrows!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    dash: Phaser.Input.Keyboard.Key;
    wrist: Phaser.Input.Keyboard.Key;
    slap: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { mode: GameMode }): void {
    this._mode = data.mode ?? "local";
    this.score = { host: 0, client: 0 };
    this._accumulator = 0;
    this._frozenMs = 0;
    this._elapsedMs = 0;
    this._hostSlapWasDown = false;
    this._clientSlapWasDown = false;
  }

  create(): void {
    const midX = (FIELD_LEFT + FIELD_RIGHT) / 2;
    const midY = (FIELD_TOP + FIELD_BOTTOM) / 2;

    this.host = createPlayer("host", midX - 200, midY);
    this.client = createPlayer("client", midX + 200, midY);
    this.ball = { x: midX, y: midY, z: 0, vx: 0, vy: 0, vz: 0 };

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
    // Ball drawn each frame via Graphics for physically correct rolling animation
    this._ballGraphics = this.add.graphics().setDepth(6);

    // Players (depth 5 — above stick, below ball)
    // Origin y=0.56 puts the rotation pivot at the character body center (slightly below frame mid)
    this._hostSprite = this.add.sprite(this.host.x, this.host.y, "char_host").setDepth(5).setScale(1.26).setOrigin(0.5, 0.56);
    this._clientSprite = this.add.sprite(this.client.x, this.client.y, "char_client").setDepth(5).setScale(1.26).setOrigin(0.5, 0.56);

    // Charge bars (shown above each player when charging slap)
    const BAR_W = 40;
    const BAR_H = 5;
    this._hostChargeBar = this.add
      .rectangle(this.host.x, this.host.y - PLAYER_RADIUS - 8, 0, BAR_H, 0xffff00)
      .setOrigin(0, 0.5)
      .setDepth(5);
    this._clientChargeBar = this.add
      .rectangle(this.client.x, this.client.y - PLAYER_RADIUS - 8, 0, BAR_H, 0xffff00)
      .setOrigin(0, 0.5)
      .setDepth(5);
    // store max width for scaling
    (this._hostChargeBar as Phaser.GameObjects.Rectangle & { maxW: number }).maxW = BAR_W;
    (this._clientChargeBar as Phaser.GameObjects.Rectangle & { maxW: number }).maxW = BAR_W;

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

    // ── Bottom keyboard hints ───────────────────────────────────────────────────
    this.add.text(FIELD_LEFT, FIELD_BOTTOM + 10,
      "Green: WASD · Shift dash · Q wrist · E slap", {
      fontSize: "13px", color: "#444466",
    });
    this.add.text(FIELD_RIGHT, FIELD_BOTTOM + 10,
      "Black: Arrows · Space dash · , wrist · . slap", {
      fontSize: "13px", color: "#444466",
    }).setOrigin(1, 0);

    // Keyboard bindings
    const kb = this.input.keyboard!;
    this._wasd = {
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      dash: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      wrist: kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      slap: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
    };
    this._arrows = {
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      dash: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      wrist: kb.addKey(Phaser.Input.Keyboard.KeyCodes.COMMA),
      slap: kb.addKey(Phaser.Input.Keyboard.KeyCodes.PERIOD),
    };

    // Wrist shots on key-down
    this._wasd.wrist.on("down", () => this._doWristShot("host"));
    this._arrows.wrist.on("down", () => this._doWristShot("client"));

    kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC).on("down", () => {
      this._confirmLeave();
    });

    // Back button — top-left, inside HUD bar
    const backBg = this.add
      .rectangle(14, 47, 100, 38, 0x1a1a2e, 1)
      .setOrigin(0, 0.5)
      .setStrokeStyle(1, 0x00e5ff, 0.35)
      .setInteractive({ useHandCursor: true })
      .setDepth(16);
    const backLabel = this.add
      .text(64, 47, "‹ BACK", { fontSize: "14px", color: "#8888aa", fontStyle: "bold" })
      .setOrigin(0.5)
      .setDepth(16);
    backLabel.disableInteractive();
    backBg.on("pointerover", () => { backLabel.setColor("#ffffff"); backBg.setStrokeStyle(1, 0x00e5ff, 0.9); });
    backBg.on("pointerout", () => { backLabel.setColor("#8888aa"); backBg.setStrokeStyle(1, 0x00e5ff, 0.35); });
    backBg.on("pointerup", () => this._confirmLeave());

    // Touch UI — joystick anywhere in the left 60%, buttons on the far right
    this._hostJoy = new VirtualJoystick(this, 0, 0, 768, 720);
    this._hostButtons = new ActionButtons(this, 1210, 360);

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
        this._messageText.setText("");
        this._resetRound();
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
   * Called by _fixedUpdate (local) and directly by OnlineGameScene (host)
   * with network-received client input so there is no indirection.
   */
  protected _runPhysics(
    hostInput: InputState,
    clientInput: InputState,
    dt: number,
    elapsedMs: number
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

    stepPlayer(this.host, hostInputActual, dt, elapsedMs);
    stepPlayer(this.client, clientInputActual, dt, elapsedMs);

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
    resolvePlayerBallCollision(this.host, this.ball);
    resolvePlayerBallCollision(this.client, this.ball);
    resolveStickTipCollision(this.host, this.ball, hostStick.x, hostStick.y);
    resolveStickTipCollision(this.client, this.ball, clientStick.x, clientStick.y);
    this._applyStickPossession(this.host, hostStick, this._hostShoot.charging, this._hostShotCooldownMs > 0);
    this._applyStickPossession(this.client, clientStick, this._clientShoot.charging, this._clientShotCooldownMs > 0);

    this._updateLastTouch();

    const goal = stepBall(this.ball, dt);
    if (goal) this._onGoal(goal);
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
    isCharging = false,
    shotCooldownActive = false
  ): void {
    if (shotCooldownActive) return;
    const tipX = player.x + stickDir.x * STICK_REACH;
    const tipY = player.y + stickDir.y * STICK_REACH;
    const dx = this.ball.x - tipX;
    const dy = this.ball.y - tipY;
    const dist = Math.hypot(dx, dy);

    if (dist > BALL_RADIUS + 28) return; // outside possession range

    // When charging a slap shot, allow the ball to be carried even at speed
    // so the player doesn't run past it before releasing.
    const relSpeedCap = isCharging ? 600 : 480;
    const relSpeed = Math.hypot(this.ball.vx - player.vx, this.ball.vy - player.vy);
    if (relSpeed > relSpeedCap) return;

    // Velocity coupling — reduced to make ball easier to steal
    applyPossessionAssist(this.ball, player.vx, player.vy);
    this.ball.vx += (player.vx - this.ball.vx) * 0.22;
    this.ball.vy += (player.vy - this.ball.vy) * 0.22;

    // Position: pull ball to tip surface
    if (dist > 0) {
      const nx = dx / dist;
      const ny = dy / dist;
      const restDist = BALL_RADIUS;
      this.ball.x = tipX + nx * (restDist + (dist - restDist) * 0.50);
      this.ball.y = tipY + ny * (restDist + (dist - restDist) * 0.50);
    }
  }

  protected _doWristShot(who: "host" | "client"): void {
    if (this._frozenMs > 0) return;
    // Always play the swing animation on button press
    if (who === "host") this._hostShotAnimMs = 180;
    else this._clientShotAnimMs = 180;
    // Only apply ball physics when in range
    if (!this._ballInRange(who)) return;
    const aim = who === "host" ? this._hostAimSmooth : this._clientAimSmooth;
    const player = who === "host" ? this.host : this.client;
    wristShot(this.ball, aim.x, aim.y, this._isOneTouch(who), player.vx, player.vy);
    this._lastTouch = { playerId: who, timeMs: this._elapsedMs };
    if (who === "host") this._hostShotCooldownMs = GameScene.SHOT_COOLDOWN_MS;
    else this._clientShotCooldownMs = GameScene.SHOT_COOLDOWN_MS;
  }

  protected _doSlapShot(who: "host" | "client"): void {
    // Always play the swing animation on release
    if (who === "host") this._hostShotAnimMs = 280;
    else this._clientShotAnimMs = 280;
    // Only apply ball physics when in range
    if (!this._ballInRange(who)) return;
    const state = who === "host" ? this._hostShoot : this._clientShoot;
    const aim = who === "host" ? this._hostAimSmooth : this._clientAimSmooth;
    const player = who === "host" ? this.host : this.client;
    releaseShot(state, this.ball, aim.x, aim.y, this._isOneTouch(who), player.vx, player.vy);
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

    // Merge touch joystick (takes priority when active)
    if (this._hostJoy.isActive()) {
      mx = this._hostJoy.value.x;
      my = this._hostJoy.value.y;
    }

    const touch = this._hostButtons.read();
    if (touch.wrist) this._doWristShot("host");

    return {
      moveX: mx,
      moveY: my,
      wrist: k.wrist.isDown,
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
    return { moveX: mx, moveY: my, wrist: k.wrist.isDown, slap: k.slap.isDown, dash: k.dash.isDown };
  }

  protected _onGoal(scorer: "host" | "client"): void {
    this.score[scorer]++;
    const label = scorer === "host" ? "Green scores!" : "Black scores!";
    if (this.score[scorer] >= WINNING_SCORE) {
      this._messageText.setText(`${scorer === "host" ? "Green" : "Black"} wins!`);
      this._frozenMs = 3000;
      this.time.delayedCall(3000, () => this.scene.start("MenuScene"));
    } else {
      this._messageText.setText(`${label}  ${this.score.host} — ${this.score.client}`);
      this._frozenMs = 1500;
    }
  }

  protected _syncSprites(): void {
    // Ball rises visually as z increases; scale grows noticeably with height
    const visualY = this.ball.y - this.ball.z * 0.6;
    const displayR = BALL_RADIUS * (1 + this.ball.z * 0.003);
    const depth = 6 + this.ball.z * 0.01;
    this._ballGraphics.clear().setPosition(this.ball.x, visualY).setDepth(depth);

    // White ball body
    this._ballGraphics.fillStyle(0xffffff, 1);
    this._ballGraphics.fillCircle(0, 0, displayR);

    // Rotate each dot by the ball's orientation quaternion and project to screen.
    // wz > 0 = visible upper hemisphere; wz maps to screen-y via the scene's 0.6 perspective factor.
    const [qw, qx, qy, qz] = this._ballQuat;
    const dotBaseR = Math.max(1, displayR * 0.22);
    this._ballGraphics.fillStyle(0xcccccc, 1);
    for (const [bx, by, bz] of GameScene.BALL_DOTS) {
      // Rotate dot position by quaternion: v' = q * v * q^-1 (Rodrigues via quaternion)
      const tx = 2 * (qy * bz - qz * by);
      const ty = 2 * (qz * bx - qx * bz);
      const tz = 2 * (qx * by - qy * bx);
      const wx = bx + qw * tx + qy * tz - qz * ty;
      const wy = by + qw * ty + qz * tx - qx * tz;
      const wz = bz + qw * tz + qx * ty - qy * tx;
      if (wz <= 0) continue; // lower hemisphere — occluded by ball
      const screenX = wx * displayR;
      const screenY = wy * displayR - wz * displayR * 0.6;
      const dotR = dotBaseR * wz;
      const distFromCenter = Math.sqrt(screenX * screenX + screenY * screenY);
      if (distFromCenter + dotR > displayR) continue; // would bleed outside ball edge
      this._ballGraphics.fillCircle(screenX, screenY, dotR);
    }

    // Shadow stays at ground position, shrinks and fades as ball rises
    const shadowScale = Math.max(0.3, 1 - this.ball.z * 0.004);
    const shadowAlpha = Math.max(0, 0.45 - this.ball.z * 0.002);
    this._ballShadow.setPosition(this.ball.x, this.ball.y).setScale(shadowScale).setAlpha(shadowAlpha);

    const POSSESSION_RANGE = BALL_RADIUS + 28;
    const hostStickDir = this._stickDir(this.host, this._hostAimSmooth);
    const hostTipX = this.host.x + hostStickDir.x * STICK_REACH;
    const hostTipY = this.host.y + hostStickDir.y * STICK_REACH;
    const hostHasBall = Math.hypot(this.ball.x - hostTipX, this.ball.y - hostTipY) <= POSSESSION_RANGE;

    const clientStickDir = this._stickDir(this.client, this._clientAimSmooth);
    const clientTipX = this.client.x + clientStickDir.x * STICK_REACH;
    const clientTipY = this.client.y + clientStickDir.y * STICK_REACH;
    const clientHasBall = Math.hypot(this.ball.x - clientTipX, this.ball.y - clientTipY) <= POSSESSION_RANGE;
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

    // Charge bars
    this._updateChargeBar(this._hostChargeBar, this._hostShoot, this.host.x - 20, this.host.y - PLAYER_RADIUS - 8);
    this._updateChargeBar(this._clientChargeBar, this._clientShoot, this.client.x - 20, this.client.y - PLAYER_RADIUS - 8);

    this._scoreText.setText(`${this.score.host}  —  ${this.score.client}`);
  }

  private _updateChargeBar(
    bar: Phaser.GameObjects.Rectangle,
    shoot: ShootState,
    x: number,
    y: number
  ): void {
    const MAX_W = 40;
    if (shoot.charging && shoot.chargeMs > 0) {
      const ratio = Math.min(shoot.chargeMs / SHOOT_MAX_CHARGE_MS_LOCAL, 1);
      bar.setPosition(x, y).setSize(MAX_W * ratio, 5).setVisible(true);
    } else {
      bar.setVisible(false);
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
      isSlap: boolean
    ): void => {
      const aimLen = Math.hypot(aim.x, aim.y);
      if (aimLen === 0) return;
      const aNx = aim.x / aimLen;
      const aNy = aim.y / aimLen;
      const sd = this._stickDir(player, aim); // perpendicular rest direction

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

    drawStick(this.host, this._hostAimSmooth, this._hostStickSprite, this._hostShotAnimMs, 280, this._hostShoot.chargeMs, this._hostShotAnimMs === 280);
    drawStick(this.client, this._clientAimSmooth, this._clientStickSprite, this._clientShotAnimMs, 280, this._clientShoot.chargeMs, this._clientShotAnimMs === 280);
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
    const HOUSE_DEPTH = Math.round(1 * PX_PER_M); // 28 px — goalkeeper area depth
    const HOUSE_W = Math.round(2.5 * PX_PER_M); // 70 px — goalkeeper area width

    const drawGoal = (left: boolean): void => {
      const mouthX = left ? GOAL_LINE_LEFT : GOAL_LINE_RIGHT;
      const cageBackX = left ? mouthX - GOAL_CAGE_DEPTH : mouthX + GOAL_CAGE_DEPTH;
      const netFillX = left ? cageBackX : mouthX;
      const midGoalY = (GOAL_TOP + GOAL_BOTTOM) / 2;

      const teamColor = left ? 0x004422 : 0xdd2244;

      // Crease extends into the field from the goal mouth (field side only, per IFF rules)
      const creaseX = left ? mouthX : mouthX - DZONE_DEPTH;
      // House extends into the field from the goal mouth (field side only, per IFF rules)
      const houseX = left ? mouthX : mouthX - HOUSE_DEPTH;
      const houseTop = midGoalY - HOUSE_W / 2;

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
      g.fillRect(houseX, houseTop, HOUSE_DEPTH, HOUSE_W);
      g.lineStyle(2, teamColor, 0.9);
      g.strokeRect(houseX, houseTop, HOUSE_DEPTH, HOUSE_W);

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
}
