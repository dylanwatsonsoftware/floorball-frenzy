import Phaser from "phaser";
import type { Ball, GameMode, InputState } from "../types/game";
import type { PlayerExtended } from "../physics/playerPhysics";
import { createPlayer, stepPlayer } from "../physics/playerPhysics";
import { stepBall, resetBall, applyPossessionAssist } from "../physics/ballPhysics";
import { resolvePlayerBallCollision, resolveStickTipCollision } from "../physics/collision";
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
  PX_PER_M,
  STICK_LENGTH,
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

  // One-touch tracking
  private _lastTouch: LastTouch = { playerId: "", timeMs: 0 };
  protected _elapsedMs = 0; // total game time in ms

  // Was slap held last frame? (to detect release)
  protected _hostSlapWasDown = false;
  protected _clientSlapWasDown = false;

  // Touch UI (present on mobile; keyboard still works on desktop)
  protected _hostJoy!: VirtualJoystick;
  protected _hostButtons!: ActionButtons;

  // Graphics / display objects
  private _field!: Phaser.GameObjects.Graphics;
  private _stickGraphics!: Phaser.GameObjects.Graphics;
  private _hostSprite!: Phaser.GameObjects.Arc;
  private _clientSprite!: Phaser.GameObjects.Arc;
  private _ballSprite!: Phaser.GameObjects.Arc;
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

    // Static field
    this._field = this.add.graphics();
    this._drawField();

    // Stick graphics (redrawn every frame, above field but below players/ball)
    this._stickGraphics = this.add.graphics().setDepth(3);

    // Ball shadow
    this._ballShadow = this.add.circle(midX, midY, BALL_RADIUS, 0x000000, 0.3).setDepth(4);
    // Ball
    this._ballSprite = this.add.circle(midX, midY, BALL_RADIUS, 0xffffff).setDepth(6);

    // Players (depth 5 — above stick, below ball)
    this._hostSprite = this.add.circle(this.host.x, this.host.y, PLAYER_RADIUS, 0x4488ff).setDepth(5);
    this._clientSprite = this.add.circle(this.client.x, this.client.y, PLAYER_RADIUS, 0xff4444).setDepth(5);

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

    // Score HUD
    this._scoreText = this.add
      .text(640, 30, "0 — 0", { fontSize: "36px", color: "#ffffff", fontStyle: "bold" })
      .setOrigin(0.5, 0);

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
      .setDepth(10);

    // Controls hint
    this.add.text(FIELD_LEFT, FIELD_BOTTOM + 8,
      "Blue: WASD move · Shift dash · Q wrist · E slap", {
        fontSize: "14px", color: "#aaaaaa",
      });
    this.add.text(FIELD_RIGHT, FIELD_BOTTOM + 8,
      "Red: Arrows move · Space dash · , wrist · . slap", {
        fontSize: "14px", color: "#aaaaaa",
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
      this.scene.start("MenuScene");
    });

    // Touch UI — joystick anywhere in the left 60%, buttons on the far right
    this._hostJoy = new VirtualJoystick(this, 0, 0, 768, 720);
    this._hostButtons = new ActionButtons(this, 1210, 360, 0x4488ff);

    // Enable multi-touch
    this.input.addPointer(3);
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

    this._syncSprites();
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

    stepPlayer(this.host, hostInput, dt, elapsedMs);
    stepPlayer(this.client, clientInput, dt, elapsedMs);

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

    const hostStick   = this._stickDir(this.host,   this._hostAim);
    const clientStick = this._stickDir(this.client, this._clientAim);
    resolvePlayerBallCollision(this.host,   this.ball);
    resolvePlayerBallCollision(this.client, this.ball);
    resolveStickTipCollision(this.host,   this.ball, hostStick.x,   hostStick.y);
    resolveStickTipCollision(this.client, this.ball, clientStick.x, clientStick.y);
    this._applyStickPossession(this.host,   hostStick);
    this._applyStickPossession(this.client, clientStick);

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
    const aim    = who === "host" ? this._hostAim : this._clientAim;
    const sDir   = this._stickDir(player, aim);
    const tipX   = player.x + sDir.x * STICK_REACH;
    const tipY   = player.y + sDir.y * STICK_REACH;
    const distToTip  = Math.hypot(this.ball.x - tipX, this.ball.y - tipY);
    const distToBody = Math.hypot(this.ball.x - player.x, this.ball.y - player.y);
    return distToTip < BALL_RADIUS + 18 || distToBody < PLAYER_RADIUS + BALL_RADIUS + 5;
  }

  /**
   * Returns the perpendicular-to-aim unit vector pointing toward the ball.
   * This is the direction the stick extends — beside the player, not in front.
   */
  protected _stickDir(
    _player: { x: number; y: number },
    aim: { x: number; y: number }
  ): { x: number; y: number } {
    const len = Math.hypot(aim.x, aim.y);
    if (len === 0) return { x: 0, y: 1 };
    const nx = aim.x / len;
    const ny = aim.y / len;
    // Right-hand side of player: 90° CCW from aim in screen coords (-ny, nx)
    // e.g. facing right (1,0) → stick points down (0,1) — player's right
    return { x: -ny, y: nx };
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
    stickDir: { x: number; y: number }
  ): void {
    const tipX = player.x + stickDir.x * STICK_REACH;
    const tipY = player.y + stickDir.y * STICK_REACH;
    const dx = this.ball.x - tipX;
    const dy = this.ball.y - tipY;
    const dist = Math.hypot(dx, dy);

    if (dist > BALL_RADIUS + 22) return; // outside possession range

    // Don't override fast-moving balls (incoming shots/passes get deflected)
    const relSpeed = Math.hypot(this.ball.vx - player.vx, this.ball.vy - player.vy);
    if (relSpeed > 220) return;

    // Velocity coupling
    applyPossessionAssist(this.ball, player.vx, player.vy);
    this.ball.vx += (player.vx - this.ball.vx) * 0.25; // extra on top of base 0.1
    this.ball.vy += (player.vy - this.ball.vy) * 0.25;

    // Position: pull ball to tip surface (lerp 45% of gap each step)
    if (dist > 0) {
      const nx = dx / dist;
      const ny = dy / dist;
      const restDist = BALL_RADIUS;
      this.ball.x = tipX + nx * (restDist + (dist - restDist) * 0.55);
      this.ball.y = tipY + ny * (restDist + (dist - restDist) * 0.55);
    }
  }

  protected _doWristShot(who: "host" | "client"): void {
    if (this._frozenMs > 0) return;
    if (!this._ballInRange(who)) return;
    const aim = who === "host" ? this._hostAim : this._clientAim;
    wristShot(this.ball, aim.x, aim.y, this._isOneTouch(who));
    this._lastTouch = { playerId: who, timeMs: this._elapsedMs };
    if (who === "host") this._hostShotAnimMs = 180;
    else this._clientShotAnimMs = 180;
  }

  protected _doSlapShot(who: "host" | "client"): void {
    if (!this._ballInRange(who)) return;
    const state = who === "host" ? this._hostShoot : this._clientShoot;
    const aim = who === "host" ? this._hostAim : this._clientAim;
    releaseShot(state, this.ball, aim.x, aim.y, this._isOneTouch(who));
    this._lastTouch = { playerId: who, timeMs: this._elapsedMs };
    if (who === "host") this._hostShotAnimMs = 280;
    else this._clientShotAnimMs = 280;
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
    const label = scorer === "host" ? "Blue scores!" : "Red scores!";
    if (this.score[scorer] >= WINNING_SCORE) {
      this._messageText.setText(`${scorer === "host" ? "Blue" : "Red"} wins!`);
      this._frozenMs = 3000;
      this.time.delayedCall(3000, () => this.scene.start("MenuScene"));
    } else {
      this._messageText.setText(`${label}  ${this.score.host} — ${this.score.client}`);
      this._frozenMs = 1500;
    }
  }

  protected _syncSprites(): void {
    const visualY = this.ball.y - this.ball.z * 0.5;
    const scale = 1 + this.ball.z * 0.003;
    this._ballSprite.setPosition(this.ball.x, visualY).setScale(scale);
    this._ballShadow.setPosition(this.ball.x, this.ball.y).setAlpha(Math.max(0, 0.3 - this.ball.z * 0.001));

    this._hostSprite.setPosition(this.host.x, this.host.y);
    this._clientSprite.setPosition(this.client.x, this.client.y);

    // Draw sticks
    this._drawSticks();

    // Charge bars
    this._updateChargeBar(this._hostChargeBar, this._hostShoot, this.host.x - 20, this.host.y - PLAYER_RADIUS - 8);
    this._updateChargeBar(this._clientChargeBar, this._clientShoot, this.client.x - 20, this.client.y - PLAYER_RADIUS - 8);

    this._scoreText.setText(`${this.score.host} — ${this.score.client}`);
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
    const g = this._stickGraphics;
    g.clear();

    const drawStick = (
      player: { x: number; y: number },
      aim: { x: number; y: number },
      color: number,
      animMs: number,
      maxAnimMs: number
    ): void => {
      const aimLen = Math.hypot(aim.x, aim.y);
      if (aimLen === 0) return;
      const aNx = aim.x / aimLen;
      const aNy = aim.y / aimLen;

      // Perpendicular direction (toward ball side)
      const stickDir = this._stickDir(player, aim);

      // Swing fraction: 1 = just fired (stick snaps forward), 0 = idle (perpendicular)
      const swingFrac = animMs > 0 ? Math.sin((animMs / maxAnimMs) * (Math.PI / 2)) : 0;

      // Blend stick direction from perpendicular → forward aim as swingFrac → 1
      const dirX = stickDir.x * (1 - swingFrac) + aNx * swingFrac;
      const dirY = stickDir.y * (1 - swingFrac) + aNy * swingFrac;
      const dLen = Math.hypot(dirX, dirY) || 1;
      const nx = dirX / dLen;
      const ny = dirY / dLen;

      const baseX = player.x + nx * PLAYER_RADIUS;
      const baseY = player.y + ny * PLAYER_RADIUS;
      const tipX  = player.x + nx * (PLAYER_RADIUS + STICK_LENGTH);
      const tipY  = player.y + ny * (PLAYER_RADIUS + STICK_LENGTH);

      g.lineStyle(4, color, 0.9);
      g.lineBetween(baseX, baseY, tipX, tipY);
      g.fillStyle(color, 1);
      g.fillCircle(tipX, tipY, 4);
    };

    drawStick(this.host,   this._hostAim,   0x4488ff, this._hostShotAnimMs,   280);
    drawStick(this.client, this._clientAim, 0xff4444, this._clientShotAnimMs, 280);
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

    // ── Field surface (Gerflor sports green) ─────────────────────────────────
    g.fillStyle(0x3a9e5f, 1);
    g.fillRoundedRect(FIELD_LEFT, FIELD_TOP, W, H, r);

    // ── Behind-goal zones (slightly darker — accessible space) ───────────────
    g.fillStyle(0x2e804d, 1);
    // Left behind-goal
    g.fillRect(FIELD_LEFT, GOAL_TOP, GOAL_LINE_LEFT - FIELD_LEFT, goalH);
    // Right behind-goal
    g.fillRect(GOAL_LINE_RIGHT, GOAL_TOP, FIELD_RIGHT - GOAL_LINE_RIGHT, goalH);

    // ── D-zones (crease) — start from goal line, 4m deep into field ──────────
    g.fillStyle(0x338f55, 0.9);
    g.fillRect(GOAL_LINE_LEFT, DZONE_TOP, DZONE_DEPTH, DZONE_BOTTOM - DZONE_TOP);
    g.fillRect(GOAL_LINE_RIGHT - DZONE_DEPTH, DZONE_TOP, DZONE_DEPTH, DZONE_BOTTOM - DZONE_TOP);

    // ── Rink border ───────────────────────────────────────────────────────────
    g.lineStyle(3, 0xffffff, 0.95);
    g.strokeRoundedRect(FIELD_LEFT, FIELD_TOP, W, H, r);

    // ── D-zone boundary lines ─────────────────────────────────────────────────
    g.lineStyle(2, 0xffffff, 0.55);
    g.strokeRect(GOAL_LINE_LEFT, DZONE_TOP, DZONE_DEPTH, DZONE_BOTTOM - DZONE_TOP);
    g.strokeRect(GOAL_LINE_RIGHT - DZONE_DEPTH, DZONE_TOP, DZONE_DEPTH, DZONE_BOTTOM - DZONE_TOP);

    // ── Goal lines (where goals sit) ──────────────────────────────────────────
    g.lineStyle(2, 0xffffff, 0.8);
    g.lineBetween(GOAL_LINE_LEFT,  FIELD_TOP, GOAL_LINE_LEFT,  FIELD_BOTTOM);
    g.lineBetween(GOAL_LINE_RIGHT, FIELD_TOP, GOAL_LINE_RIGHT, FIELD_BOTTOM);

    // ── Centre line ───────────────────────────────────────────────────────────
    g.lineStyle(2, 0xffffff, 0.7);
    g.lineBetween(midX, FIELD_TOP, midX, FIELD_BOTTOM);

    // ── Centre circle (2.85 m) ────────────────────────────────────────────────
    g.strokeCircle(midX, midY, Math.round(2.85 * PX_PER_M));
    g.fillStyle(0xffffff, 0.8);
    g.fillCircle(midX, midY, 5);

    // ── Corner faceoff crosses ────────────────────────────────────────────────
    const cs = 10;
    const fcx1 = FIELD_LEFT  + Math.round(3.5 * PX_PER_M);
    const fcx2 = FIELD_RIGHT - Math.round(3.5 * PX_PER_M);
    const fcy1 = FIELD_TOP    + Math.round(1.5 * PX_PER_M);
    const fcy2 = FIELD_BOTTOM - Math.round(1.5 * PX_PER_M);
    g.lineStyle(2, 0xffffff, 0.5);
    for (const [cx, cy] of [[fcx1, fcy1], [fcx1, fcy2], [fcx2, fcy1], [fcx2, fcy2]]) {
      g.lineBetween(cx - cs, cy, cx + cs, cy);
      g.lineBetween(cx, cy - cs, cx, cy + cs);
    }

    // ── Goals (inset on the goal line, with space behind) ─────────────────────
    // Left goal — host defends
    g.fillStyle(0x4466aa, 0.85);
    g.fillRect(FIELD_LEFT, GOAL_TOP, GOAL_LINE_LEFT - FIELD_LEFT, goalH);
    g.lineStyle(3, 0x6699ff, 1);
    // Back (end wall side)
    g.lineBetween(FIELD_LEFT, GOAL_TOP, FIELD_LEFT, GOAL_BOTTOM);
    // Side rails
    g.lineBetween(FIELD_LEFT, GOAL_TOP,    GOAL_LINE_LEFT, GOAL_TOP);
    g.lineBetween(FIELD_LEFT, GOAL_BOTTOM, GOAL_LINE_LEFT, GOAL_BOTTOM);
    // Goal mouth (posts)
    g.lineStyle(4, 0xaabbff, 1);
    g.lineBetween(GOAL_LINE_LEFT, GOAL_TOP,    GOAL_LINE_LEFT, GOAL_BOTTOM);

    // Right goal — client defends
    g.fillStyle(0xaa4444, 0.85);
    g.fillRect(GOAL_LINE_RIGHT, GOAL_TOP, FIELD_RIGHT - GOAL_LINE_RIGHT, goalH);
    g.lineStyle(3, 0xff6666, 1);
    g.lineBetween(FIELD_RIGHT, GOAL_TOP, FIELD_RIGHT, GOAL_BOTTOM);
    g.lineBetween(FIELD_RIGHT, GOAL_TOP,    GOAL_LINE_RIGHT, GOAL_TOP);
    g.lineBetween(FIELD_RIGHT, GOAL_BOTTOM, GOAL_LINE_RIGHT, GOAL_BOTTOM);
    g.lineStyle(4, 0xffaaaa, 1);
    g.lineBetween(GOAL_LINE_RIGHT, GOAL_TOP, GOAL_LINE_RIGHT, GOAL_BOTTOM);
  }
}
