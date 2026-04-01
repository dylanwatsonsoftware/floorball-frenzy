import Phaser from "phaser";
import { normaliseJoystick, deadZone } from "./joystickMath";
import type { Vec2 } from "./joystickMath";

const DEAD = 0.12; // dead-zone threshold

export class VirtualJoystick {
  /** Current normalised stick value (-1..1 each axis). */
  readonly value: Vec2 = { x: 0, y: 0 };

  private _base: Phaser.GameObjects.Arc;
  private _knob: Phaser.GameObjects.Arc;
  private _ghostBase: Phaser.GameObjects.Arc | null = null;
  private _ghostKnob: Phaser.GameObjects.Arc | null = null;
  private _pointer: Phaser.Input.Pointer | null = null;
  private _originX = 0;
  private _originY = 0;
  private readonly _radius: number;
  /** Touch zone in world coordinates: only activate if touch starts within this rectangle. */
  private readonly _zone: Phaser.Geom.Rectangle;

  constructor(
    scene: Phaser.Scene,
    zoneX: number,
    zoneY: number,
    zoneW: number,
    zoneH: number,
    radius = 55,
    /** Default ghost position in world coordinates — shown when joystick is idle. */
    defaultX?: number,
    defaultY?: number,
  ) {
    this._radius = radius;
    this._zone = new Phaser.Geom.Rectangle(zoneX, zoneY, zoneW, zoneH);

    // Ghost indicator at default position (always visible when joystick is idle)
    if (defaultX !== undefined && defaultY !== undefined) {
      this._ghostBase = scene.add
        .circle(defaultX, defaultY, radius, 0x000000, 0.18)
        .setStrokeStyle(2, 0xffffff, 0.25)
        .setDepth(19);
      this._ghostKnob = scene.add
        .circle(defaultX, defaultY, radius * 0.42, 0xffffff, 0.22)
        .setDepth(20);
    }

    // Active visuals — hidden until touch starts
    this._base = scene.add
      .circle(0, 0, radius, 0x000000, 0.25)
      .setStrokeStyle(2, 0xffffff, 0.4)
      .setDepth(20)
      .setVisible(false);

    this._knob = scene.add
      .circle(0, 0, radius * 0.42, 0xffffff, 0.55)
      .setDepth(21)
      .setVisible(false);

    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => this._onDown(p));
    scene.input.on("pointermove", (p: Phaser.Input.Pointer) => this._onMove(p));
    scene.input.on("pointerup", (p: Phaser.Input.Pointer) => this._onUp(p));
    scene.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => this._onUp(p));
  }

  private _onDown(p: Phaser.Input.Pointer): void {
    if (this._pointer !== null) return; // already tracking a finger
    if (!this._zone.contains(p.worldX, p.worldY)) return;

    this._pointer = p;
    this._originX = p.worldX;
    this._originY = p.worldY;

    this._ghostBase?.setVisible(false);
    this._ghostKnob?.setVisible(false);
    this._base.setPosition(p.worldX, p.worldY).setVisible(true);
    this._knob.setPosition(p.worldX, p.worldY).setVisible(true);
  }

  private _onMove(p: Phaser.Input.Pointer): void {
    if (this._pointer?.id !== p.id) return;

    const v = normaliseJoystick(this._originX, this._originY, p.worldX, p.worldY, this._radius);
    this.value.x = deadZone(v.x, DEAD);
    this.value.y = deadZone(v.y, DEAD);

    const kx = this._originX + this.value.x * this._radius;
    const ky = this._originY + this.value.y * this._radius;
    this._knob.setPosition(kx, ky);
  }

  private _onUp(p: Phaser.Input.Pointer): void {
    if (this._pointer?.id !== p.id) return;
    this._pointer = null;
    this.value.x = 0;
    this.value.y = 0;
    this._base.setVisible(false);
    this._knob.setVisible(false);
    this._ghostBase?.setVisible(true);
    this._ghostKnob?.setVisible(true);
  }

  isActive(): boolean {
    return this._pointer !== null;
  }
}
