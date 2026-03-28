import Phaser from "phaser";
import { normaliseJoystick, deadZone } from "./joystickMath";
import type { Vec2 } from "./joystickMath";

const DEAD = 0.12; // dead-zone threshold

export class VirtualJoystick {
  /** Current normalised stick value (-1..1 each axis). */
  readonly value: Vec2 = { x: 0, y: 0 };

  private _base: Phaser.GameObjects.Arc;
  private _knob: Phaser.GameObjects.Arc;
  private _pointer: Phaser.Input.Pointer | null = null;
  private _originX = 0;
  private _originY = 0;
  private readonly _radius: number;
  /** Touch zone: only activate if touch starts within this rectangle. */
  private readonly _zone: Phaser.Geom.Rectangle;

  constructor(
    scene: Phaser.Scene,
    zoneX: number,
    zoneY: number,
    zoneW: number,
    zoneH: number,
    radius = 55
  ) {
    this._radius = radius;
    this._zone = new Phaser.Geom.Rectangle(zoneX, zoneY, zoneW, zoneH);

    // Visuals — hidden until touch starts
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
    if (!this._zone.contains(p.x, p.y)) return;

    this._pointer = p;
    this._originX = p.x;
    this._originY = p.y;

    this._base.setPosition(p.x, p.y).setVisible(true);
    this._knob.setPosition(p.x, p.y).setVisible(true);
  }

  private _onMove(p: Phaser.Input.Pointer): void {
    if (this._pointer?.id !== p.id) return;

    const v = normaliseJoystick(this._originX, this._originY, p.x, p.y, this._radius);
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
  }

  isActive(): boolean {
    return this._pointer !== null;
  }
}
