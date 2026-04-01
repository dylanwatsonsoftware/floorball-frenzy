import Phaser from "phaser";

interface LobbyEntry {
  roomId: string;
  hostName: string;
  createdAt: number;
}

function randomRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function timeAgo(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

const W = 1280;
const H = 720;
const GREEN = 0x36b346;

export class MenuScene extends Phaser.Scene {
  private _mainMenuObjs: Phaser.GameObjects.GameObject[] = [];
  private _lobbyObjs: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super({ key: "MenuScene" });
  }

  create(): void {
    // Auto-join if a room code is in the URL hash (e.g. #ABC123)
    const hashCode = window.location.hash.slice(1).toUpperCase();
    if (hashCode.length > 0) {
      this.scene.start("OnlineGameScene", { mode: "online", roomId: hashCode, role: "client" });
      return;
    }

    const centerCamera = () => {
      const extraW = Math.max(0, this.scale.width - W);
      this.cameras.main.scrollX = -Math.floor(extraW / 2);
    };
    centerCamera();
    this.scale.on("resize", centerCamera);
    this.events.once("shutdown", () => this.scale.off("resize", centerCamera));

    const menuStart = this.children.list.length;
    this._drawBackground();
    this._drawTitle();
    this._drawButtons();
    this._mainMenuObjs = (this.children.list as Phaser.GameObjects.GameObject[]).slice(menuStart);
  }

  // ─── Main menu ──────────────────────────────────────────────────────────────

  private _drawBackground(): void {
    const gfx = this.add.graphics();
    gfx.fillGradientStyle(0x0a0f0a, 0x0a0f0a, 0x061208, 0x061208, 1);
    gfx.fillRect(0, 0, W, H);
    gfx.lineStyle(2, 0x36b346, 0.18);
    gfx.strokeRoundedRect(50, 50, W - 100, H - 100, 55);
    gfx.lineStyle(1, 0x36b346, 0.12);
    gfx.lineBetween(W / 2, 50, W / 2, H - 50);
    gfx.strokeCircle(W / 2, H / 2, 80);
    gfx.lineStyle(1, 0x36b346, 0.15);
    gfx.strokeRect(50, H / 2 - 44, 50, 88);
    gfx.strokeRect(W - 100, H / 2 - 44, 50, 88);
    gfx.fillStyle(0x36b346, 0.04);
    gfx.fillCircle(W / 2, H / 2, 260);
  }

  private _drawTitle(): void {
    const hasLogo = this.textures.exists("logo");
    if (hasLogo) this.add.image(W / 2, 105, "logo").setOrigin(0.5).setDisplaySize(168, 168);
    const titleY = hasLogo ? 218 : 108;
    this.add.text(W / 2 + 3, titleY + 3, "FLOORBALL FRENZY", {
      fontSize: "60px", fontStyle: "bold", color: "#000000",
    } as Phaser.Types.GameObjects.Text.TextStyle).setOrigin(0.5).setAlpha(0.4);
    this.add.text(W / 2, titleY, "FLOORBALL FRENZY", {
      fontSize: "60px", fontStyle: "bold", color: "#ffffff",
      stroke: "#1e7a29", strokeThickness: 6,
    }).setOrigin(0.5);
    this.add.text(W / 2, titleY + 54, "LAMBS FLOORBALL CLUB  ·  First to 5 goals wins", {
      fontSize: "16px", color: "#36b346", letterSpacing: 2,
    }).setOrigin(0.5);
  }

  private _drawButtons(): void {
    const cy = H / 2 + 50;

    this._makeButton(W / 2, cy - 80, "⚡  Local Match", "SAME DEVICE  ·  2 PLAYERS", GREEN, 0x1e7a29, () => {
      this.scene.start("GameScene", { mode: "local" });
    });

    this.add.text(W / 2, cy - 18, "Green: WASD · Shift · Q · E          Black: Arrows · Space · , · .", {
      fontSize: "13px", color: "#3a5040",
    }).setOrigin(0.5);

    const gfx = this.add.graphics();
    gfx.lineStyle(1, 0x1e3322, 1);
    gfx.lineBetween(W / 2 - 240, cy + 14, W / 2 + 240, cy + 14);
    this.add.text(W / 2, cy + 14, " ONLINE ", {
      fontSize: "12px", color: "#2a4a32", backgroundColor: "#061208",
    }).setOrigin(0.5);

    // ── Host: prompts for name, registers in lobby ───────────────────────────
    this._makeButton(W / 2, cy + 70, "🌐  Host Game", "CREATE A ROOM  ·  SHARE THE LINK", GREEN, 0x1e7a29, () => {
      const saved = localStorage.getItem("floorball:playerName") ?? "";
      const raw = window.prompt("Your name:", saved);
      if (raw === null) return; // cancelled
      const hostName = raw.trim() || "Player";
      localStorage.setItem("floorball:playerName", hostName);
      const roomId = randomRoomId();
      window.location.hash = roomId;
      // Register in lobby — best-effort, game starts regardless
      void fetch("/api/lobby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register", roomId, hostName }),
      }).catch(() => undefined);
      this.scene.start("OnlineGameScene", { mode: "online", roomId, role: "host" });
    });

    // ── Join: opens the lobby browser ────────────────────────────────────────
    this._makeButton(W / 2, cy + 160, "🔗  Join Game", "BROWSE OPEN GAMES", 0x333333, 0x1a1a1a, () => {
      void this._showLobby();
    });

    this.add.text(W / 2, cy + 218, "Or paste a friend's link directly into your browser", {
      fontSize: "13px", color: "#2a4a32",
    }).setOrigin(0.5);

    this._drawCommitInfo();
  }

  private _drawCommitInfo(): void {
    const diffMs = Date.now() - Number(__GIT_DATE__) * 1000;
    const m = Math.floor(diffMs / 60000);
    const ago = m === 0 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m/60)}h ago` : `${Math.floor(m/1440)}d ago`;
    this.add.text(W / 2, H - 10, `${__GIT_HASH__}  ·  ${ago}  ·  ${__GIT_MSG__}`, {
      fontSize: "15px", color: "#3a6644",
    }).setOrigin(0.5, 1);
  }

  // ─── Lobby browser ──────────────────────────────────────────────────────────

  private async _showLobby(): Promise<void> {
    this._mainMenuObjs.forEach(o => (o as unknown as { setVisible(v: boolean): void }).setVisible(false));

    const cx = W / 2, cy = H / 2;
    const PW = 560, PH = 390;

    // Panel
    const panel   = this.add.rectangle(cx, cy, PW, PH, 0x06060e, 0.95).setStrokeStyle(1, 0x224433, 1).setDepth(10);
    const titleTxt = this.add.text(cx, cy - PH / 2 + 30, "JOIN A GAME", {
      fontSize: "22px", color: "#00cc66", fontStyle: "bold", letterSpacing: 3,
    }).setOrigin(0.5).setDepth(11);
    const divGfx  = this.add.graphics().setDepth(10);
    divGfx.lineStyle(1, 0x224433, 0.6);
    divGfx.lineBetween(cx - PW / 2 + 24, cy - PH / 2 + 55, cx + PW / 2 - 24, cy - PH / 2 + 55);

    const statusTxt = this.add.text(cx, cy, "Loading…", {
      fontSize: "18px", color: "#556688",
    }).setOrigin(0.5).setDepth(11);

    // Back button
    const backBg  = this.add.rectangle(cx - 120, cy + PH / 2 - 30, 160, 42, 0x111111, 1)
      .setStrokeStyle(1, 0x444444, 1).setInteractive({ useHandCursor: true }).setDepth(11);
    const backTxt = this.add.text(cx - 120, cy + PH / 2 - 30, "‹ BACK", {
      fontSize: "15px", color: "#888888", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(12);
    backTxt.disableInteractive();

    // Refresh button
    const refreshBg  = this.add.rectangle(cx + 120, cy + PH / 2 - 30, 160, 42, 0x1a44bb, 1)
      .setStrokeStyle(1, 0x6699ff, 0.7).setInteractive({ useHandCursor: true }).setDepth(11);
    const refreshTxt = this.add.text(cx + 120, cy + PH / 2 - 30, "↻  REFRESH", {
      fontSize: "15px", color: "#ffffff", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(12);
    refreshTxt.disableInteractive();

    this._lobbyObjs = [panel, titleTxt, divGfx, statusTxt, backBg, backTxt, refreshBg, refreshTxt];

    backBg.on("pointerover",  () => backBg.setStrokeStyle(1, 0x888888, 1));
    backBg.on("pointerout",   () => backBg.setStrokeStyle(1, 0x444444, 1));
    backBg.on("pointerup",    () => this._hideLobby());
    refreshBg.on("pointerover",  () => refreshBg.setStrokeStyle(1, 0xaaccff, 1));
    refreshBg.on("pointerout",   () => refreshBg.setStrokeStyle(1, 0x6699ff, 0.7));
    refreshBg.on("pointerup",    () => { void loadGames(); });

    // Rows area: remove old rows and repopulate
    let rowObjs: Phaser.GameObjects.GameObject[] = [];

    const loadGames = async (): Promise<void> => {
      rowObjs.forEach(o => o.destroy());
      rowObjs = [];
      statusTxt.setText("Loading…").setVisible(true);

      let games: LobbyEntry[];
      try {
        const res = await fetch("/api/lobby");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        games = (await res.json()) as LobbyEntry[];
      } catch {
        statusTxt.setText("Could not load games — check your connection.");
        return;
      }

      if (games.length === 0) {
        statusTxt.setText("No open games right now.\nAsk a friend to host one!");
        return;
      }

      statusTxt.setVisible(false);
      const rowsTop = cy - PH / 2 + 75;
      const maxGames = Math.min(games.length, 5);

      for (let i = 0; i < maxGames; i++) {
        const game = games[i];
        const rowY = rowsTop + i * 54;

        const rowBg = this.add.rectangle(cx, rowY, PW - 40, 46, 0x0d0d1a, 1)
          .setStrokeStyle(1, 0x1a2233, 1).setDepth(11);

        const nameTxt = this.add.text(cx - PW / 2 + 50, rowY, game.hostName, {
          fontSize: "17px", color: "#ffffff", fontStyle: "bold",
        }).setOrigin(0, 0.5).setDepth(12);

        const ageTxt = this.add.text(cx + 30, rowY, timeAgo(Date.now() - game.createdAt), {
          fontSize: "14px", color: "#556688",
        }).setOrigin(0.5, 0.5).setDepth(12);

        const joinBg = this.add.rectangle(cx + PW / 2 - 55, rowY, 88, 34, GREEN, 1)
          .setInteractive({ useHandCursor: true }).setDepth(12);
        const joinTxt = this.add.text(cx + PW / 2 - 55, rowY, "JOIN", {
          fontSize: "14px", color: "#000000", fontStyle: "bold",
        }).setOrigin(0.5).setDepth(13);
        joinTxt.disableInteractive();

        joinBg.on("pointerover", () => joinBg.setFillStyle(0x55dd77));
        joinBg.on("pointerout",  () => joinBg.setFillStyle(GREEN));
        joinBg.on("pointerup", () => {
          // Remove from lobby then navigate
          void fetch("/api/lobby", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "join", roomId: game.roomId }),
          }).catch(() => undefined);
          window.location.hash = game.roomId;
          this.scene.start("OnlineGameScene", { mode: "online", roomId: game.roomId, role: "client" });
        });

        rowObjs.push(rowBg, nameTxt, ageTxt, joinBg, joinTxt);
      }

      // Add row objects to lobbyObjs so they're cleaned up on _hideLobby
      this._lobbyObjs.push(...rowObjs);
    };

    await loadGames();
  }

  private _hideLobby(): void {
    this._lobbyObjs.forEach(o => o.destroy());
    this._lobbyObjs = [];
    this._mainMenuObjs.forEach(o => (o as unknown as { setVisible(v: boolean): void }).setVisible(true));
  }

  // ─── Button factory ─────────────────────────────────────────────────────────

  private _makeButton(
    x: number, y: number,
    label: string, sublabel: string,
    color: number, colorDark: number,
    onClick: () => void,
  ): void {
    const W_BTN = 520, H_BTN = 76;
    const colorHex = `#${color.toString(16).padStart(6, "0")}`;

    const glow = this.add.rectangle(x, y, W_BTN + 8, H_BTN + 8, color, 0).setStrokeStyle(3, color, 0.25);
    const gradGfx = this.add.graphics();
    const drawGrad = (alpha: number) => {
      gradGfx.clear();
      gradGfx.fillGradientStyle(color, color, colorDark, colorDark, alpha);
      gradGfx.fillRoundedRect(x - W_BTN / 2, y - H_BTN / 2, W_BTN, H_BTN, 10);
    };
    drawGrad(0.18);
    const border = this.add.rectangle(x, y, W_BTN, H_BTN, 0x000000, 0)
      .setStrokeStyle(1.5, color, 0.7).setInteractive({ useHandCursor: true });
    const accentGfx = this.add.graphics();
    accentGfx.lineStyle(2, color, 0.6);
    accentGfx.lineBetween(x - W_BTN / 2 + 12, y - H_BTN / 2 + 1, x + W_BTN / 2 - 12, y - H_BTN / 2 + 1);
    const title = this.add.text(x, y - 12, label, {
      fontSize: "26px", fontStyle: "bold", color: "#ffffff",
      shadow: { offsetX: 0, offsetY: 1, color: colorHex, blur: 8, stroke: false, fill: true },
    }).setOrigin(0.5);
    const sub = this.add.text(x, y + 18, sublabel, {
      fontSize: "12px", color: colorHex, letterSpacing: 3,
    }).setOrigin(0.5);
    title.disableInteractive();
    sub.disableInteractive();

    border.on("pointerover", () => { drawGrad(0.35); glow.setStrokeStyle(3, color, 0.55); title.setShadow(0, 0, colorHex, 16, false, true); });
    border.on("pointerout",  () => { drawGrad(0.18); glow.setStrokeStyle(3, color, 0.25); title.setShadow(0, 1, colorHex, 8,  false, true); });
    border.on("pointerup", onClick);
  }
}
