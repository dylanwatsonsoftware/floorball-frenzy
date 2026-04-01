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
    // Generate floorball ball texture procedurally (64×64, displayed at ~20px via scale)
    const size = 64;
    const cx = size / 2;
    const cy = size / 2;
    const r = 30;
    const g = this.add.graphics();

    // White ball body
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx, cy, r);

    // Subtle edge shading
    g.lineStyle(1.5, 0xcccccc, 0.8);
    g.strokeCircle(cx, cy, r);

    // Holes: 6 in a ring + 1 center (simplified floorball pattern)
    g.fillStyle(0x999999, 0.9);
    const holeR = 5;
    const holeRing = r * 0.52;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.fillCircle(cx + Math.cos(a) * holeRing, cy + Math.sin(a) * holeRing, holeR);
    }
    g.fillCircle(cx, cy, holeR);

    g.generateTexture("ball", size, size);
    g.destroy();

    this.scene.start("MenuScene");
  }
}
