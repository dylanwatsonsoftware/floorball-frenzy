import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    this.load.image("logo", "lambs-logo.png");
    this.load.spritesheet("char_host", "assets/male-player.png", { frameWidth: 352, frameHeight: 384 });
    this.load.spritesheet("char_client", "assets/female-player.png", { frameWidth: 352, frameHeight: 384 });
    this.load.spritesheet("stick_host", "assets/stick_black.png", { frameWidth: 160, frameHeight: 160 });
    this.load.spritesheet("stick_client", "assets/stick_white.png", { frameWidth: 160, frameHeight: 160 });
  }

  create(): void {
    this.scene.start("MenuScene");
  }
}
