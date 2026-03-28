import Phaser from "phaser";

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: "MenuScene" });
  }

  create(): void {
    this.add
      .text(640, 360, "Floorball Frenzy", {
        fontSize: "48px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    const localBtn = this.add
      .text(640, 460, "Local Match", {
        fontSize: "32px",
        color: "#aaffaa",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    localBtn.on("pointerdown", () => {
      this.scene.start("GameScene", { mode: "local" });
    });
  }
}
