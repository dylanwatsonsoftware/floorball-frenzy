import Phaser from "phaser";

function randomRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const W = 1280;
const H = 720;

const GREEN  = 0x36b346;
const DARK   = 0x111111;

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
    const gfx = this.add.graphics();

    // Deep black-to-dark-green gradient
    gfx.fillGradientStyle(0x0a0f0a, 0x0a0f0a, 0x061208, 0x061208, 1);
    gfx.fillRect(0, 0, W, H);

    // Faint rink outline
    gfx.lineStyle(2, 0x36b346, 0.18);
    gfx.strokeRoundedRect(50, 50, W - 100, H - 100, 55);

    // Centre line
    gfx.lineStyle(1, 0x36b346, 0.12);
    gfx.lineBetween(W / 2, 50, W / 2, H - 50);

    // Centre circle
    gfx.lineStyle(1, 0x36b346, 0.12);
    gfx.strokeCircle(W / 2, H / 2, 80);

    // Goal boxes (left & right)
    gfx.lineStyle(1, 0x36b346, 0.15);
    gfx.strokeRect(50, H / 2 - 44, 50, 88);
    gfx.strokeRect(W - 100, H / 2 - 44, 50, 88);

    // Subtle green glow vignette at centre
    gfx.fillStyle(0x36b346, 0.04);
    gfx.fillCircle(W / 2, H / 2, 260);
  }

  private _drawTitle(): void {
    const hasLogo = this.textures.exists("logo");

    if (hasLogo) {
      this.add.image(W / 2, 105, "logo").setOrigin(0.5).setDisplaySize(168, 168);
    }

    const titleY = hasLogo ? 218 : 108;

    // Shadow
    this.add.text(W / 2 + 3, titleY + 3, "FLOORBALL FRENZY", {
      fontSize: "60px", fontStyle: "bold", color: "#000000",
    } as Phaser.Types.GameObjects.Text.TextStyle).setOrigin(0.5).setAlpha(0.4);

    // Title
    this.add.text(W / 2, titleY, "FLOORBALL FRENZY", {
      fontSize: "60px",
      fontStyle: "bold",
      color: "#ffffff",
      stroke: "#1e7a29",
      strokeThickness: 6,
    }).setOrigin(0.5);

    // Tagline
    this.add.text(W / 2, titleY + 54, "LAMBS FLOORBALL CLUB  ·  First to 5 goals wins", {
      fontSize: "16px",
      color: "#36b346",
      letterSpacing: 2,
    }).setOrigin(0.5);
  }

  private _drawButtons(): void {
    const cy = H / 2 + 50; // vertical centre of button group

    // ── Local match ──────────────────────────────────────────────────────────
    this._makeButton(W / 2, cy - 80, "⚡  Local Match", "SAME DEVICE  ·  2 PLAYERS", GREEN, 0x1e7a29, () => {
      this.scene.start("GameScene", { mode: "local" });
    });

    this.add.text(W / 2, cy - 18, "Green: WASD · Shift · Q · E          Black: Arrows · Space · , · .", {
      fontSize: "13px", color: "#3a5040",
    }).setOrigin(0.5);

    // Divider with ONLINE label
    const gfx = this.add.graphics();
    gfx.lineStyle(1, 0x1e3322, 1);
    gfx.lineBetween(W / 2 - 240, cy + 14, W / 2 + 240, cy + 14);

    this.add.text(W / 2, cy + 14, " ONLINE ", {
      fontSize: "12px", color: "#2a4a32",
      backgroundColor: "#061208",
    }).setOrigin(0.5);

    // ── Host ─────────────────────────────────────────────────────────────────
    this._makeButton(W / 2, cy + 70, "🌐  Host Game", "CREATE A ROOM  ·  SHARE THE LINK", GREEN, 0x1e7a29, () => {
      const roomId = randomRoomId();
      window.location.hash = roomId;
      this.scene.start("OnlineGameScene", { mode: "online", roomId, role: "host" });
    });

    // ── Join ──────────────────────────────────────────────────────────────────
    this._makeButton(W / 2, cy + 160, "🔗  Join Game", "ENTER A ROOM CODE", 0x333333, 0x1a1a1a, () => {
      const code = window.prompt("Enter room code:");
      if (!code) return;
      const roomId = code.trim().toUpperCase();
      window.location.hash = roomId;
      this.scene.start("OnlineGameScene", { mode: "online", roomId, role: "client" });
    });

    this.add.text(W / 2, cy + 218, "Or share the URL — the room code is in the address bar", {
      fontSize: "13px", color: "#2a4a32",
    }).setOrigin(0.5);
  }

  /**
   * Draws a premium-styled button with gradient fill, glow border, and hover state.
   */
  private _makeButton(
    x: number,
    y: number,
    label: string,
    sublabel: string,
    color: number,
    colorDark: number,
    onClick: () => void
  ): void {
    const W_BTN = 520;
    const H_BTN = 76;

    // Outer glow (slightly larger, low alpha)
    const glow = this.add.rectangle(x, y, W_BTN + 8, H_BTN + 8, color, 0)
      .setStrokeStyle(3, color, 0.25);

    // Gradient background: drawn as two half-rectangles
    const gradGfx = this.add.graphics();
    const drawGrad = (alpha: number): void => {
      gradGfx.clear();
      gradGfx.fillGradientStyle(color, color, colorDark, colorDark, alpha);
      gradGfx.fillRoundedRect(x - W_BTN / 2, y - H_BTN / 2, W_BTN, H_BTN, 10);
    };
    drawGrad(0.18);

    // Crisp border
    const border = this.add.rectangle(x, y, W_BTN, H_BTN, 0x000000, 0)
      .setStrokeStyle(1.5, color, 0.7)
      .setInteractive({ useHandCursor: true });
    (border as Phaser.GameObjects.Rectangle & { _borderRadius?: number });

    // Accent line at top of button
    const accentGfx = this.add.graphics();
    accentGfx.lineStyle(2, color, 0.6);
    accentGfx.lineBetween(x - W_BTN / 2 + 12, y - H_BTN / 2 + 1, x + W_BTN / 2 - 12, y - H_BTN / 2 + 1);

    // Main label
    const colorHex = `#${color.toString(16).padStart(6, "0")}`;
    const title = this.add.text(x, y - 12, label, {
      fontSize: "26px",
      fontStyle: "bold",
      color: "#ffffff",
      shadow: { offsetX: 0, offsetY: 1, color: colorHex, blur: 8, stroke: false, fill: true },
    }).setOrigin(0.5);

    // Sublabel
    const sub = this.add.text(x, y + 18, sublabel, {
      fontSize: "12px",
      color: colorHex,
      letterSpacing: 3,
    }).setOrigin(0.5);

    title.disableInteractive();
    sub.disableInteractive();

    border.on("pointerover", () => {
      drawGrad(0.35);
      glow.setStrokeStyle(3, color, 0.55);
      title.setShadow(0, 0, colorHex, 16, false, true);
    });
    border.on("pointerout", () => {
      drawGrad(0.18);
      glow.setStrokeStyle(3, color, 0.25);
      title.setShadow(0, 1, colorHex, 8, false, true);
    });
    border.on("pointerup", onClick);
  }
}
