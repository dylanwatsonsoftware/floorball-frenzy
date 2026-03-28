import Phaser from "phaser";

function randomRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: "MenuScene" });
  }

  create(): void {
    // Auto-join if a room code is in the URL hash (e.g. #ABC123)
    const hashCode = window.location.hash.slice(1).toUpperCase();
    if (hashCode.length > 0) {
      window.location.hash = "";
      this.scene.start("OnlineGameScene", {
        mode: "online",
        roomId: hashCode,
        role: "client",
      });
      return;
    }

    this.add
      .text(640, 120, "Floorball Frenzy", { fontSize: "56px", color: "#ffffff", fontStyle: "bold" })
      .setOrigin(0.5);

    this.add
      .text(640, 185, "First to 5 goals wins", { fontSize: "20px", color: "#888888" })
      .setOrigin(0.5);

    // ── Local match ──────────────────────────────────────────────────────────
    this._makeButton(640, 300, "⚽  Local Match  (2 players, same keyboard)", 0xaaffaa, () => {
      this.scene.start("GameScene", { mode: "local" });
    });

    this.add.text(640, 345, "Blue: WASD + Shift/Q/E   Red: Arrows + Space/,/.", {
      fontSize: "15px", color: "#666666",
    }).setOrigin(0.5);

    // ── Online: host ─────────────────────────────────────────────────────────
    this._makeButton(640, 440, "🌐  Host Online Game", 0xaaaaff, () => {
      const roomId = randomRoomId();
      window.location.hash = roomId;
      this.scene.start("OnlineGameScene", { mode: "online", roomId, role: "host" });
    });

    // ── Online: join ─────────────────────────────────────────────────────────
    this._makeButton(640, 530, "🔗  Join Game  (enter room code)", 0xffaaaa, () => {
      const code = window.prompt("Enter room code:");
      if (!code) return;
      const roomId = code.trim().toUpperCase();
      window.location.hash = roomId;
      this.scene.start("OnlineGameScene", {
        mode: "online",
        roomId,
        role: "client",
      });
    });

    this.add
      .text(640, 590, "Share the URL with your opponent — room code is in the address bar", {
        fontSize: "15px", color: "#666666",
      })
      .setOrigin(0.5);
  }

  private _makeButton(
    x: number,
    y: number,
    label: string,
    color: number,
    onClick: () => void
  ): Phaser.GameObjects.Text {
    const hex = `#${color.toString(16).padStart(6, "0")}`;
    const btn = this.add
      .text(x, y, label, { fontSize: "28px", color: hex })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    btn.on("pointerover", () => btn.setAlpha(0.75));
    btn.on("pointerout", () => btn.setAlpha(1));
    btn.on("pointerdown", onClick);
    return btn;
  }
}
