import Phaser from "phaser";

export interface ActionState {
  slapHeld: boolean; // held down
  dash: boolean;     // momentary tap
}

const GLOW   = 0x00e5ff;
const ACTIVE = 0x1af0ff;
const DARK   = 0x07070f;
const DASH_READY = 0x00ff66;
const DASH_EMPTY = 0x444444;

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

    // Draw Icon
    gfx.lineStyle(4, 0xffffff, 0.4);
    if (label === "SLAP HIT") {
      gfx.beginPath();
      gfx.moveTo(cx - 15, cy - 25);
      gfx.lineTo(cx - 15, cy + 5);
      (gfx as any).quadraticCurveTo(cx - 15, cy + 20, cx + 15, cy + 20);
      gfx.strokePath();
    } else if (label === "QUICK DASH") {
      for (let i = 0; i < 3; i++) {
        const ox = cx - 12 + i * 10;
        const oy = cy - 5;
        gfx.beginPath();
        gfx.moveTo(ox, oy - 8);
        gfx.lineTo(ox + 8, oy);
        gfx.lineTo(ox, oy + 8);
        gfx.strokePath();
      }
    }
  };

  draw(GLOW, 0.7, 2);

  // Label inside button
  const isSlap = label === "SLAP HIT";
  scene.add
    .text(cx, isSlap ? cy + 40 : cy + 30, label, {
      fontSize: `${Math.round(radius * (isSlap ? 0.3 : 0.28))}px`,
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

  private _dashGfx: Phaser.GameObjects.Graphics;
  private _dashCharges = 3;
  private _dashCooldownMs = 0;
  private _dashCX = 0;
  private _dashCY = 0;
  private _dashR = 50;

  constructor(scene: Phaser.Scene, panelCX: number, panelCY: number) {
    const BIG_R = 70;
    const SM_R  = 50;

    const slapX  = panelCX;
    const slapY  = panelCY - 80;
    const dashX  = panelCX;
    const dashY  = panelCY + 100;
    this._dashCX = dashX;
    this._dashCY = dashY;
    this._dashR = SM_R;

    const slapBtn = makeBtn(scene, slapX, slapY, BIG_R, "SLAP HIT");
    const dashBtn = makeBtn(scene, dashX, dashY, SM_R, "QUICK DASH");
    this._dashGfx = scene.add.graphics().setDepth(20);
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
        if (this._dashCharges > 0) {
          this._dashTapped = true;
          dashBtn.setActive();
        }
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

  updateDashState(charges: number, cooldownMs: number): void {
    this._dashCharges = charges;
    this._dashCooldownMs = cooldownMs;
    this._drawDash();
  }

  private _drawDash(): void {
    const g = this._dashGfx;
    const cx = this._dashCX, cy = this._dashCY, r = this._dashR;
    g.clear();

    // Segments (3 small dots)
    const segmentR = 4;
    const padding = 12;
    for (let i = 0; i < 3; i++) {
      const angle = -Math.PI / 2 + (i - 1) * (Math.PI / 4);
      const sx = cx + Math.cos(angle) * (r - padding);
      const sy = cy + Math.sin(angle) * (r - padding);

      if (i < this._dashCharges) {
        g.fillStyle(DASH_READY, 1);
      } else {
        g.fillStyle(DASH_EMPTY, 0.5);
      }
      g.fillCircle(sx, sy, segmentR);
    }

    // Stamina ring (recharge progress)
    if (this._dashCharges < 3) {
      const cooldownTotal = 3000; // Match DASH_COOLDOWN
      const progress = 1 - this._dashCooldownMs / cooldownTotal;
      g.lineStyle(6, 0x00ff66, 0.9); // Thicker green circle
      g.beginPath();
      g.arc(cx, cy, r + 5, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2, false);
      g.strokePath();
    }
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
