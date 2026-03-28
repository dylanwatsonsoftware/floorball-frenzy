import Phaser from "phaser";
import type { Ball, GameMode, InputState } from "../types/game";
import type { PlayerExtended } from "../physics/playerPhysics";
import { createPlayer, stepPlayer } from "../physics/playerPhysics";
import { stepBall, resetBall } from "../physics/ballPhysics";
import { resolvePlayerBallCollision } from "../physics/collision";
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
  GOAL_DEPTH,
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
  private _hostShoot!: ShootState;
  private _clientShoot!: ShootState;

  // Last aim direction per player (used when shooting)
  private _hostAim = { x: 1, y: 0 };
  private _clientAim = { x: -1, y: 0 };

  // One-touch tracking
  private _lastTouch: LastTouch = { playerId: "", timeMs: 0 };
  private _elapsedMs = 0; // total game time in ms

  // Was slap held last frame? (to detect release)
  private _hostSlapWasDown = false;
  private _clientSlapWasDown = false;

  // Touch UI (present on mobile; keyboard still works on desktop)
  private _hostJoy!: VirtualJoystick;
  private _hostButtons!: ActionButtons;

  // Graphics / display objects
  private _field!: Phaser.GameObjects.Graphics;
  private _hostSprite!: Phaser.GameObjects.Arc;
  private _clientSprite!: Phaser.GameObjects.Arc;
  private _ballSprite!: Phaser.GameObjects.Arc;
  private _ballShadow!: Phaser.GameObjects.Arc;
  private _hostChargeBar!: Phaser.GameObjects.Rectangle;
  private _clientChargeBar!: Phaser.GameObjects.Rectangle;
  private _scoreText!: Phaser.GameObjects.Text;
  private _messageText!: Phaser.GameObjects.Text;

  // Fixed timestep accumulator
  private _accumulator = 0;

  // Frozen while showing goal message
  private _frozenMs = 0;

  // Keys
  private _wasd!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    dash: Phaser.Input.Keyboard.Key;
    wrist: Phaser.Input.Keyboard.Key;
    slap: Phaser.Input.Keyboard.Key;
  };
  private _arrows!: {
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

    // Ball shadow
    this._ballShadow = this.add.circle(midX, midY, BALL_RADIUS, 0x000000, 0.3);
    // Ball
    this._ballSprite = this.add.circle(midX, midY, BALL_RADIUS, 0xffffff);

    // Players
    this._hostSprite = this.add.circle(this.host.x, this.host.y, PLAYER_RADIUS, 0x4488ff);
    this._clientSprite = this.add.circle(this.client.x, this.client.y, PLAYER_RADIUS, 0xff4444);

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

    // Touch UI — joystick on left third, action buttons on right side
    // Zone covers the full canvas height so the player can drag anywhere on their side
    this._hostJoy = new VirtualJoystick(this, 0, 0, 430, 720);
    this._hostButtons = new ActionButtons(this, 60, 360, 0x4488ff);

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

    this._accumulator += delta / 1000;
    while (this._accumulator >= FIXED_DT) {
      this._fixedUpdate(FIXED_DT);
      this._accumulator -= FIXED_DT;
    }

    this._syncSprites();
  }

  private _fixedUpdate(dt: number): void {
    const elapsedMs = dt * 1000;
    this._elapsedMs += elapsedMs;

    const hostInput = this._readHostInput();
    const clientInput = this._readClientInput();

    // Update aim direction from movement input
    if (hostInput.moveX !== 0 || hostInput.moveY !== 0) {
      this._hostAim = { x: hostInput.moveX, y: hostInput.moveY };
    }
    if (clientInput.moveX !== 0 || clientInput.moveY !== 0) {
      this._clientAim = { x: clientInput.moveX, y: clientInput.moveY };
    }

    stepPlayer(this.host, hostInput, dt, elapsedMs);
    stepPlayer(this.client, clientInput, dt, elapsedMs);

    // Slap shot charge + release detection
    updateShootCharge(this._hostShoot, hostInput.slap, elapsedMs);
    updateShootCharge(this._clientShoot, clientInput.slap, elapsedMs);

    if (this._hostSlapWasDown && !hostInput.slap && this._hostShoot.chargeMs > 0) {
      this._doSlapShot("host");
    }
    if (this._clientSlapWasDown && !clientInput.slap && this._clientShoot.chargeMs > 0) {
      this._doSlapShot("client");
    }
    this._hostSlapWasDown = hostInput.slap;
    this._clientSlapWasDown = clientInput.slap;

    // Player–ball collision (physical push)
    resolvePlayerBallCollision(this.host, this.ball);
    resolvePlayerBallCollision(this.client, this.ball);

    // Track who last touched the ball (for one-touch bonus)
    this._updateLastTouch();

    const goal = stepBall(this.ball, dt);
    if (goal) {
      this._onGoal(goal);
    }
  }

  private _updateLastTouch(): void {
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

  private _doWristShot(who: "host" | "client"): void {
    if (this._frozenMs > 0) return;
    const aim = who === "host" ? this._hostAim : this._clientAim;
    wristShot(this.ball, aim.x, aim.y, this._isOneTouch(who));
    this._lastTouch = { playerId: who, timeMs: this._elapsedMs };
  }

  private _doSlapShot(who: "host" | "client"): void {
    const state = who === "host" ? this._hostShoot : this._clientShoot;
    const aim = who === "host" ? this._hostAim : this._clientAim;
    releaseShot(state, this.ball, aim.x, aim.y, this._isOneTouch(who));
    this._lastTouch = { playerId: who, timeMs: this._elapsedMs };
  }

  private _readHostInput(): InputState {
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

  private _readClientInput(): InputState {
    const k = this._arrows;
    let mx = 0;
    let my = 0;
    if (k.left.isDown) mx -= 1;
    if (k.right.isDown) mx += 1;
    if (k.up.isDown) my -= 1;
    if (k.down.isDown) my += 1;
    return { moveX: mx, moveY: my, wrist: k.wrist.isDown, slap: k.slap.isDown, dash: k.dash.isDown };
  }

  private _onGoal(scorer: "host" | "client"): void {
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

  private _drawField(): void {
    const g = this._field;
    g.clear();

    const W = FIELD_RIGHT - FIELD_LEFT;
    const H = FIELD_BOTTOM - FIELD_TOP;
    const midY = (FIELD_TOP + FIELD_BOTTOM) / 2;
    const r = CORNER_RADIUS;

    // Field background — rounded rect
    g.fillStyle(0x2d7a3a, 1);
    g.fillRoundedRect(FIELD_LEFT, FIELD_TOP, W, H, r);

    // D-zones (crease areas)
    g.fillStyle(0x265e30, 0.8);
    g.fillRect(FIELD_LEFT, DZONE_TOP, DZONE_DEPTH, DZONE_BOTTOM - DZONE_TOP);      // left
    g.fillRect(FIELD_RIGHT - DZONE_DEPTH, DZONE_TOP, DZONE_DEPTH, DZONE_BOTTOM - DZONE_TOP); // right
    g.lineStyle(2, 0xffffff, 0.6);
    g.strokeRect(FIELD_LEFT, DZONE_TOP, DZONE_DEPTH, DZONE_BOTTOM - DZONE_TOP);
    g.strokeRect(FIELD_RIGHT - DZONE_DEPTH, DZONE_TOP, DZONE_DEPTH, DZONE_BOTTOM - DZONE_TOP);

    // Field border (rounded)
    g.lineStyle(3, 0xffffff, 0.9);
    g.strokeRoundedRect(FIELD_LEFT, FIELD_TOP, W, H, r);

    // Centre line
    g.lineStyle(2, 0xffffff, 0.6);
    g.lineBetween(640, FIELD_TOP, 640, FIELD_BOTTOM);

    // Centre circle (r=2.85m → 80px)
    g.strokeCircle(640, midY, Math.round(2.85 * PX_PER_M));

    // Centre dot
    g.fillStyle(0xffffff, 0.8);
    g.fillCircle(640, midY, 5);

    // Corner faceoff crosses — 3.5m from corners, 1.5m inset
    const crossSize = 10;
    const cx1 = FIELD_LEFT + Math.round(3.5 * PX_PER_M);
    const cx2 = FIELD_RIGHT - Math.round(3.5 * PX_PER_M);
    const cy1 = FIELD_TOP + Math.round(1.5 * PX_PER_M);
    const cy2 = FIELD_BOTTOM - Math.round(1.5 * PX_PER_M);
    g.lineStyle(2, 0xffffff, 0.5);
    for (const [cx, cy] of [[cx1, cy1], [cx1, cy2], [cx2, cy1], [cx2, cy2]]) {
      g.lineBetween(cx - crossSize, cy, cx + crossSize, cy);
      g.lineBetween(cx, cy - crossSize, cx, cy + crossSize);
    }

    // Goals (left — host defends) — net recesses behind end wall
    g.fillStyle(0x6699cc, 0.7);
    g.fillRect(FIELD_LEFT - GOAL_DEPTH, GOAL_TOP, GOAL_DEPTH, GOAL_BOTTOM - GOAL_TOP);
    g.lineStyle(3, 0x4488ff, 1);
    g.strokeRect(FIELD_LEFT - GOAL_DEPTH, GOAL_TOP, GOAL_DEPTH, GOAL_BOTTOM - GOAL_TOP);

    // Goals (right — client defends)
    g.fillStyle(0xcc6666, 0.7);
    g.fillRect(FIELD_RIGHT, GOAL_TOP, GOAL_DEPTH, GOAL_BOTTOM - GOAL_TOP);
    g.lineStyle(3, 0xff4444, 1);
    g.strokeRect(FIELD_RIGHT, GOAL_TOP, GOAL_DEPTH, GOAL_BOTTOM - GOAL_TOP);
  }
}
