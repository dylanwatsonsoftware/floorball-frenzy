import Phaser from "phaser";
import type { Ball, GameMode, InputState } from "../types/game";
import type { PlayerExtended } from "../physics/playerPhysics";
import { createPlayer, stepPlayer } from "../physics/playerPhysics";
import { stepBall, applyPossessionAssist, resetBall } from "../physics/ballPhysics";
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
  CONTROL_RADIUS,
  FIXED_DT,
} from "../physics/constants";

const WINNING_SCORE = 5;

export class GameScene extends Phaser.Scene {
  protected _mode: GameMode = "local";

  // Entities
  protected host!: PlayerExtended;
  protected client!: PlayerExtended;
  protected ball!: Ball;

  // Score
  protected score = { host: 0, client: 0 };

  // Graphics / display objects
  private _field!: Phaser.GameObjects.Graphics;
  private _hostSprite!: Phaser.GameObjects.Arc;
  private _clientSprite!: Phaser.GameObjects.Arc;
  private _ballSprite!: Phaser.GameObjects.Arc;
  private _ballShadow!: Phaser.GameObjects.Arc;
  private _scoreText!: Phaser.GameObjects.Text;
  private _messageText!: Phaser.GameObjects.Text;

  // Fixed timestep accumulator
  private _accumulator = 0;

  // Frozen while showing goal message
  private _frozenMs = 0;

  // Keyboard cursors (host: WASD, client: arrows)
  private _wasd!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    dash: Phaser.Input.Keyboard.Key;
  };
  private _arrows!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    dash: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { mode: GameMode }): void {
    this._mode = data.mode ?? "local";
    this.score = { host: 0, client: 0 };
    this._accumulator = 0;
    this._frozenMs = 0;
  }

  create(): void {
    const midX = (FIELD_LEFT + FIELD_RIGHT) / 2;
    const midY = (FIELD_TOP + FIELD_BOTTOM) / 2;

    this.host = createPlayer("host", midX - 200, midY);
    this.client = createPlayer("client", midX + 200, midY);
    this.ball = { x: midX, y: midY, z: 0, vx: 0, vy: 0, vz: 0 };

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

    // Score HUD
    this._scoreText = this.add
      .text(640, 30, "0 — 0", { fontSize: "36px", color: "#ffffff", fontStyle: "bold" })
      .setOrigin(0.5, 0);

    // Goal / win message
    this._messageText = this.add
      .text(640, 360, "", { fontSize: "48px", color: "#ffff00", fontStyle: "bold" })
      .setOrigin(0.5)
      .setDepth(10);

    // Keyboard bindings
    const kb = this.input.keyboard!;
    this._wasd = {
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      dash: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
    };
    this._arrows = {
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      dash: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    };

    kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC).on("down", () => {
      this.scene.start("MenuScene");
    });
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

    this._accumulator += delta / 1000; // ms → seconds
    while (this._accumulator >= FIXED_DT) {
      this._fixedUpdate(FIXED_DT);
      this._accumulator -= FIXED_DT;
    }

    this._syncSprites();
  }

  private _fixedUpdate(dt: number): void {
    const elapsedMs = dt * 1000;

    const hostInput = this._readHostInput();
    const clientInput = this._readClientInput();

    stepPlayer(this.host, hostInput, dt, elapsedMs);
    stepPlayer(this.client, clientInput, dt, elapsedMs);

    // Possession assist
    if (this._dist(this.host, this.ball) < CONTROL_RADIUS) {
      applyPossessionAssist(this.ball, this.host.vx, this.host.vy);
    }
    if (this._dist(this.client, this.ball) < CONTROL_RADIUS) {
      applyPossessionAssist(this.ball, this.client.vx, this.client.vy);
    }

    const goal = stepBall(this.ball, dt);
    if (goal) {
      this._onGoal(goal);
    }
  }

  private _readHostInput(): InputState {
    const k = this._wasd;
    let mx = 0;
    let my = 0;
    if (k.left.isDown) mx -= 1;
    if (k.right.isDown) mx += 1;
    if (k.up.isDown) my -= 1;
    if (k.down.isDown) my += 1;
    return { moveX: mx, moveY: my, wrist: false, slap: false, dash: k.dash.isDown };
  }

  private _readClientInput(): InputState {
    const k = this._arrows;
    let mx = 0;
    let my = 0;
    if (k.left.isDown) mx -= 1;
    if (k.right.isDown) mx += 1;
    if (k.up.isDown) my -= 1;
    if (k.down.isDown) my += 1;
    return { moveX: mx, moveY: my, wrist: false, slap: false, dash: k.dash.isDown };
  }

  private _onGoal(scorer: "host" | "client"): void {
    this.score[scorer]++;
    const label = scorer === "host" ? "Blue scores!" : "Red scores!";
    if (this.score[scorer] >= WINNING_SCORE) {
      this._messageText.setText(`${scorer === "host" ? "Blue" : "Red"} wins!`);
      this._frozenMs = 3000;
      // After freeze, return to menu
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

    this._scoreText.setText(`${this.score.host} — ${this.score.client}`);
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
  }

  private _dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private _drawField(): void {
    const g = this._field;
    g.clear();

    // Field background
    g.fillStyle(0x2d7a3a, 1);
    g.fillRect(FIELD_LEFT, FIELD_TOP, FIELD_RIGHT - FIELD_LEFT, FIELD_BOTTOM - FIELD_TOP);

    // Field border
    g.lineStyle(3, 0xffffff, 0.8);
    g.strokeRect(FIELD_LEFT, FIELD_TOP, FIELD_RIGHT - FIELD_LEFT, FIELD_BOTTOM - FIELD_TOP);

    // Centre line
    g.lineStyle(2, 0xffffff, 0.5);
    g.lineBetween(640, FIELD_TOP, 640, FIELD_BOTTOM);

    // Centre circle
    g.strokeCircle(640, (FIELD_TOP + FIELD_BOTTOM) / 2, 80);

    // Goals (left — host defends)
    g.fillStyle(0x6699cc, 0.7);
    g.fillRect(FIELD_LEFT - GOAL_DEPTH, GOAL_TOP, GOAL_DEPTH, GOAL_BOTTOM - GOAL_TOP);
    g.lineStyle(2, 0x4488ff, 1);
    g.strokeRect(FIELD_LEFT - GOAL_DEPTH, GOAL_TOP, GOAL_DEPTH, GOAL_BOTTOM - GOAL_TOP);

    // Goals (right — client defends)
    g.fillStyle(0xcc6666, 0.7);
    g.fillRect(FIELD_RIGHT, GOAL_TOP, GOAL_DEPTH, GOAL_BOTTOM - GOAL_TOP);
    g.lineStyle(2, 0xff4444, 1);
    g.strokeRect(FIELD_RIGHT, GOAL_TOP, GOAL_DEPTH, GOAL_BOTTOM - GOAL_TOP);
  }
}
