import Phaser from "phaser";

export interface ActionState {
  slapHeld: boolean; // held down
  dash: boolean;     // momentary tap
}

const GLOW   = 0x00e5ff;
const ACTIVE = 0x1af0ff;
const DARK   = 0x07070f;

interface Btn {
  bounds: Phaser.Geom.Circle;
  setNormal(): void;
  setActive(): void;
}

function makeBtn(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  radius: number,
  label: string,
): Btn {
  const gfx = scene.add.graphics().setDepth(20);
  const bounds = new Phaser.Geom.Circle(cx, cy, radius);

  const draw = (borderColor: number, borderAlpha: number, borderW: number) => {
    gfx.clear();
    gfx.fillStyle(DARK, 0.9);
    gfx.fillCircle(cx, cy, radius);
    gfx.lineStyle(borderW, borderColor, borderAlpha);
    gfx.strokeCircle(cx, cy, radius);
  };

  draw(GLOW, 0.7, 2);

  // Label inside button
  scene.add
    .text(cx, cy, label, {
      fontSize: `${Math.round(radius * 0.45)}px`,
      color: "#ffffff",
      fontStyle: "bold",
    })
    .setOrigin(0.5)
    .setDepth(21);

  return {
    bounds,
    setNormal() { draw(GLOW, 0.7, 2); },
    setActive()  { draw(ACTIVE, 1, 4); },
  };
}

/**
 * Two circular touch buttons: SLAP and DASH.
 */
export class ActionButtons {
  private _slapDown = false;
  private _slapPtr:  number | null = null;
  private _dashPtr:  number | null = null;
  private _dashTapped  = false;
  private _slapBounds: Phaser.Geom.Circle;
  private _dashBounds: Phaser.Geom.Circle;

  constructor(scene: Phaser.Scene, panelCX: number, panelCY: number) {
    const BIG_R = 70;
    const SM_R  = 50;

    const slapX  = panelCX;
    const slapY  = panelCY - 80;
    const dashX  = panelCX;
    const dashY  = panelCY + 100;

    const slapBtn = makeBtn(scene, slapX, slapY, BIG_R, "SLAP");
    const dashBtn = makeBtn(scene, dashX, dashY, SM_R,  "DASH");
    this._slapBounds = slapBtn.bounds;
    this._dashBounds = dashBtn.bounds;

    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
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
      if (this._slapPtr  === p.id) { this._slapPtr  = null; this._slapDown = false; slapBtn.setNormal(); }
      if (this._dashPtr  === p.id) { this._dashPtr  = null; dashBtn.setNormal(); }
    });

    scene.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => {
      scene.input.emit("pointerup", p);
    });
  }

  /** Checks if a point is within any of the buttons. */
  contains(x: number, y: number): boolean {
    return this._slapBounds.contains(x, y) || this._dashBounds.contains(x, y);
  }

  read(): ActionState {
    const state: ActionState = {
      slapHeld: this._slapDown,
      dash:     this._dashTapped,
    };
    this._dashTapped  = false;
    return state;
  }
}
