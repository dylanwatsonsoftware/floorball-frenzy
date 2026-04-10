import Phaser from "phaser";
import {
  DASH_COOLDOWN,
  MAX_DASH_CHARGES,
  SHOOT_MAX_CHARGE_MS,
} from "../physics/constants";

export interface ActionState {
  slapHeld: boolean; // held down
  dash: boolean;     // momentary tap
}

const GLOW   = 0x00e5ff;
const ACTIVE = 0x1af0ff;
const DARK   = 0x07070f;
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
  };

  draw(GLOW, 0.7, 2);

  // Label inside button
  const isSlap = label === "SLAP HIT";
  scene.add
    .text(cx, cy, label, {
      fontSize: `${Math.round(radius * (isSlap ? 0.35 : 0.32))}px`,
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
  private _dashCharges = MAX_DASH_CHARGES;
  private _dashCooldownMs = 0;
  private _dashCX = 0;
  private _dashCY = 0;
  private _dashR = 50;

  private _slapGfx: Phaser.GameObjects.Graphics;
  private _slapChargeMs = 0;
  private _slapCX = 0;
  private _slapCY = 0;
  private _slapR = 70;

  constructor(scene: Phaser.Scene, panelCX: number, panelCY: number) {
    const BIG_R = 70;
    const SM_R  = 50;

    const slapX  = panelCX;
    const slapY  = panelCY - 80;
    this._slapCX = slapX;
    this._slapCY = slapY;
    this._slapR = BIG_R;

    const dashX  = panelCX;
    const dashY  = panelCY + 100;
    this._dashCX = dashX;
    this._dashCY = dashY;
    this._dashR = SM_R;

    const slapBtn = makeBtn(scene, slapX, slapY, BIG_R, "SLAP HIT");
    const dashBtn = makeBtn(scene, dashX, dashY, SM_R, "QUICK DASH");
    this._dashGfx = scene.add.graphics().setDepth(20);
    this._slapGfx = scene.add.graphics().setDepth(20);
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

  updateSlapState(chargeMs: number): void {
    this._slapChargeMs = chargeMs;
    this._drawSlap();
  }

  private _drawSlap(): void {
    const g = this._slapGfx;
    const cx = this._slapCX, cy = this._slapCY, r = this._slapR;
    g.clear();

    if (this._slapChargeMs > 0) {
      const progress = Phaser.Math.Clamp(this._slapChargeMs / SHOOT_MAX_CHARGE_MS, 0, 1);
      g.lineStyle(6, 0xffff00, 0.9); // Yellow ring
      g.beginPath();
      g.arc(cx, cy, r + 5, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2, false);
      g.strokePath();
    }
  }

  private _drawDash(): void {
    const g = this._dashGfx;
    const cx = this._dashCX, cy = this._dashCY, r = this._dashR;
    g.clear();

    // Background
    const bgColor = this._dashCharges > 0 ? 0x00cc66 : 0x333333; // Green or Gray
    g.fillStyle(bgColor, 0.85);
    g.fillCircle(cx, cy, r);

    // Border
    const borderColor = this._dashCharges > 0 ? GLOW : DASH_EMPTY;
    g.lineStyle(2, borderColor, 0.7);
    g.strokeCircle(cx, cy, r);

    // Total Stamina ring (recharge progress)
    // 0 charges = 0.0, MAX_DASH_CHARGES charges = 1.0
    // Each charge is 1/MAX_DASH_CHARGES of the total gauge.
    const cooldownClamped = Phaser.Math.Clamp(this._dashCooldownMs, 0, DASH_COOLDOWN);
    const partialProgress = (this._dashCharges < MAX_DASH_CHARGES)
      ? Phaser.Math.Clamp(1 - cooldownClamped / DASH_COOLDOWN, 0, 1)
      : 0;

    const totalProgress = Phaser.Math.Clamp((this._dashCharges + partialProgress) / MAX_DASH_CHARGES, 0, 1);

    if (totalProgress > 0) {
      g.lineStyle(6, 0x00ff66, 0.9); // Thicker green circle
      g.beginPath();
      // Draw arc from top (-PI/2) clockwise
      g.arc(cx, cy, r + 5, -Math.PI / 2, -Math.PI / 2 + totalProgress * Math.PI * 2, false);
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
