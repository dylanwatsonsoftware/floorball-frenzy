import Phaser from "phaser";
import type { GameMode } from "../types/game";

export class GameScene extends Phaser.Scene {
  private _mode: GameMode = "local";

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { mode: GameMode }): void {
    this._mode = data.mode ?? "local";
  }

  create(): void {
    this.add
      .text(640, 360, `Mode: ${this._mode}`, {
        fontSize: "24px",
        color: "#ffffff",
      })
      .setOrigin(0.5);
  }

  update(_time: number, _delta: number): void {}
}
