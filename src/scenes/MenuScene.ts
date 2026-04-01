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
  private _lobbyAutoRefresh: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super({ key: "MenuScene" });
  }

  create(): void {
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
    // Two buttons: Play Online (green) + Local Match
    this._makeButton(W / 2, H / 2 + 30, "🌐  Play Online", "BROWSE & CREATE ONLINE GAMES", GREEN, 0x1e7a29, () => {
      void this._showLobby();
    });

    this._makeButton(W / 2, H / 2 + 145, "⚡  Local Match", "SAME DEVICE  ·  2 PLAYERS", 0x2255aa, 0x112244, () => {
      this.scene.start("GameScene", { mode: "local" });
    });

    this.add.text(W / 2, H / 2 + 210, "Green: WASD · Shift · Q · E          Black: Arrows · Space · , · .", {
      fontSize: "13px", color: "#3a5040",
    }).setOrigin(0.5);

    this._drawCommitInfo();
  }

  private _drawCommitInfo(): void {
    const diffMs = Date.now() - Number(__GIT_DATE__) * 1000;
    const m = Math.floor(diffMs / 60000);
    const ago = m === 0 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
    this.add.text(W / 2, H - 10, `${__GIT_HASH__}  ·  ${ago}  ·  ${__GIT_MSG__}`, {
      fontSize: "15px", color: "#3a6644",
    }).setOrigin(0.5, 1);
  }

  // ─── Lobby (full-screen) ────────────────────────────────────────────────────

  private async _showLobby(): Promise<void> {
    this._mainMenuObjs.forEach(o => (o as unknown as { setVisible(v: boolean): void }).setVisible(false));

    const cx = W / 2;

    // Full-screen background
    const bg = this.add.graphics().setDepth(9);
    bg.fillGradientStyle(0x0a0f0a, 0x0a0f0a, 0x061208, 0x061208, 1);
    bg.fillRect(0, 0, W, H);
    bg.lineStyle(1, 0x36b346, 0.1);
    bg.strokeRoundedRect(30, 30, W - 60, H - 60, 50);

    // Title
    const titleTxt = this.add.text(cx, 68, "JOIN A GAME", {
      fontSize: "30px", color: "#00cc66", fontStyle: "bold", letterSpacing: 4,
    }).setOrigin(0.5).setDepth(10);

    const divGfx = this.add.graphics().setDepth(10);
    divGfx.lineStyle(1, 0x224433, 0.7);
    divGfx.lineBetween(80, 108, W - 80, 108);

    const statusTxt = this.add.text(cx, H / 2, "Loading…", {
      fontSize: "20px", color: "#556688", align: "center",
    }).setOrigin(0.5).setDepth(10);

    // ── Bottom action bar ──────────────────────────────────────────────────────
    const BAR_Y = H - 52;

    const backBg = this.add.rectangle(cx - 370, BAR_Y, 180, 48, 0x111111, 1)
      .setStrokeStyle(1, 0x444444, 1).setInteractive({ useHandCursor: true }).setDepth(10);
    const backTxt = this.add.text(cx - 370, BAR_Y, "‹  BACK", {
      fontSize: "16px", color: "#888888", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(11);
    backTxt.disableInteractive();

    const refreshBg = this.add.rectangle(cx, BAR_Y, 180, 48, 0x1a44bb, 1)
      .setStrokeStyle(1, 0x6699ff, 0.7).setInteractive({ useHandCursor: true }).setDepth(10);
    const refreshTxt = this.add.text(cx, BAR_Y, "↻  REFRESH", {
      fontSize: "16px", color: "#ffffff", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(11);
    refreshTxt.disableInteractive();

    const newGameBg = this.add.rectangle(cx + 370, BAR_Y, 240, 48, GREEN, 1)
      .setStrokeStyle(1, 0x55ff77, 0.5).setInteractive({ useHandCursor: true }).setDepth(10);
    const newGameTxt = this.add.text(cx + 370, BAR_Y, "✚  CREATE NEW GAME", {
      fontSize: "15px", color: "#000000", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(11);
    newGameTxt.disableInteractive();

    this._lobbyObjs = [bg, titleTxt, divGfx, statusTxt, backBg, backTxt, refreshBg, refreshTxt, newGameBg, newGameTxt];

    // ── Button interactions ───────────────────────────────────────────────────
    backBg.on("pointerover", () => backBg.setStrokeStyle(1, 0x888888, 1));
    backBg.on("pointerout", () => backBg.setStrokeStyle(1, 0x444444, 1));
    backBg.on("pointerup", () => this._hideLobby());

    refreshBg.on("pointerover", () => refreshBg.setStrokeStyle(1, 0xaaccff, 1));
    refreshBg.on("pointerout", () => refreshBg.setStrokeStyle(1, 0x6699ff, 0.7));
    refreshBg.on("pointerup", () => { void loadGames(); });

    newGameBg.on("pointerover", () => newGameBg.setFillStyle(0x55dd77));
    newGameBg.on("pointerout", () => newGameBg.setFillStyle(GREEN));
    newGameBg.on("pointerup", () => this._startHosting());

    // ── Game rows (rebuilt on every refresh) ──────────────────────────────────
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
        statusTxt.setText("Could not load games.\nCheck your connection.");
        return;
      }

      if (games.length === 0) {
        statusTxt.setText("No open games right now.\nPress CREATE NEW GAME to start one!");
        return;
      }
      statusTxt.setVisible(false);

      const ROW_H = 70;
      const ROW_W = W - 160;
      const rowsTop = 130;
      const max = Math.min(games.length, 7);

      for (let i = 0; i < max; i++) {
        const game = games[i];
        const rowY = rowsTop + i * ROW_H + ROW_H / 2;
        const isEven = i % 2 === 0;

        const rowBg = this.add.rectangle(cx, rowY, ROW_W, ROW_H - 6, isEven ? 0x0d0d1a : 0x0a0a14, 1)
          .setStrokeStyle(1, 0x1a2233, 1).setDepth(10);

        // Coloured dot
        const dot = this.add.circle(cx - ROW_W / 2 + 30, rowY, 10, GREEN, 0.7).setDepth(11);

        const nameTxt = this.add.text(cx - ROW_W / 2 + 56, rowY, game.hostName, {
          fontSize: "20px", color: "#ffffff", fontStyle: "bold",
        }).setOrigin(0, 0.5).setDepth(11);

        const ageTxt = this.add.text(cx + 80, rowY, timeAgo(Date.now() - game.createdAt), {
          fontSize: "15px", color: "#556688",
        }).setOrigin(0.5, 0.5).setDepth(11);

        const joinBg = this.add.rectangle(cx + ROW_W / 2 - 70, rowY, 120, 44, GREEN, 1)
          .setInteractive({ useHandCursor: true }).setDepth(11);
        const joinTxt = this.add.text(cx + ROW_W / 2 - 70, rowY, "JOIN", {
          fontSize: "17px", color: "#000000", fontStyle: "bold",
        }).setOrigin(0.5).setDepth(12);
        joinTxt.disableInteractive();

        joinBg.on("pointerover", () => joinBg.setFillStyle(0x55dd77));
        joinBg.on("pointerout", () => joinBg.setFillStyle(GREEN));
        joinBg.on("pointerup", () => {
          void fetch("/api/lobby", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "join", roomId: game.roomId }),
          }).catch(() => undefined);
          window.location.hash = game.roomId;
          this.scene.start("OnlineGameScene", { mode: "online", roomId: game.roomId, role: "client" });
        });

        rowObjs.push(rowBg, dot, nameTxt, ageTxt, joinBg, joinTxt);
      }

      this._lobbyObjs.push(...rowObjs);
    };

    await loadGames();

    const autoRefresh = this.time.addEvent({ delay: 5000, loop: true, callback: () => { void loadGames(); } });
    this._lobbyAutoRefresh = autoRefresh;
  }

  private _hideLobby(): void {
    if (this._lobbyAutoRefresh) { this._lobbyAutoRefresh.destroy(); this._lobbyAutoRefresh = null; }
    this._lobbyObjs.forEach(o => o.destroy());
    this._lobbyObjs = [];
    this._mainMenuObjs.forEach(o => (o as unknown as { setVisible(v: boolean): void }).setVisible(true));
  }

  private _startHosting(): void {
    const saved = localStorage.getItem("floorball:playerName") ?? "";
    const cx = W / 2;
    const cy = H / 2;
    const MW = 480, MH = 220;

    const overlay = this.add.rectangle(cx, cy, W, H, 0x000000, 0.75).setDepth(20).setInteractive();

    const modalGfx = this.add.graphics().setDepth(21);
    modalGfx.fillStyle(0x0d1a12, 1);
    modalGfx.fillRoundedRect(cx - MW / 2, cy - MH / 2, MW, MH, 16);
    modalGfx.lineStyle(1, 0x36b346, 0.7);
    modalGfx.strokeRoundedRect(cx - MW / 2, cy - MH / 2, MW, MH, 16);

    const titleTxt = this.add.text(cx, cy - MH / 2 + 36, "ENTER YOUR NAME", {
      fontSize: "20px", color: "#00cc66", fontStyle: "bold", letterSpacing: 3,
    }).setOrigin(0.5).setDepth(22);

    const inputDom = this.add.dom(cx, cy - 14, "input").setDepth(22);
    const el = inputDom.node as HTMLInputElement;
    Object.assign(el.style, {
      width: "340px", height: "44px", background: "#0a0f0a",
      border: "1px solid #36b346", borderRadius: "8px",
      color: "#ffffff", fontSize: "20px", padding: "0 12px",
      outline: "none", fontFamily: "monospace", textAlign: "center",
    });
    el.maxLength = 30;
    el.value = saved;
    setTimeout(() => { el.focus(); el.select(); }, 50);

    const okBg = this.add.rectangle(cx + 90, cy + MH / 2 - 40, 140, 44, GREEN, 1)
      .setStrokeStyle(1, 0x55ff77, 0.5).setInteractive({ useHandCursor: true }).setDepth(22);
    const okTxt = this.add.text(cx + 90, cy + MH / 2 - 40, "OK", {
      fontSize: "17px", color: "#000000", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(23);

    const cancelBg = this.add.rectangle(cx - 90, cy + MH / 2 - 40, 140, 44, 0x111111, 1)
      .setStrokeStyle(1, 0x555555, 1).setInteractive({ useHandCursor: true }).setDepth(22);
    const cancelTxt = this.add.text(cx - 90, cy + MH / 2 - 40, "CANCEL", {
      fontSize: "17px", color: "#888888", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(23);
    okTxt.disableInteractive();
    cancelTxt.disableInteractive();

    const promptObjs = [overlay, modalGfx, titleTxt, inputDom, okBg, okTxt, cancelBg, cancelTxt];
    const destroy = () => promptObjs.forEach(o => o.destroy());

    const confirm = () => {
      const hostName = el.value.trim() || "Player";
      destroy();
      localStorage.setItem("floorball:playerName", hostName);
      const roomId = randomRoomId();
      window.location.hash = roomId;
      void fetch("/api/lobby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register", roomId, hostName }),
      }).catch(() => undefined);
      this.scene.start("OnlineGameScene", { mode: "online", roomId, role: "host" });
    };

    okBg.on("pointerover", () => okBg.setFillStyle(0x55dd77));
    okBg.on("pointerout",  () => okBg.setFillStyle(GREEN));
    okBg.on("pointerup", confirm);

    cancelBg.on("pointerover", () => cancelBg.setStrokeStyle(1, 0x888888, 1));
    cancelBg.on("pointerout",  () => cancelBg.setStrokeStyle(1, 0x555555, 1));
    cancelBg.on("pointerup", destroy);

    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") confirm();
      if (e.key === "Escape") destroy();
    });
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
    border.on("pointerout", () => { drawGrad(0.18); glow.setStrokeStyle(3, color, 0.25); title.setShadow(0, 1, colorHex, 8, false, true); });
    border.on("pointerup", onClick);
  }
}
