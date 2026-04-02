import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    this.load.image("logo", "lambs-logo.png");
    this.load.spritesheet("char_host", "assets/male2.png", { frameWidth: 84, frameHeight: 92 });
    this.load.spritesheet("char_client", "assets/female2.png", { frameWidth: 84, frameHeight: 92 });
    this.load.spritesheet("stick", "assets/stick_white.png", { frameWidth: 160, frameHeight: 160 });
    this.load.spritesheet("stick_black", "assets/stick_black_v2.png", { frameWidth: 160, frameHeight: 160 });
  }

  create(): void {
    this.scene.start("MenuScene");
  }
}
