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
const DASH_EMPTY = 0x444444;

/**
 * Two circular touch buttons: SLAP and DASH.
 */
export class ActionButtons {
  private _slapDown = false;
  private _slapPtr:  number | null = null;
  private _dashPtr:  number | null = null;
  private _dashTapped  = false;
  private _dashPressed = false;
  private _slapPressed = false;
  private _slapBounds: Phaser.Geom.Circle;
  private _dashBounds: Phaser.Geom.Circle;

  private _dashRingGfx: Phaser.GameObjects.Graphics;
  private _dashCharges = MAX_DASH_CHARGES;
  private _dashCooldownMs = 0;
  private _dashCX = 0;
  private _dashCY = 0;
  private _dashR = 50;

  private _slapRingGfx: Phaser.GameObjects.Graphics;
  private _slapChargeMs = 0;
  private _slapCX = 0;
  private _slapCY = 0;
  private _slapR = 70;

  private _slapBaseGfx!: Phaser.GameObjects.Graphics;
  private _dashBaseGfx!: Phaser.GameObjects.Graphics;
  private _slapLabel!: Phaser.GameObjects.Text;
  private _dashLabel!: Phaser.GameObjects.Text;

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

    this._slapBaseGfx = scene.add.graphics().setDepth(20).setScrollFactor(0);
    this._dashBaseGfx = scene.add.graphics().setDepth(20).setScrollFactor(0);
    this._slapLabel = scene.add.text(0, 0, "SLAP\nHIT", { fontSize: "24px", color: "#ffffff", fontStyle: "bold", align: "center" }).setOrigin(0.5).setDepth(21).setScrollFactor(0);
    this._dashLabel = scene.add.text(0, 0, "QUICK\nDASH", { fontSize: "16px", color: "#ffffff", fontStyle: "bold", align: "center" }).setOrigin(0.5).setDepth(21).setScrollFactor(0);

    this._dashRingGfx = scene.add.graphics().setDepth(20).setScrollFactor(0);
    this._slapRingGfx = scene.add.graphics().setDepth(20).setScrollFactor(0);
    this._slapBounds = new Phaser.Geom.Circle(slapX, slapY, BIG_R);
    this._dashBounds = new Phaser.Geom.Circle(dashX, dashY, SM_R);

    this.reposition(panelCX, panelCY);

    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this._slapPtr === null && this._slapBounds.contains(p.x, p.y)) {
        this._slapPtr = p.id;
        this._slapDown = true;
        this._slapPressed = true;
        this._drawSlapBase();
      }
      if (this._dashPtr === null && this._dashBounds.contains(p.x, p.y) && this._dashCharges > 0) {
        this._dashPtr = p.id;
        this._dashTapped = true;
        this._dashPressed = true;
        this._drawDashBase();
      }
    });

    scene.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (this._slapPtr === p.id) {
        this._slapPtr = null;
        this._slapDown = false;
        this._slapPressed = false;
        this._drawSlapBase();
      }
      if (this._dashPtr === p.id) {
        this._dashPtr = null;
        this._dashPressed = false;
        this._drawDashBase();
      }
    });

    scene.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => {
      scene.input.emit("pointerup", p);
    });
  }

  /** Checks if a point is within any of the buttons. (Assumes screen coordinates) */
  contains(x: number, y: number): boolean {
    return this._slapBounds.contains(x, y) || this._dashBounds.contains(x, y);
  }

  reposition(panelCX: number, panelCY: number): void {
    const BIG_R = 70;
    const SM_R  = 50;

    this._slapCX = panelCX;
    this._slapCY = panelCY - 80;
    this._slapR = BIG_R;
    this._slapBounds.setTo(this._slapCX, this._slapCY, this._slapR);

    this._dashCX = panelCX;
    this._dashCY = panelCY + 100;
    this._dashR = SM_R;
    this._dashBounds.setTo(this._dashCX, this._dashCY, this._dashR);

    this._slapLabel.setPosition(this._slapCX, this._slapCY);
    this._dashLabel.setPosition(this._dashCX, this._dashCY);

    this._drawSlapBase();
    this._drawSlapRing();
    this._drawDashBase();
    this._drawDashRing();
  }



  private _drawDashBase(): void {
    const g = this._dashBaseGfx;
    const cx = this._dashCX, cy = this._dashCY, r = this._dashR;
    g.clear();

    // Background
    const bgColor = this._dashCharges > 0 ? 0x00cc66 : 0x333333; // Green or Gray
    g.fillStyle(bgColor, 0.85);
    g.fillCircle(cx, cy, r);

    // Border
    const borderColor = this._dashPressed ? ACTIVE : (this._dashCharges > 0 ? GLOW : DASH_EMPTY);
    g.lineStyle(2, borderColor, 0.7);
    g.strokeCircle(cx, cy, r);
  }

  updateDashState(charges: number, cooldownMs: number): void {
    this._dashCharges = charges;
    this._dashCooldownMs = cooldownMs;
    this._drawDashBase();
    this._drawDashRing();
  }

  updateSlapState(chargeMs: number): void {
    this._slapChargeMs = chargeMs;
    this._drawSlapBase();
    this._drawSlapRing();
  }

  private _drawSlapBase(): void {
    const g = this._slapBaseGfx;
    const cx = this._slapCX, cy = this._slapCY, r = this._slapR;
    g.clear();

    // Background
    g.fillStyle(0x00cc66, 0.85); // Green
    g.fillCircle(cx, cy, r);

    // Border
    const borderColor = this._slapPressed ? ACTIVE : GLOW;
    g.lineStyle(2, borderColor, 0.7);
    g.strokeCircle(cx, cy, r);
  }

  private _drawSlapRing(): void {
    const g = this._slapRingGfx;
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

  private _drawDashRing(): void {
    const g = this._dashRingGfx;
    const cx = this._dashCX, cy = this._dashCY, r = this._dashR;
    g.clear();

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
