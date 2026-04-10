import Phaser from "phaser";

interface TutorialStep {
  title: string;
  description: string;
  highlight: { x: number; y: number; r: number } | null;
}

export class TutorialScene extends Phaser.Scene {
  private _steps: TutorialStep[] = [];
  private _currentStepIdx = 0;
  private _overlay!: Phaser.GameObjects.Graphics;
  private _titleText!: Phaser.GameObjects.Text;
  private _descText!: Phaser.GameObjects.Text;
  private _nextBtn!: Phaser.GameObjects.Rectangle;
  private _nextBtnText!: Phaser.GameObjects.Text;
  private _onComplete: () => void = () => {};

  constructor() {
    super({ key: "TutorialScene" });
  }

  init(data: { onComplete: () => void }): void {
    this._onComplete = data.onComplete;
    this._currentStepIdx = 0;
  }

  create(): void {
    const { width, height } = this.scale;

    // Overlay and Spotlight
    this._overlay = this.add.graphics().setDepth(100);

    // UI Panel (Bottom)
    const panelY = height - 180;
    this.add.rectangle(width / 2, panelY + 90, width, 180, 0x000000, 0.7).setDepth(101);

    this._titleText = this.add.text(width / 2, panelY + 30, "", {
      fontSize: "32px", color: "#00ff66", fontStyle: "bold"
    }).setOrigin(0.5).setDepth(102);

    this._descText = this.add.text(width / 2, panelY + 80, "", {
      fontSize: "20px", color: "#ffffff", align: "center", wordWrap: { width: 800 }
    }).setOrigin(0.5).setDepth(102);

    // Next Button
    this._nextBtn = this.add.rectangle(width / 2, height - 35, 200, 50, 0x00ff66, 1)
      .setDepth(102).setInteractive({ useHandCursor: true });
    this._nextBtnText = this.add.text(width / 2, height - 35, "NEXT", {
      fontSize: "24px", color: "#000000", fontStyle: "bold"
    }).setOrigin(0.5).setDepth(103);

    this._nextBtn.on("pointerup", () => this._nextStep());

    // Skip Button
    const skipBtn = this.add.text(width - 60, height - 35, "SKIP", {
      fontSize: "18px", color: "#888888", fontStyle: "bold"
    }).setOrigin(0.5).setDepth(102).setInteractive({ useHandCursor: true });
    skipBtn.on("pointerup", () => this._finish());

    this._setupSteps();
    this._startStep(0);
  }

  private _setupSteps(): void {
    const { width, height } = this.scale;

    // The game world is 1280x720, centered in the screen.
    const extra = Math.max(0, width - 1280);
    const initOffsetX = Math.floor(extra / 2);

    const cy = height / 2;

    this._steps = [
      {
        title: "Movement",
        description: "Use the Virtual Joystick on the left to move your player around the rink.\nPoint in the direction you want to face.",
        highlight: { x: (768 + initOffsetX) / 2, y: cy, r: 140 }
      },
      {
        title: "Slap Hit",
        description: "Hold SLAP HIT to charge a powerful shot, then release to fire!\nGreat for long-range goals.",
        highlight: { x: 1210 + initOffsetX, y: cy - 80, r: 90 }
      },
      {
        title: "Quick Dash",
        description: "Tap QUICK DASH for a burst of speed.\nYou have 3 charges that refill every few seconds.",
        highlight: { x: 1210 + initOffsetX, y: cy + 100, r: 80 }
      },
      {
        title: "Scoring Goals",
        description: "Attack the opponent's goal on the right (if you're Red).\nThe first player to score 5 goals wins!",
        highlight: { x: 1220 + initOffsetX, y: cy, r: 150 }
      }
    ];
  }

  private _startStep(idx: number): void {
    this._currentStepIdx = idx;
    const step = this._steps[idx];
    this._titleText.setText(step.title);
    this._descText.setText(step.description);
    this._drawSpotlight(step.highlight);

    if (idx === this._steps.length - 1) {
        this._nextBtnText.setText("START");
    } else {
        this._nextBtnText.setText("NEXT");
    }
  }

  private _drawSpotlight(h: { x: number; y: number; r: number } | null): void {
    const { width, height } = this.scale;
    this._overlay.clear();

    // Fill the whole screen with semi-transparent black
    this._overlay.fillStyle(0x000000, 0.6);
    this._overlay.fillRect(0, 0, width, height);

    if (h) {
      // Create a "hole" using destination-out blending
      // Note: Phaser 3.80+ graphics.blendMode isn't a simple property
      // We'll use a mask or just draw a different color circle for the highlight
      // Let's use a bright circle and a thin border for the "pointing" feel
      this._overlay.lineStyle(4, 0x00ff66, 1);
      this._overlay.strokeCircle(h.x, h.y, h.r);

      // We can't easily "subtract" from graphics without render textures or masks
      // So we'll just use a subtle highlight color inside
      this._overlay.fillStyle(0x00ff66, 0.1);
      this._overlay.fillCircle(h.x, h.y, h.r);
    }
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
}
