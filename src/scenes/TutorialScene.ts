import Phaser from "phaser";
import { VirtualJoystick } from "../ui/VirtualJoystick";
import { ActionButtons } from "../ui/ActionButtons";
import { createPlayer, stepPlayer, type PlayerExtended } from "../physics/playerPhysics";
import { stepBall } from "../physics/ballPhysics";
import { resolvePlayerBallCollision } from "../physics/collision";
import {
  FIXED_DT, BALL_RADIUS
} from "../physics/constants";
import type { Ball, InputState } from "../types/game";
import { createShootState, updateShootCharge, releaseShot, type ShootState } from "../physics/shooting";

interface TutorialStep {
  title: string;
  description: string;
  setup: () => void;
  update: (dt: number) => boolean; // returns true if step goal reached
}

export class TutorialScene extends Phaser.Scene {
  private _steps: TutorialStep[] = [];
  private _currentStepIdx = 0;
  private _titleText!: Phaser.GameObjects.Text;
  private _descText!: Phaser.GameObjects.Text;
  private _nextBtn!: Phaser.GameObjects.Rectangle;
  private _nextBtnText!: Phaser.GameObjects.Text;

  private _player!: PlayerExtended;
  private _ball!: Ball;
  private _shootState!: ShootState;
  private _joystick!: VirtualJoystick;
  private _buttons!: ActionButtons;
  private _playerSprite!: Phaser.GameObjects.Sprite;
  private _stickSprite!: Phaser.GameObjects.Sprite;
  private _ballGraphics!: Phaser.GameObjects.Graphics;

  private _accumulator = 0;
  private _stepTimer = 0;
  private _onComplete: () => void = () => {};

  constructor() {
    super({ key: "TutorialScene" });
  }

  init(data: { onComplete: () => void }): void {
    this._onComplete = data.onComplete;
    this._currentStepIdx = 0;
    this._accumulator = 0;
  }

  create(): void {
    const { width, height } = this.scale;

    // Background overlay
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85).setDepth(0);

    // Title & Description
    this._titleText = this.add.text(width / 2, 80, "", {
      fontSize: "32px", color: "#00ff66", fontStyle: "bold"
    }).setOrigin(0.5);

    this._descText = this.add.text(width / 2, 140, "", {
      fontSize: "20px", color: "#ffffff", align: "center", wordWrap: { width: 800 }
    }).setOrigin(0.5);

    // Next Button
    this._nextBtn = this.add.rectangle(width / 2, height - 80, 200, 60, 0x00ff66, 1).setInteractive({ useHandCursor: true });
    this._nextBtnText = this.add.text(width / 2, height - 80, "NEXT", {
      fontSize: "24px", color: "#000000", fontStyle: "bold"
    }).setOrigin(0.5);

    this._nextBtn.on("pointerup", () => this._nextStep());

    // Skip Button
    const skipBtn = this.add.text(width - 60, 40, "SKIP", {
      fontSize: "18px", color: "#888888", fontStyle: "bold"
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    skipBtn.on("pointerup", () => this._finish());

    // Setup Physics Entities
    this._player = createPlayer("host", width / 2, height / 2);
    this._ball = { x: width / 2 + 100, y: height / 2, z: 0, vx: 0, vy: 0, vz: 0, possessedBy: null };
    this._shootState = createShootState();

    // Setup Controls
    this._joystick = new VirtualJoystick(this, 0, 0, width / 2, height, 60);
    this._buttons = new ActionButtons(this, width - 100, height / 2);

    // Visuals
    this._playerSprite = this.add.sprite(this._player.x, this._player.y, "char_host").setScale(1.26);
    this._stickSprite = this.add.sprite(0, 0, "stick_black").setScale(0.9);
    this._ballGraphics = this.add.graphics();

    this._setupSteps();
    this._startStep(0);
  }

  private _setupSteps(): void {
    this._steps = [
      {
        title: "Movement",
        description: "Use the JOYSTICK on the left to move your player around the rink.",
        setup: () => {
          this._ball.x = -1000; // hide ball
          this._player.x = this.scale.width / 2;
          this._player.y = this.scale.height / 2;
        },
        update: () => {
          const dist = Math.hypot(this._player.x - this.scale.width / 2, this._player.y - this.scale.height / 2);
          return dist > 100; // Complete when moved away
        }
      },
      {
        title: "Slap Hit",
        description: "Hold SLAP HIT to charge your shot, then release to fire!\nTry hitting the ball.",
        setup: () => {
          this._ball.x = this.scale.width / 2 + 150;
          this._ball.y = this.scale.height / 2;
          this._ball.vx = 0;
          this._ball.vy = 0;
        },
        update: () => {
          return Math.hypot(this._ball.vx, this._ball.vy) > 100; // Complete when ball hit
        }
      },
      {
        title: "Quick Dash",
        description: "Tap QUICK DASH for a burst of speed.\nYou have 3 charges that refill over time.",
        setup: () => {
          this._player.dashCharges = 3;
        },
        update: () => {
          return this._player.dashCharges < 3; // Complete when dashed
        }
      },
      {
        title: "Goal!",
        description: "The first player to score 5 goals wins the match.\nAttack the opponent's goal!",
        setup: () => {
          this._ball.x = this.scale.width / 2;
          this._ball.y = this.scale.height / 2;
          this._ball.vx = 0;
          this._ball.vy = 0;
        },
        update: (dt: number) => {
          const inGoal = (this._ball.x < 100) || (this._ball.x > this.scale.width - 100);
          if (inGoal) return true;
          // Also allow Next after 5 seconds of playing
          this._stepTimer += dt;
          return this._stepTimer > 5000;
        }
      }
    ];
  }

  private _startStep(idx: number): void {
    this._currentStepIdx = idx;
    this._stepTimer = 0;
    const step = this._steps[idx];
    this._titleText.setText(step.title);
    this._descText.setText(step.description);
    this._nextBtn.setVisible(false);
    this._nextBtnText.setVisible(false);
    step.setup();
  }

  private _nextStep(): void {
    if (this._currentStepIdx < this._steps.length - 1) {
      this._startStep(this._currentStepIdx + 1);
    } else {
      this._finish();
    }
  }

  private _finish(): void {
    if (this._onComplete) this._onComplete();
    this.scene.stop();
  }

  override update(_time: number, delta: number): void {
    this._accumulator += delta / 1000;
    while (this._accumulator >= FIXED_DT) {
      this._fixedUpdate(FIXED_DT);
      this._accumulator -= FIXED_DT;
    }

    // Sync visuals
    this._playerSprite.setPosition(this._player.x, this._player.y);
    const angle = Math.atan2(this._player.vx, -this._player.vy); // Simple rotation
    if (Math.hypot(this._player.vx, this._player.vy) > 10) {
        this._playerSprite.setRotation(angle);
    }

    this._ballGraphics.clear();
    this._ballGraphics.fillStyle(0xffffff);
    this._ballGraphics.fillCircle(this._ball.x, this._ball.y, BALL_RADIUS);

    // Update stick
    const aimX = this._joystick.value.x || (this._player.vx / 300) || 1;
    const aimY = this._joystick.value.y || (this._player.vy / 300) || 0;
    const stickAngle = Math.atan2(aimY, aimX);
    this._stickSprite.setPosition(this._player.x + Math.cos(stickAngle) * 40, this._player.y + Math.sin(stickAngle) * 40);
    this._stickSprite.setRotation(stickAngle);

    // Check step completion
    if (!this._nextBtn.visible && this._steps[this._currentStepIdx].update(delta)) {
      this._nextBtn.setVisible(true);
      this._nextBtnText.setVisible(true);
    }
  }

  private _fixedUpdate(dt: number): void {
    const input = this._readInput();
    stepPlayer(this._player, input, dt, dt * 1000);
    stepBall(this._ball, dt);
    resolvePlayerBallCollision(this._player, this._ball);

    // Simple environment bounds
    if (this._player.x < 50) this._player.x = 50;
    if (this._player.x > this.scale.width - 50) this._player.x = this.scale.width - 50;
    if (this._player.y < 200) this._player.y = 200;
    if (this._player.y > this.scale.height - 150) this._player.y = this.scale.height - 150;

    // Shooting logic
    updateShootCharge(this._shootState, input.slap, dt * 1000);
    if (!input.slap && this._shootState.chargeMs > 0) {
        releaseShot(this._shootState, this._ball, input.moveX || 1, input.moveY || 0, false, this._player.vx, this._player.vy);
        this._shootState.chargeMs = 0;
    }

    this._buttons.updateDashState(this._player.dashCharges, this._player.dashCooldownMs);
  }

  private _readInput(): InputState {
    const touch = this._buttons.read();
    return {
      moveX: this._joystick.value.x,
      moveY: this._joystick.value.y,
      slap: touch.slapHeld,
      dash: touch.dash
    };
  }
}
