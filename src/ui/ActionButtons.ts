import Phaser from "phaser";

export interface ActionState {
  wrist: boolean;    // momentary tap
  slapHeld: boolean; // held down
  dash: boolean;     // momentary tap
}

const GLOW   = 0x00e5ff;
const DARK   = 0x07070f;
const ACTIVE = 0x1af0ff;

function makeBtn(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  sublabel: string,
): Phaser.GameObjects.Rectangle {
  // Button body
  const btn = scene.add
    .rectangle(x, y, w, h, DARK, 1)
    .setStrokeStyle(2, GLOW, 0.7)
    .setInteractive({ useHandCursor: false })
    .setDepth(20);

  // Caption above button
  scene.add
    .text(x, y - h / 2 - 4, sublabel, {
      fontSize: "10px",
      color: "#00e5ff",
      fontStyle: "bold",
    })
    .setOrigin(0.5, 1)
    .setDepth(21);

  // Letter inside button
  scene.add
    .text(x, y, label, {
      fontSize: `${Math.round(h * 0.32)}px`,
      color: "#ffffff",
      fontStyle: "bold",
    })
    .setOrigin(0.5)
    .setDepth(21);

  return btn;
}

/**
 * Three styled square touch buttons: SLAP (large, top), WRIST + DASH (small, bottom row).
 */
export class ActionButtons {
  private _slapDown = false;
  private _wristPtr: number | null = null;
  private _slapPtr:  number | null = null;
  private _dashPtr:  number | null = null;
  private _wristTapped = false;
  private _dashTapped  = false;

  constructor(scene: Phaser.Scene, panelCX: number, panelCY: number) {
    const SLAP_W = 120;
    const SLAP_H = 120;
    const SM_W   = 85;
    const SM_H   = 85;
    const GAP    = 10; // gap between small buttons

    const slapY  = panelCY - 80;
    const smallY = panelCY + 100;
    const wristX = panelCX - (SM_W + GAP) / 2;
    const dashX  = panelCX + (SM_W + GAP) / 2;

    // Panel background
    const panelW = SLAP_W + 40;
    const panelH = (smallY + SM_H / 2) - (slapY - SLAP_H / 2) + 50;
    const panelTop = slapY - SLAP_H / 2 - 30;
    scene.add
      .rectangle(panelCX, panelTop + panelH / 2, panelW, panelH, 0x04040c, 0.85)
      .setStrokeStyle(1, 0xffffff, 0.06)
      .setDepth(19);

    const slapBtn  = makeBtn(scene, panelCX, slapY,  SLAP_W, SLAP_H, "S", "SLAP SHOT");
    const wristBtn = makeBtn(scene, wristX,  smallY, SM_W,   SM_H,   "W", "WRIST");
    const dashBtn  = makeBtn(scene, dashX,   smallY, SM_W,   SM_H,   "D", "DASH");

    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this._wristPtr === null && wristBtn.getBounds().contains(p.x, p.y)) {
        this._wristPtr  = p.id;
        this._wristTapped = true;
        wristBtn.setStrokeStyle(3, ACTIVE, 1);
      }
      if (this._slapPtr === null && slapBtn.getBounds().contains(p.x, p.y)) {
        this._slapPtr  = p.id;
        this._slapDown = true;
        slapBtn.setStrokeStyle(4, ACTIVE, 1);
      }
      if (this._dashPtr === null && dashBtn.getBounds().contains(p.x, p.y)) {
        this._dashPtr  = p.id;
        this._dashTapped = true;
        dashBtn.setStrokeStyle(3, ACTIVE, 1);
      }
    });

    scene.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (this._wristPtr === p.id) { this._wristPtr = null; wristBtn.setStrokeStyle(2, GLOW, 0.7); }
      if (this._slapPtr  === p.id) { this._slapPtr  = null; this._slapDown = false; slapBtn.setStrokeStyle(2, GLOW, 0.7); }
      if (this._dashPtr  === p.id) { this._dashPtr  = null; dashBtn.setStrokeStyle(2, GLOW, 0.7); }
    });

    scene.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => {
      scene.input.emit("pointerup", p);
    });
  }

  read(): ActionState {
    const state: ActionState = {
      wrist:    this._wristTapped,
      slapHeld: this._slapDown,
      dash:     this._dashTapped,
    };
    this._wristTapped = false;
    this._dashTapped  = false;
    return state;
  }
}
