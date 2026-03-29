import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    this.load.image("logo", "lambs-logo.png");
  }

  create(): void {
    this.scene.start("MenuScene");
  }
}
