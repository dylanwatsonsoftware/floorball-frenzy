import Phaser from "phaser";
import { normaliseJoystick, deadZone } from "./joystickMath";
import type { Vec2 } from "./joystickMath";

const DEAD = 0.12; // dead-zone threshold
const GLOW = 0x00e5ff;

export class VirtualJoystick {
  /** Current normalised stick value (-1..1 each axis). */
  readonly value: Vec2 = { x: 0, y: 0 };

  /** If false, the joystick won't show or capture input. */
  enabled = true;

  private _base: Phaser.GameObjects.Arc;
  private _knob: Phaser.GameObjects.Arc;
  private _hintBase?: Phaser.GameObjects.Arc;
  private _hintKnob?: Phaser.GameObjects.Arc;
  private _hintText?: Phaser.GameObjects.Text;
  private _pointer: Phaser.Input.Pointer | null = null;
  private _originX = 0;
  private _originY = 0;
  private readonly _radius: number;
  private readonly _zone: Phaser.Geom.Rectangle;

  constructor(
    scene: Phaser.Scene,
    zoneX: number,
    zoneY: number,
    zoneW: number,
    zoneH: number,
    radius = 60
  ) {
    this._radius = radius;
    this._zone = new Phaser.Geom.Rectangle(zoneX, zoneY, zoneW, zoneH);

    // Modern visuals matching ActionButtons
    this._base = scene.add
      .circle(0, 0, radius, 0x07070f, 0.4)
      .setStrokeStyle(2, GLOW, 0.4)
      .setDepth(20)
      .setScrollFactor(0)
      .setVisible(false);

    this._knob = scene.add
      .circle(0, 0, radius * 0.4, 0xffffff, 0.8)
      .setDepth(21)
      .setScrollFactor(0)
      .setVisible(false);

    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => this._onDown(p));
    scene.input.on("pointermove", (p: Phaser.Input.Pointer) => this._onMove(p));
    scene.input.on("pointerup", (p: Phaser.Input.Pointer) => this._onUp(p));
    scene.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => this._onUp(p));

    this._drawHint(scene, zoneX, zoneY, zoneW, zoneH);
  }

  private _drawHint(scene: Phaser.Scene, zX: number, zY: number, zW: number, zH: number): void {
    // Center the hint in the visible area (where worldX >= 0)
    const visibleLeft = Math.max(0, zX);
    const visibleRight = zX + zW;
    const cx = (visibleLeft + visibleRight) / 2;
    const cy = zY + zH / 2;
    const hintBase = scene.add.circle(cx, cy, this._radius, 0xffffff, 0.15)
      .setStrokeStyle(2, 0xffffff, 0.4).setDepth(15).setScrollFactor(0);
    const hintKnob = scene.add.circle(cx, cy, this._radius * 0.4, 0xffffff, 0.25).setDepth(16).setScrollFactor(0);
    const hintText = scene.add.text(cx, cy + this._radius + 25, "MOVE", {
      fontSize: "14px", color: "#ffffff", fontStyle: "bold", letterSpacing: 2
    }).setOrigin(0.5).setAlpha(0.7).setDepth(16).setScrollFactor(0);

    this._hintBase = hintBase;
    this._hintKnob = hintKnob;
    this._hintText = hintText;

    const updateHandler = () => {
      const show = this.enabled && !this.isActive();
      hintBase.setVisible(show);
      hintKnob.setVisible(show);
      hintText.setVisible(show);
    };

    scene.events.on("update", updateHandler);
    scene.events.once("shutdown", () => {
      scene.events.off("update", updateHandler);
    });
    hintBase.on("destroy", () => {
      scene.events.off("update", updateHandler);
    });
  }

  private _onDown(p: Phaser.Input.Pointer): void {
    if (!this.enabled || this._pointer !== null) return;
    // Only activate if not handled by buttons and within zone
    // zone is defined in screen coordinates in GameScene
    if (!this._zone.contains(p.x, p.y)) return;

    // We check button containment in GameScene to avoid circular deps or passing buttons here
    // but the scene's input system will emit for all pointers.

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

  /** Returns all internal game objects for camera filtering. */
  getGameObjects(): Phaser.GameObjects.GameObject[] {
    const objs: Phaser.GameObjects.GameObject[] = [this._base, this._knob];
    if (this._hintBase) objs.push(this._hintBase);
    if (this._hintKnob) objs.push(this._hintKnob);
    if (this._hintText) objs.push(this._hintText);
    return objs;
  }

  isActive(): boolean {
    return this._pointer !== null;
  }

  setVisible(visible: boolean): void {
    this.enabled = visible;
    this._base.setVisible(false); // Only show base/knob when active
    this._knob.setVisible(false);
    if (this._hintBase) this._hintBase.setVisible(visible);
    if (this._hintKnob) this._hintKnob.setVisible(visible);
    if (this._hintText) this._hintText.setVisible(visible);
  }

  reposition(zoneX: number, zoneY: number, zoneW: number, zoneH: number): void {
    this._zone.setTo(zoneX, zoneY, zoneW, zoneH);
    if (this._hintBase && this._hintKnob && this._hintText) {
      const visibleLeft = Math.max(0, zoneX);
      const visibleRight = zoneX + zoneW;
      const cx = (visibleLeft + visibleRight) / 2;
      const cy = zoneY + zoneH / 2;

      this._hintBase.setPosition(cx, cy);
      this._hintKnob.setPosition(cx, cy);
      this._hintText.setPosition(cx, cy + this._radius + 25);
    }
  }
}
