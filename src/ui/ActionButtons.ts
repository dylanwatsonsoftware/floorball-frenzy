import Phaser from "phaser";

export interface ActionState {
  wrist: boolean;    // momentary tap
  slapHeld: boolean; // held down
  dash: boolean;     // momentary tap
}

const GLOW   = 0x00e5ff;
const ACTIVE = 0x1af0ff;
const DARK   = 0x07070f;
const RADIUS = 18;

interface Btn {
  bounds: Phaser.Geom.Rectangle;
  setNormal(): void;
  setActive(): void;
}

function makeBtn(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  w: number,
  h: number,
  label: string,
  sublabel: string,
  slapSize: boolean,
): Btn {
  const gfx = scene.add.graphics().setDepth(20);
  const bounds = new Phaser.Geom.Rectangle(cx - w / 2, cy - h / 2, w, h);

  const draw = (borderColor: number, borderAlpha: number, borderW: number) => {
    gfx.clear();
    gfx.fillStyle(DARK, 0.9);
    gfx.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, RADIUS);
    gfx.lineStyle(borderW, borderColor, borderAlpha);
    gfx.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, RADIUS);
  };

  draw(GLOW, 0.7, 2);

  // Caption above button
  scene.add
    .text(cx, cy - h / 2 - 5, sublabel, {
      fontSize: "10px",
      color: "#00e5ff",
      fontStyle: "bold",
    })
    .setOrigin(0.5, 1)
    .setDepth(21);

  // Letter inside button
  scene.add
    .text(cx, cy, label, {
      fontSize: `${Math.round(h * 0.32)}px`,
      color: "#ffffff",
      fontStyle: "bold",
    })
    .setOrigin(0.5)
    .setDepth(21);

  return {
    bounds,
    setNormal() { draw(GLOW, 0.7, 2); },
    setActive()  { draw(ACTIVE, 1, slapSize ? 4 : 3); },
  };
}

/**
 * Three styled rounded touch buttons: SLAP (large, top), WRIST + DASH (small, bottom row).
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
    const GAP    = 10;

    const slapY  = panelCY - 80;
    const smallY = panelCY + 100;
    const wristX = panelCX - (SM_W + GAP) / 2;
    const dashX  = panelCX + (SM_W + GAP) / 2;

    const slapBtn  = makeBtn(scene, panelCX, slapY,  SLAP_W, SLAP_H, "S", "SLAP SHOT", true);
    const wristBtn = makeBtn(scene, wristX,  smallY, SM_W,   SM_H,   "W", "WRIST",     false);
    const dashBtn  = makeBtn(scene, dashX,   smallY, SM_W,   SM_H,   "D", "DASH",      false);

    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this._wristPtr === null && wristBtn.bounds.contains(p.worldX, p.worldY)) {
        this._wristPtr    = p.id;
        this._wristTapped = true;
        wristBtn.setActive();
      }
      if (this._slapPtr === null && slapBtn.bounds.contains(p.worldX, p.worldY)) {
        this._slapPtr  = p.id;
        this._slapDown = true;
        slapBtn.setActive();
      }
      if (this._dashPtr === null && dashBtn.bounds.contains(p.worldX, p.worldY)) {
        this._dashPtr    = p.id;
        this._dashTapped = true;
        dashBtn.setActive();
      }
    });

    scene.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (this._wristPtr === p.id) { this._wristPtr = null; wristBtn.setNormal(); }
      if (this._slapPtr  === p.id) { this._slapPtr  = null; this._slapDown = false; slapBtn.setNormal(); }
      if (this._dashPtr  === p.id) { this._dashPtr  = null; dashBtn.setNormal(); }
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
