import Phaser from "phaser";

export interface ActionState {
  wrist: boolean;   // momentary tap
  slapHeld: boolean; // held down
  dash: boolean;    // momentary tap
}

/**
 * Three touch buttons: Wrist (top), Slap (middle, hold to charge), Dash (bottom).
 * Renders in a column on the right (or left) side of the screen.
 */
export class ActionButtons {
  private _slapDown = false;

  // Track which pointer id owns each button so multi-touch works
  private _wristPtr: number | null = null;
  private _slapPtr: number | null = null;
  private _dashPtr: number | null = null;

  /** One-frame flags — consume after reading. */
  private _wristTapped = false;
  private _dashTapped = false;

  constructor(
    scene: Phaser.Scene,
    centerX: number,
    centerY: number,
    tint = 0xffffff
  ) {
    const BTN_R = 34;
    const GAP = 90;

    const labels = ["W", "S", "D"]; // Wrist, Slap, Dash
    const ys = [centerY - GAP, centerY, centerY + GAP];
    const alphas = [0.35, 0.35, 0.35];

    const btns = labels.map((label, i) => {
      const bg = scene.add
        .circle(centerX, ys[i], BTN_R, tint, alphas[i])
        .setStrokeStyle(2, tint, 0.7)
        .setInteractive({ useHandCursor: false })
        .setDepth(20);

      scene.add
        .text(centerX, ys[i], label, { fontSize: "18px", color: "#ffffff" })
        .setOrigin(0.5)
        .setDepth(21);

      return bg;
    });

    const [wristBtn, slapBtn, dashBtn] = btns;

    // Wrist — tap to fire
    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this._wristPtr === null && wristBtn.getBounds().contains(p.x, p.y)) {
        this._wristPtr = p.id;
        this._wristTapped = true;
        wristBtn.setAlpha(0.7);
      }
      if (this._slapPtr === null && slapBtn.getBounds().contains(p.x, p.y)) {
        this._slapPtr = p.id;
        this._slapDown = true;
        slapBtn.setAlpha(0.7);
      }
      if (this._dashPtr === null && dashBtn.getBounds().contains(p.x, p.y)) {
        this._dashPtr = p.id;
        this._dashTapped = true;
        dashBtn.setAlpha(0.7);
      }
    });

    scene.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (this._wristPtr === p.id) {
        this._wristPtr = null;
        wristBtn.setAlpha(alphas[0]);
      }
      if (this._slapPtr === p.id) {
        this._slapPtr = null;
        this._slapDown = false;
        slapBtn.setAlpha(alphas[1]);
      }
      if (this._dashPtr === p.id) {
        this._dashPtr = null;
        dashBtn.setAlpha(alphas[2]);
      }
    });

    scene.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => {
      scene.input.emit("pointerup", p);
    });
  }

  /** Call once per game loop frame to get current state. Clears one-frame flags. */
  read(): ActionState {
    const state: ActionState = {
      wrist: this._wristTapped,
      slapHeld: this._slapDown,
      dash: this._dashTapped,
    };
    this._wristTapped = false;
    this._dashTapped = false;
    return state;
  }
}
