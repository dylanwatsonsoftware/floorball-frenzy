import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    // load assets here later
  }

  create(): void {
    this.scene.start("MenuScene");
  }
}
