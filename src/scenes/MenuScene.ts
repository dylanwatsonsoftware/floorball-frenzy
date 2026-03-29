import Phaser from "phaser";

function randomRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const W = 1280;
const H = 720;

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: "MenuScene" });
  }

  create(): void {

    // Auto-join if a room code is in the URL hash (e.g. #ABC123)
    const hashCode = window.location.hash.slice(1).toUpperCase();
    if (hashCode.length > 0) {
      this.scene.start("OnlineGameScene", {
        mode: "online",
        roomId: hashCode,
        role: "client",
      });
      return;
    }

    this._drawBackground();
    this._drawTitle();
    this._drawButtons();
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _drawBackground(): void {
    // Dark gradient rink
    const gfx = this.add.graphics();

    // Deep navy background
    gfx.fillGradientStyle(0x0d1b3e, 0x0d1b3e, 0x0a1628, 0x0a1628, 1);
    gfx.fillRect(0, 0, W, H);

    // Rink outline — rounded rect
    gfx.lineStyle(3, 0x2255aa, 0.5);
    gfx.strokeRoundedRect(60, 60, W - 120, H - 120, 60);

    // Centre line
    gfx.lineStyle(2, 0x2255aa, 0.3);
    gfx.lineBetween(W / 2, 60, W / 2, H - 60);

    // Centre circle
    gfx.lineStyle(2, 0x2255aa, 0.3);
    gfx.strokeCircle(W / 2, H / 2, 90);

    // Goal creases
    gfx.lineStyle(2, 0x4477cc, 0.35);
    gfx.strokeRect(60, H / 2 - 55, 55, 110);
    gfx.strokeRect(W - 115, H / 2 - 55, 55, 110);

    // Subtle dot at centre
    gfx.fillStyle(0x4477cc, 0.4);
    gfx.fillCircle(W / 2, H / 2, 5);
  }

  private _drawTitle(): void {
    // Club logo
    const logo = this.textures.exists("logo")
      ? this.add.image(W / 2, 108, "logo").setOrigin(0.5).setDisplaySize(160, 160)
      : null;

    const titleY = logo ? 215 : 105;

    // Shadow
    this.add.text(W / 2 + 3, titleY + 3, "FLOORBALL FRENZY", {
      fontSize: "58px", fontStyle: "bold", color: "#000000",
    } as Phaser.Types.GameObjects.Text.TextStyle).setOrigin(0.5).setAlpha(0.35);

    this.add.text(W / 2, titleY, "FLOORBALL FRENZY", {
      fontSize: "58px",
      fontStyle: "bold",
      color: "#ffffff",
      stroke: "#1e7a29",
      strokeThickness: 5,
    }).setOrigin(0.5);

    this.add.text(W / 2, titleY + 52, "Lambs Floorball Club · First to 5 goals wins", {
      fontSize: "18px",
      color: "#66aa66",
    }).setOrigin(0.5);
  }

  private _drawButtons(): void {
    const shift = 65; // push buttons down to make room for logo

    // ── Local match ──────────────────────────────────────────────────────────
    this._makeButton(W / 2, 285 + shift, "Local Match", "Same keyboard, 2 players", 0x36b346, () => {
      this.scene.start("GameScene", { mode: "local" });
    });

    this.add.text(W / 2, 340 + shift, "Green: WASD + Shift / Q / E     Black: Arrows + Space / , / .", {
      fontSize: "14px",
      color: "#556677",
    }).setOrigin(0.5);

    // Divider
    const gfx = this.add.graphics();
    gfx.lineStyle(1, 0x334455, 0.8);
    gfx.lineBetween(W / 2 - 220, 375 + shift, W / 2 + 220, 375 + shift);

    this.add.text(W / 2, 375 + shift, "  ONLINE  ", {
      fontSize: "13px",
      color: "#445566",
      backgroundColor: "#0d1b3e",
    }).setOrigin(0.5);

    // ── Online: host ─────────────────────────────────────────────────────────
    this._makeButton(W / 2, 440 + shift, "Host Game", "Create a room and share the link", 0x36b346, () => {
      const roomId = randomRoomId();
      window.location.hash = roomId;
      this.scene.start("OnlineGameScene", { mode: "online", roomId, role: "host" });
    });

    // ── Online: join ─────────────────────────────────────────────────────────
    this._makeButton(W / 2, 535 + shift, "Join Game", "Enter a room code to connect", 0x888888, () => {
      const code = window.prompt("Enter room code:");
      if (!code) return;
      const roomId = code.trim().toUpperCase();
      window.location.hash = roomId;
      this.scene.start("OnlineGameScene", { mode: "online", roomId, role: "client" });
    });

    this.add.text(W / 2, 605 + shift, "Or share the URL — the room code is in the address bar", {
      fontSize: "15px",
      color: "#445566",
    }).setOrigin(0.5);
  }

  private _makeButton(
    x: number,
    y: number,
    label: string,
    sublabel: string,
    color: number,
    onClick: () => void
  ): void {
    const hex = `#${color.toString(16).padStart(6, "0")}`;
    const dimHex = `#${Math.floor(color * 0.55).toString(16).padStart(6, "0")}`;

    // Card background
    const bg = this.add.rectangle(x, y, 480, 72, color, 0.12)
      .setStrokeStyle(1.5, color, 0.5)
      .setInteractive({ useHandCursor: true });

    const title = this.add.text(x, y - 11, label, {
      fontSize: "26px",
      fontStyle: "bold",
      color: hex,
    }).setOrigin(0.5);

    const sub = this.add.text(x, y + 17, sublabel, {
      fontSize: "14px",
      color: dimHex,
    }).setOrigin(0.5);

    const highlight = (): void => {
      bg.setFillStyle(color, 0.25);
      title.setAlpha(0.85);
    };
    const unhighlight = (): void => {
      bg.setFillStyle(color, 0.12);
      title.setAlpha(1);
    };

    bg.on("pointerover", highlight);
    bg.on("pointerout", unhighlight);
    bg.on("pointerdown", onClick);

    // Make title/sub non-interactive so clicks fall through to bg
    title.disableInteractive();
    sub.disableInteractive();
  }
}
