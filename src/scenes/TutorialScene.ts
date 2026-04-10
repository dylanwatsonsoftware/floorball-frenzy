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
  private _onComplete: (() => void) | null = null;
  private _team: "host" | "client" = "host";
  private _finished = false;
  private _demoObjs: Phaser.GameObjects.GameObject[] = [];
  private _demoTweens: Phaser.Tweens.Tween[] = [];

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
    this.add.rectangle(width / 2, panelY + 90, width, 180, 0x000000, 0.7).setDepth(101);

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
  }

  private _setupSteps(): void {
    const { width, height } = this.scale;

    // The game world is 1280x720, centered in the screen.
    const extra = Math.max(0, width - 1280);
    const initOffsetX = Math.floor(extra / 2);

    const cy = height / 2;
    const joystickCenterX = (768 / 2) + initOffsetX;

    const isRed = this._team === "host";
    const goalX = isRed ? 1100 : 180;
    const goalTeam = isRed ? "Red" : "Blue";
    const goalDir = isRed ? "right" : "left";

    this._steps = [
      {
        title: "Movement",
        description: "Use the Virtual Joystick on the left to move your player around the rink.\nPoint in the direction you want to face.",
        highlight: { x: joystickCenterX, y: cy, r: 140 }
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
        description: `Attack the opponent's goal on the ${goalDir} (if you're ${goalTeam}).\nThe first player to score 5 goals wins!`,
        highlight: { x: goalX + initOffsetX, y: cy, r: 180 }
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

    this._renderDemo(idx);
  }

  private _cleanupDemo(): void {
    this._demoObjs.forEach(o => o.destroy());
    this._demoObjs = [];
    this._demoTweens.forEach(t => t.stop());
    this._demoTweens = [];
  }

  private _renderDemo(idx: number): void {
    this._cleanupDemo();
    const { width, height } = this.scale;
    const extra = Math.max(0, width - 1280);
    const offX = Math.floor(extra / 2);
    const cy = height / 2;

    const DEPTH = 105;

    if (idx === 0) {
      // Movement demo: circle around joystick area
      const jcx = (768 / 2) + offX;
      const player = this.add.sprite(jcx, cy - 60, "char_host").setDepth(DEPTH).setScale(1.2);
      const stick = this.add.sprite(jcx, cy - 60, "stick_black").setDepth(DEPTH + 1).setScale(0.8);
      this._demoObjs.push(player, stick);

      const angle = { val: 0 };
      const t = this.tweens.add({
        targets: angle,
        val: Math.PI * 2,
        duration: 2000,
        repeat: -1,
        onUpdate: () => {
          const r = 40;
          const px = jcx + Math.cos(angle.val) * r;
          const py = cy + Math.sin(angle.val) * r;
          player.setPosition(px, py);
          player.setRotation(angle.val + Math.PI / 2);
          stick.setPosition(px + Math.cos(angle.val + Math.PI / 4) * 35, py + Math.sin(angle.val + Math.PI / 4) * 35);
          stick.setRotation(angle.val + Math.PI / 4);
        }
      });
      this._demoTweens.push(t);
    } else if (idx === 1) {
      // Slap Hit demo: charge and fire
      const bx = 1210 + offX - 180;
      const by = cy - 80;
      const player = this.add.sprite(bx - 60, by, "char_host").setDepth(DEPTH).setScale(1.2).setRotation(0);
      const stick = this.add.sprite(bx - 60, by, "stick_black").setDepth(DEPTH + 1).setScale(0.8);
      const ball = this.add.circle(bx - 30, by, 8, 0xffffff).setDepth(DEPTH + 2);
      this._demoObjs.push(player, stick, ball);

      // Better slap animation
      const timeline = this.add.timeline([]);
      timeline.add({
        at: 0,
        tween: {
          targets: stick,
          rotation: -Math.PI / 2,
          duration: 600,
          ease: "Cubic.easeIn",
          onUpdate: () => {
             stick.setPosition(player.x + Math.cos(stick.rotation - Math.PI / 2) * 45, player.y + Math.sin(stick.rotation - Math.PI / 2) * 45);
          }
        }
      });
      timeline.add({
        from: 0,
        tween: {
          targets: stick,
          rotation: Math.PI / 4,
          duration: 100,
          ease: "Cubic.easeOut",
          onStart: () => {
             this.tweens.add({ targets: ball, x: bx + 200, alpha: 0, duration: 400 });
          },
          onUpdate: () => {
             stick.setPosition(player.x + Math.cos(stick.rotation - Math.PI / 2) * 45, player.y + Math.sin(stick.rotation - Math.PI / 2) * 45);
          }
        }
      });
      timeline.add({
        from: 800,
        tween: {
          targets: ball,
          x: bx - 30,
          alpha: 1,
          duration: 0
        }
      });
      timeline.repeat(-1);
      timeline.play();
      this._demoObjs.push(timeline as any);
    } else if (idx === 2) {
      // Dash demo: burst forward with ghosts
      const dx = 1210 + offX - 180;
      const dy = cy + 100;
      const player = this.add.sprite(dx - 100, dy, "char_host").setDepth(DEPTH).setScale(1.2).setRotation(Math.PI/2);
      this._demoObjs.push(player);

      const timeline = this.add.timeline([]);
      timeline.add({
        at: 0,
        tween: {
          targets: player,
          x: dx + 60,
          duration: 300,
          ease: "Power2",
          onUpdate: () => {
             if (Math.random() > 0.5) {
               const g = this.add.circle(player.x, player.y, 20, 0x00ff66, 0.4).setDepth(DEPTH-1);
               this._demoObjs.push(g);
               this.tweens.add({ targets: g, alpha: 0, duration: 300, onComplete: () => g.destroy() });
             }
          }
        }
      });
      timeline.add({
        from: 1000,
        tween: {
          targets: player,
          x: dx - 100,
          duration: 0
        }
      });
      timeline.repeat(-1);
      timeline.play();
      this._demoObjs.push(timeline as any);
    } else if (idx === 3) {
      // Goal demo
      const isRed = this._team === "host";
      const gx = (isRed ? 1100 : 180) + offX;
      const ball = this.add.circle(gx + (isRed ? -150 : 150), cy, 8, 0xffffff).setDepth(DEPTH);
      const goalText = this.add.text(gx, cy - 60, "GOAL!", { fontSize: "32px", fontStyle: "bold", color: "#ffff00" }).setOrigin(0.5).setDepth(DEPTH).setAlpha(0);
      this._demoObjs.push(ball, goalText);

      const timeline = this.add.timeline([]);
      timeline.add({
        at: 0,
        tween: {
          targets: ball,
          x: gx,
          duration: 800,
          ease: "Linear"
        }
      });
      timeline.add({
        from: 0,
        tween: {
          targets: goalText,
          alpha: 1,
          scale: 1.5,
          duration: 200,
          yoyo: true,
          hold: 500
        }
      });
      timeline.add({
        from: 500,
        tween: {
          targets: ball,
          x: gx + (isRed ? -150 : 150),
          duration: 0
        }
      });
      timeline.repeat(-1);
      timeline.play();
      this._demoObjs.push(timeline as any);
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
    if (this._finished) return;
    this._finished = true;
    this._cleanupDemo();
    if (this._onComplete) {
      this._onComplete();
      this._onComplete = null;
    }
    this.scene.stop();
  }
}
