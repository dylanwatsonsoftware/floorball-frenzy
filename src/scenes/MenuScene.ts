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

const GREEN = 0x36b346;

export class MenuScene extends Phaser.Scene {
  private _mainMenuObjs: Phaser.GameObjects.GameObject[] = [];
  private _lobbyObjs: Phaser.GameObjects.GameObject[] = [];
  private _lobbyRowObjs: Phaser.GameObjects.GameObject[] = [];
  private _hostingObjs: Phaser.GameObjects.GameObject[] = [];
  private _lobbyAutoRefresh: Phaser.Time.TimerEvent | null = null;
  private _isLobbyVisible = false;
  private _isHostingVisible = false;
  private _hostNameInput: string = "";

  constructor() {
    super({ key: "MenuScene" });
  }

  get w(): number { return this.scale.width; }
  get h(): number { return this.scale.height; }
  get isPortrait(): boolean { return this.h > this.w; }

  create(): void {
    const hashCode = window.location.hash.slice(1).toUpperCase();
    if (hashCode.length > 0) {
      this.scene.start("OnlineGameScene", { mode: "online", roomId: hashCode, role: "client" });
      return;
    }

    this._hostNameInput = localStorage.getItem("floorball:gameName") ?? "";

    this._render();
    this.scale.on("resize", () => this._render());
    this.events.once("shutdown", () => this.scale.off("resize"));
  }

  private _render(): void {
    this._cleanup();

    const menuStart = this.children.list.length;
    this._drawBackground();
    this._drawTitle();
    this._drawButtons();
    this._mainMenuObjs = (this.children.list as Phaser.GameObjects.GameObject[]).slice(menuStart);

    if (this._isLobbyVisible) {
      this._mainMenuObjs.forEach(o => (o as unknown as { setVisible(v: boolean): void }).setVisible(false));
      void this._showLobby();
    }

    if (this._isHostingVisible) {
        this._drawHostingModal();
    }
  }

  private _cleanup(): void {
    this._mainMenuObjs.forEach(o => o.destroy());
    this._mainMenuObjs = [];

    if (this._lobbyAutoRefresh) {
      this._lobbyAutoRefresh.destroy();
      this._lobbyAutoRefresh = null;
    }
    this._lobbyObjs.forEach(o => o.destroy());
    this._lobbyObjs = [];
    this._lobbyRowObjs.forEach(o => o.destroy());
    this._lobbyRowObjs = [];

    this._hostingObjs.forEach(o => o.destroy());
    this._hostingObjs = [];

    // Clean up any remaining hosting inputs
    const hostingInputs = document.querySelectorAll('.hosting-input');
    hostingInputs.forEach(el => el.remove());
  }

  // ─── Main menu ──────────────────────────────────────────────────────────────

  private _drawBackground(): void {
    const gfx = this.add.graphics();
    gfx.fillGradientStyle(0x0a0f0a, 0x0a0f0a, 0x061208, 0x061208, 1);
    gfx.fillRect(0, 0, this.w, this.h);

    const margin = this.isPortrait ? 20 : 50;
    gfx.lineStyle(2, 0x36b346, 0.18);
    gfx.strokeRoundedRect(margin, margin, this.w - margin * 2, this.h - margin * 2, this.isPortrait ? 30 : 55);

    gfx.lineStyle(1, 0x36b346, 0.12);
    if (this.isPortrait) {
        gfx.lineBetween(margin, this.h / 2, this.w - margin, this.h / 2);
    } else {
        gfx.lineBetween(this.w / 2, margin, this.w / 2, this.h - margin);
    }

    gfx.strokeCircle(this.w / 2, this.h / 2, this.isPortrait ? 60 : 80);

    gfx.lineStyle(1, 0x36b346, 0.15);
    if (this.isPortrait) {
        gfx.strokeRect(this.w / 2 - 44, margin, 88, 50);
        gfx.strokeRect(this.w / 2 - 44, this.h - margin - 50, 88, 50);
    } else {
        gfx.strokeRect(margin, this.h / 2 - 44, 50, 88);
        gfx.strokeRect(this.w - margin - 50, this.h / 2 - 44, 50, 88);
    }

    gfx.fillStyle(0x36b346, 0.04);
    gfx.fillCircle(this.w / 2, this.h / 2, this.isPortrait ? 180 : 260);
  }

  private _drawTitle(): void {
    const cx = this.w / 2;
    const hasLogo = this.textures.exists("logo");

    if (this.isPortrait) {
        if (hasLogo) this.add.image(cx, this.h * 0.15, "logo").setOrigin(0.5).setDisplaySize(140, 140);
        const titleY = hasLogo ? this.h * 0.28 : this.h * 0.2;

        this.add.text(cx + 2, titleY + 2, "FLOORBALL\nFRENZY", {
            fontSize: "48px", fontStyle: "bold", color: "#000000", align: "center",
        } as Phaser.Types.GameObjects.Text.TextStyle).setOrigin(0.5).setAlpha(0.4);

        this.add.text(cx, titleY, "FLOORBALL\nFRENZY", {
            fontSize: "48px", fontStyle: "bold", color: "#ffffff", align: "center",
            stroke: "#1e7a29", strokeThickness: 6,
        }).setOrigin(0.5);

        this.add.text(cx, titleY + 80, "LAMBS FLOORBALL CLUB\nFirst to 5 goals wins", {
            fontSize: "14px", color: "#ffffff", letterSpacing: 1, align: "center",
        }).setOrigin(0.5);
    } else {
        const logoSize = Math.min(this.h * 0.35, 168);
        if (hasLogo) this.add.image(cx, this.h * 0.2, "logo").setOrigin(0.5).setDisplaySize(logoSize, logoSize);

        const titleY = hasLogo ? this.h * 0.42 : this.h * 0.25;
        const fontSize = Math.min(this.h * 0.15, 60);

        this.add.text(cx + 3, titleY + 3, "FLOORBALL FRENZY", {
            fontSize: `${fontSize}px`, fontStyle: "bold", color: "#000000",
        } as Phaser.Types.GameObjects.Text.TextStyle).setOrigin(0.5).setAlpha(0.4);

        this.add.text(cx, titleY, "FLOORBALL FRENZY", {
            fontSize: `${fontSize}px`, fontStyle: "bold", color: "#ffffff",
            stroke: "#1e7a29", strokeThickness: 6,
        }).setOrigin(0.5);

        this.add.text(cx, titleY + fontSize * 0.9, "LAMBS FLOORBALL CLUB  ·  First to 5 goals wins", {
            fontSize: `${Math.max(12, fontSize * 0.25)}px`, color: "#ffffff", letterSpacing: 2,
        }).setOrigin(0.5);
    }
  }

  private _drawButtons(): void {
    const cx = this.w / 2;

    if (this.isPortrait) {
        const startY = this.h * 0.55;
        const spacing = 110;

        this._makeButton(cx, startY, "🌐  Play Online", "BROWSE & CREATE GAMES", GREEN, 0x1e7a29, () => {
            this._requestFullscreen();
            void this._showLobby();
        });

        this._makeButton(cx, startY + spacing, "⚡  Local Match", "SAME DEVICE · 2 PLAYERS", 0x2255aa, 0x112244, () => {
            this.scene.start("GameScene", { mode: "local" });
        });
    } else {
        const startY = this.h * 0.7;
        const spacing = Math.min(this.h * 0.2, 115);

        this._makeButton(cx, startY, "🌐  Play Online", "BROWSE & CREATE ONLINE GAMES", GREEN, 0x1e7a29, () => {
            this._requestFullscreen();
            void this._showLobby();
        });

        this._makeButton(cx, startY + spacing, "⚡  Local Match", "SAME DEVICE  ·  2 PLAYERS", 0x2255aa, 0x112244, () => {
            this.scene.start("GameScene", { mode: "local" });
        });
    }

    this._drawCommitInfo();
  }

  private _requestFullscreen(): void {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      void el.requestFullscreen().catch(() => { });
    }
  }

  private _drawCommitInfo(): void {
    const diffMs = Date.now() - Number(__GIT_DATE__) * 1000;
    const m = Math.floor(diffMs / 60000);
    const ago = m === 0 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
    this.add.text(this.w / 2, this.h - 10, `${__GIT_HASH__}  ·  ${ago}  ·  ${__GIT_MSG__}`, {
      fontSize: this.isPortrait ? "10px" : "15px", color: "#ffffff",
    }).setOrigin(0.5, 1);
  }

  // ─── Lobby (full-screen) ────────────────────────────────────────────────────

  private async _showLobby(): Promise<void> {
    this._isLobbyVisible = true;
    this._mainMenuObjs.forEach(o => (o as unknown as { setVisible(v: boolean): void }).setVisible(false));

    const cx = this.w / 2;

    // Full-screen background
    const bg = this.add.graphics().setDepth(9);
    bg.fillGradientStyle(0x0a0f0a, 0x0a0f0a, 0x061208, 0x061208, 1);
    bg.fillRect(0, 0, this.w, this.h);
    bg.lineStyle(1, 0x36b346, 0.1);
    bg.strokeRoundedRect(20, 20, this.w - 40, this.h - 40, 30);

    // Title
    const titleTxt = this.add.text(cx, this.isPortrait ? 50 : 68, "JOIN A GAME", {
      fontSize: this.isPortrait ? "24px" : "30px", color: "#00cc66", fontStyle: "bold", letterSpacing: 4,
    }).setOrigin(0.5).setDepth(10);

    const divGfx = this.add.graphics().setDepth(10);
    divGfx.lineStyle(1, 0x224433, 0.7);
    const divY = this.isPortrait ? 80 : 108;
    divGfx.lineBetween(40, divY, this.w - 40, divY);

    const statusTxt = this.add.text(cx, this.h / 2, "Loading…", {
      fontSize: "20px", color: "#556688", align: "center",
    }).setOrigin(0.5).setDepth(10);

    // ── Bottom action bar ──────────────────────────────────────────────────────
    const BAR_Y = this.h - (this.isPortrait ? 70 : 52);
    const BTN_W = this.isPortrait ? (this.w - 60) / 3 : 180;

    const backBg = this.add.rectangle(cx - (this.isPortrait ? BTN_W + 10 : 370), BAR_Y, this.isPortrait ? BTN_W : 180, 48, 0x111111, 1)
      .setStrokeStyle(1, 0x444444, 1).setInteractive({ useHandCursor: true }).setDepth(10);
    const backTxt = this.add.text(backBg.x, BAR_Y, this.isPortrait ? "BACK" : "‹  BACK", {
      fontSize: this.isPortrait ? "14px" : "16px", color: "#888888", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(11);
    backTxt.disableInteractive();

    const refreshBg = this.add.rectangle(cx, BAR_Y, this.isPortrait ? BTN_W : 180, 48, 0x1a44bb, 1)
      .setStrokeStyle(1, 0x6699ff, 0.7).setInteractive({ useHandCursor: true }).setDepth(10);
    const refreshTxt = this.add.text(cx, BAR_Y, this.isPortrait ? "REFRESH" : "↻  REFRESH", {
      fontSize: this.isPortrait ? "14px" : "16px", color: "#ffffff", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(11);
    refreshTxt.disableInteractive();

    const newGameBg = this.add.rectangle(cx + (this.isPortrait ? BTN_W + 10 : 370), BAR_Y, this.isPortrait ? BTN_W : 240, 48, GREEN, 1)
      .setStrokeStyle(1, 0x55ff77, 0.5).setInteractive({ useHandCursor: true }).setDepth(10);
    const newGameTxt = this.add.text(newGameBg.x, BAR_Y, this.isPortrait ? "CREATE" : "✚  CREATE NEW GAME", {
      fontSize: this.isPortrait ? "14px" : "15px", color: "#000000", fontStyle: "bold",
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
    newGameBg.on("pointerup", () => { this._isHostingVisible = true; this._drawHostingModal(); });

    // ── Game rows (rebuilt on every refresh) ──────────────────────────────────
    let knownRoomIds: Set<string> | null = null; // null = first load, no ding

    const loadGames = async (): Promise<void> => {
      this._lobbyRowObjs.forEach(o => o.destroy());
      this._lobbyRowObjs = [];
      if (!this._isLobbyVisible) return;
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

      if (knownRoomIds !== null) {
        const hasNew = games.some(g => !knownRoomIds!.has(g.roomId));
        if (hasNew) this._playLobbyDing();
      }
      knownRoomIds = new Set(games.map(g => g.roomId));

      if (games.length === 0) {
        statusTxt.setText("No open games right now.\nPress CREATE to start one!");
        return;
      }
      statusTxt.setVisible(false);

      const ROW_H = 70;
      const ROW_W = this.w - (this.isPortrait ? 60 : 160);
      const rowsTop = this.isPortrait ? 100 : 130;
      const max = Math.min(games.length, this.isPortrait ? 6 : 7);

      for (let i = 0; i < max; i++) {
        const game = games[i];
        const rowY = rowsTop + i * ROW_H + ROW_H / 2;
        const isEven = i % 2 === 0;

        const rowBg = this.add.rectangle(cx, rowY, ROW_W, ROW_H - 6, isEven ? 0x0d0d1a : 0x0a0a14, 1)
          .setStrokeStyle(1, 0x1a2233, 1).setDepth(10);

        // Coloured dot
        const dot = this.add.circle(cx - ROW_W / 2 + 25, rowY, 8, GREEN, 0.7).setDepth(11);

        const nameTxt = this.add.text(cx - ROW_W / 2 + 45, rowY, game.hostName, {
          fontSize: this.isPortrait ? "16px" : "20px", color: "#ffffff", fontStyle: "bold",
        }).setOrigin(0, 0.5).setDepth(11);

        const ageTxt = this.add.text(cx + (this.isPortrait ? 20 : 80), rowY, timeAgo(Date.now() - game.createdAt), {
          fontSize: "14px", color: "#556688",
        }).setOrigin(0.5, 0.5).setDepth(11);

        const joinBg = this.add.rectangle(cx + ROW_W / 2 - (this.isPortrait ? 45 : 70), rowY, this.isPortrait ? 80 : 120, 44, GREEN, 1)
          .setInteractive({ useHandCursor: true }).setDepth(11);
        const joinTxt = this.add.text(joinBg.x, rowY, "JOIN", {
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

        this._lobbyRowObjs.push(rowBg, dot, nameTxt, ageTxt, joinBg, joinTxt);
      }
    };

    await loadGames();

    if (this._lobbyAutoRefresh) this._lobbyAutoRefresh.destroy();
    this._lobbyAutoRefresh = this.time.addEvent({ delay: 5000, loop: true, callback: () => { void loadGames(); } });
  }

  private _hideLobby(): void {
    this._isLobbyVisible = false;
    if (this._lobbyAutoRefresh) { this._lobbyAutoRefresh.destroy(); this._lobbyAutoRefresh = null; }
    this._lobbyObjs.forEach(o => o.destroy());
    this._lobbyObjs = [];
    this._mainMenuObjs.forEach(o => (o as unknown as { setVisible(v: boolean): void }).setVisible(true));
  }

  private _drawHostingModal(): void {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const MW = Math.min(this.w - 40, 480);
    const MH = this.isPortrait ? 280 : 220;

    const overlay = this.add.rectangle(cx, cy, this.w, this.h, 0x000000, 0.75).setDepth(20).setInteractive();

    const modalGfx = this.add.graphics().setDepth(21);
    modalGfx.fillStyle(0x0d1a12, 1);
    modalGfx.fillRoundedRect(cx - MW / 2, cy - MH / 2, MW, MH, 16);
    modalGfx.lineStyle(1, 0x36b346, 0.7);
    modalGfx.strokeRoundedRect(cx - MW / 2, cy - MH / 2, MW, MH, 16);

    const titleTxt = this.add.text(cx, cy - MH / 2 + 36, "ENTER GAME NAME", {
      fontSize: "20px", color: "#00cc66", fontStyle: "bold", letterSpacing: 3,
    }).setOrigin(0.5).setDepth(22);

    const el = document.createElement("input");
    el.className = "hosting-input";
    Object.assign(el.style, {
      position: "fixed", left: "50%", top: "50%",
      transform: "translate(-50%, -50%)",
      width: `${Math.min(this.w - 80, 340)}px`, height: "44px", background: "#0a0f0a",
      border: "1px solid #36b346", borderRadius: "8px",
      color: "#ffffff", fontSize: "20px", padding: "0 12px",
      outline: "none", fontFamily: "monospace", textAlign: "center",
      zIndex: "9999", boxSizing: "border-box",
    });
    el.maxLength = 50;
    el.value = this._hostNameInput;
    el.placeholder = "Game name…";
    document.body.appendChild(el);
    el.addEventListener("focus", () => this.input.keyboard?.disableGlobalCapture());
    el.addEventListener("blur", () => {
        this.input.keyboard?.enableGlobalCapture();
        this._hostNameInput = el.value;
    });
    setTimeout(() => { el.focus(); el.select(); }, 50);

    const okY = this.isPortrait ? cy + 40 : cy + MH / 2 - 40;
    const okBg = this.add.rectangle(cx + (this.isPortrait ? 0 : 90), okY, 140, 44, GREEN, 1)
      .setStrokeStyle(1, 0x55ff77, 0.5).setInteractive({ useHandCursor: true }).setDepth(22);
    const okTxt = this.add.text(okBg.x, okY, "OK", {
      fontSize: "17px", color: "#000000", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(23);

    const cancelY = this.isPortrait ? cy + 95 : cy + MH / 2 - 40;
    const cancelBg = this.add.rectangle(cx - (this.isPortrait ? 0 : 90), cancelY, 140, 44, 0x111111, 1)
      .setStrokeStyle(1, 0x555555, 1).setInteractive({ useHandCursor: true }).setDepth(22);
    const cancelTxt = this.add.text(cancelBg.x, cancelY, "CANCEL", {
      fontSize: "17px", color: "#888888", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(23);

    okTxt.disableInteractive();
    cancelTxt.disableInteractive();

    this._hostingObjs = [overlay, modalGfx, titleTxt, okBg, okTxt, cancelBg, cancelTxt];
    const destroy = () => { this._isHostingVisible = false; el.remove(); this._hostingObjs.forEach(o => o.destroy()); this._hostingObjs = []; };

    const confirm = () => {
      const hostName = el.value.trim() || "Game";
      this._hostNameInput = hostName;
      destroy();
      localStorage.setItem("floorball:gameName", hostName);
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
    okBg.on("pointerout", () => okBg.setFillStyle(GREEN));
    okBg.on("pointerup", confirm);

    cancelBg.on("pointerover", () => cancelBg.setStrokeStyle(1, 0x888888, 1));
    cancelBg.on("pointerout", () => cancelBg.setStrokeStyle(1, 0x555555, 1));
    cancelBg.on("pointerup", destroy);

    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") confirm();
      if (e.key === "Escape") destroy();
    });

    el.addEventListener("input", () => {
        this._hostNameInput = el.value;
    });
  }

  // ─── Button factory ─────────────────────────────────────────────────────────

  private _playLobbyDing(): void {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1108, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.9);
    } catch { /* audio not available */ }
  }

  private _makeButton(
    x: number, y: number,
    label: string, sublabel: string,
    color: number, colorDark: number,
    onClick: () => void,
  ): void {
    const W_BTN = this.isPortrait ? this.w * 0.85 : Math.min(this.w * 0.7, 520);
    const H_BTN = this.isPortrait ? 85 : Math.min(this.h * 0.18, 76);
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
    const title = this.add.text(x, y - (this.isPortrait ? 15 : 12), label, {
      fontSize: this.isPortrait ? "24px" : "26px", fontStyle: "bold", color: "#ffffff",
      shadow: { offsetX: 0, offsetY: 1, color: colorHex, blur: 8, stroke: false, fill: true },
    }).setOrigin(0.5);
    const sub = this.add.text(x, y + (this.isPortrait ? 22 : 18), sublabel, {
      fontSize: this.isPortrait ? "11px" : "12px", color: "#ffffff", letterSpacing: this.isPortrait ? 2 : 3,
    }).setOrigin(0.5);
    title.disableInteractive();
    sub.disableInteractive();

    border.on("pointerover", () => { drawGrad(0.35); glow.setStrokeStyle(3, color, 0.55); title.setShadow(0, 0, colorHex, 16, false, true); });
    border.on("pointerout", () => { drawGrad(0.18); glow.setStrokeStyle(3, color, 0.25); title.setShadow(0, 1, colorHex, 8, false, true); });
    border.on("pointerup", onClick);
  }
}
