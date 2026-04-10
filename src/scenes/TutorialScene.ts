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
  private _panelBg!: Phaser.GameObjects.Rectangle;
  private _onComplete: (() => void) | null = null;
  private _team: "host" | "client" = "host";
  private _finished = false;

  constructor() {
    super({ key: "TutorialScene" });
  }

  init(data?: { onComplete: () => void, team?: "host" | "client" }): void {
    this._onComplete = data?.onComplete ?? null;
    this._team = data?.team ?? "host";
    this._currentStepIdx = 0;
    this._finished = false;
  }

  create(): void {
    const { width, height } = this.scale;

    // Overlay and Spotlight
    this._overlay = this.add.graphics().setDepth(100);

    // UI Panel (Bottom)
    const panelY = height - 180;
    this._panelBg = this.add.rectangle(width / 2, panelY + 90, width, 180, 0x000000, 0.7).setDepth(101);

    this._titleText = this.add.text(width / 2, panelY + 30, "", {
      fontSize: "32px", color: "#00ff66", fontStyle: "bold"
    }).setOrigin(0.5).setDepth(102);

    const responsiveWordWrap = Math.min(800, Math.floor(width * 0.9));
    this._descText = this.add.text(width / 2, panelY + 80, "", {
      fontSize: "20px", color: "#ffffff", align: "center", wordWrap: { width: responsiveWordWrap }
    }).setOrigin(0.5).setDepth(102);

    // Next Button
    this._nextBtn = this.add.rectangle(width / 2, height - 35, 200, 50, 0x00ff66, 1)
      .setDepth(102).setInteractive({ useHandCursor: true });
    this._nextBtnText = this.add.text(width / 2, height - 35, "NEXT", {
      fontSize: "24px", color: "#000000", fontStyle: "bold"
    }).setOrigin(0.5).setDepth(103);

    this._nextBtn.on("pointerup", () => this._nextStep());

    this._setupSteps();
    this._startStep(0);

    // Handle orientation changes (resize events)
    const applyLayout = () => {
      this._relayout();
    };
    applyLayout();
    this.scale.on("resize", applyLayout);
    this.events.once("shutdown", () => this.scale.off("resize", applyLayout));
  }

  private _setupSteps(): void {
    const { width, height } = this.scale;

    // The game world is 1280x720, centered in the screen by default.
    const extra = Math.max(0, width - 1280);
    const initOffsetX = Math.floor(extra / 2);

    const cy = height / 2;

    // VirtualJoystick hint is centered in screen at x=384 (because scrollFactor 0)
    const joystickCenterX = 384;

    const isRed = this._team === "host";
    const goalX = isRed ? 1100 : 180;
    const goalTeam = isRed ? "Red" : "Blue";
    const goalDir = isRed ? "right" : "left";

    // ActionButtons are screen-locked at 1190 + initOffsetX
    const buttonsX = 1190 + initOffsetX;

    // For world objects like the Goal, we need to account for the GameScene camera
    const gameScene = this.scene.manager.getScenes(true).find(s => s.scene.key === "GameScene" || s.scene.key === "OnlineGameScene") as any;
    let goalScreenPos = { x: goalX + initOffsetX, y: cy };

    if (gameScene && gameScene.cameras && gameScene.cameras.main) {
      const cam = gameScene.cameras.main;
      // Convert world goal position to screen position
      // goalX is world coord. cy is world mid-y (360)
      const p = cam.getScreenPoint(goalX, 360);
      goalScreenPos.x = p.x;
      goalScreenPos.y = p.y;
    }

    this._steps = [
      {
        title: "Movement",
        description: "Use the Virtual Joystick on the left to move your player around the rink.\nPoint in the direction you want to face.",
        highlight: { x: joystickCenterX, y: cy, r: 140 }
      },
      {
        title: "Slap Hit",
        description: "Hold SLAP HIT to charge a powerful shot, then release to fire!\nGreat for long-range goals.",
        highlight: { x: buttonsX, y: cy - 80, r: 90 }
      },
      {
        title: "Quick Dash",
        description: "Tap QUICK DASH for a burst of speed.\nYou have 3 charges that refill every few seconds.",
        highlight: { x: buttonsX, y: cy + 100, r: 80 }
      },
      {
        title: "Scoring Goals",
        description: `Attack the opponent's goal on the ${goalDir} (if you're ${goalTeam}).\nThe first player to score 5 goals wins!`,
        highlight: { x: goalScreenPos.x, y: goalScreenPos.y, r: 180 * (gameScene?.cameras?.main?.zoom || 1) }
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
      this._overlay.fillStyle(0x00ff66, 0.4);
      this._overlay.fillCircle(h.x, h.y, h.r);
    }
  }

  private _relayout(): void {
    const { width, height } = this.scale;

    // Reposition UI elements
    const panelY = height - 180;
    this._panelBg.setPosition(width / 2, panelY + 90).setDisplaySize(width, 180);
    this._titleText.setPosition(width / 2, panelY + 30);

    const responsiveWordWrap = Math.min(800, Math.floor(width * 0.9));
    this._descText.setPosition(width / 2, panelY + 80).setWordWrapWidth(responsiveWordWrap);

    this._nextBtn.setPosition(width / 2, height - 35);
    this._nextBtnText.setPosition(width / 2, height - 35);

    // Recalculate spotlight positions for all steps
    this._setupSteps();

    // Redraw the current step's spotlight
    const step = this._steps[this._currentStepIdx];
    this._drawSpotlight(step.highlight);
  }

  private _nextStep(): void {
    if (this._currentStepIdx < this._steps.length - 1) {
      this._startStep(this._currentStepIdx + 1);
    } else {
      this._finish();
    }
  }

  private _finish(): void {
    if (this._finished) return;
    this._finished = true;
    if (this._onComplete) {
      this._onComplete();
      this._onComplete = null;
    }
    this.scene.stop();
  }
}
