import Phaser from "phaser";
import { isIOS, isStandalone } from "../utils/browserDetection";

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

function formatGitAge(gitDateVal: number | string | undefined): string {
  const gitDate = Number(gitDateVal);
  if (isNaN(gitDate) || gitDate === 0) return "unknown";
  const diffMs = Date.now() - gitDate * 1000;
  const m = Math.floor(diffMs / 60000);
  if (m === 0) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

function checkIsPortrait(sw: number, sh: number): boolean {
  let isPortrait = sh > sw;
  if (typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try {
      if (typeof window !== "undefined" && window.screen && window.screen.orientation && window.screen.orientation.type) {
        isPortrait = window.screen.orientation.type.startsWith("portrait");
      } else if (typeof window !== "undefined" && window.screen) {
        isPortrait = window.screen.height > window.screen.width;
      }
    } catch (e) {
      console.warn("checkIsPortrait failed, falling back to sh > sw", e);
      isPortrait = sh > sw;
    }
  }
  return isPortrait;
}

const W = 1280;
const H = 720;
const GREEN = 0x36b346;

export class MenuScene extends Phaser.Scene {
  private _mainMenuObjs: Phaser.GameObjects.GameObject[] = [];
  private _lobbyObjs: Phaser.GameObjects.GameObject[] = [];
  private _lobbyRowObjs: Phaser.GameObjects.GameObject[] = [];
  private _hostingObjs: Phaser.GameObjects.GameObject[] = [];
  private _lobbyAutoRefresh: Phaser.Time.TimerEvent | null = null;
  private _isLobbyVisible = false;
  private _isHostingVisible = false;
  private _hostingInput: HTMLInputElement | null = null;
  private _renderBound: () => void;
  private _savedGameName = "";

  constructor() {
    super({ key: "MenuScene" });
    this._renderBound = this._render.bind(this);
  }

  create(): void {
    try {
      this._savedGameName = localStorage.getItem("floorball:gameName") ?? "";
    } catch (e) {
      this._savedGameName = "";
      console.warn("localStorage access failed", e);
    }

    const hashCode = window.location.hash.slice(1).toUpperCase();
    if (hashCode.length > 0) {
      this.scene.start("OnlineGameScene", { mode: "online", roomId: hashCode, role: "client" });
      return;
    }

    this._render();
    this.scale.on("resize", this._renderBound);

    // Listen for the install prompt event to re-render the menu
    const onInstallPrompt = () => this._render();
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstallPrompt);

    this.events.once("shutdown", () => {
      this.scale.off("resize", this._renderBound);
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstallPrompt);
      this._cleanupAll();
    });
  }

  private _cleanupAll(): void {
    this._cleanup();
    if (this._hostingInput) {
      this._hostingInput.remove();
      this._hostingInput = null;
    }
  }

  private _cleanup(): void {
    [...this._mainMenuObjs, ...this._lobbyObjs, ...this._lobbyRowObjs, ...this._hostingObjs].forEach(o => o.destroy());
    this._mainMenuObjs = [];
    this._lobbyObjs = [];
    this._lobbyRowObjs = [];
    this._hostingObjs = [];
    if (this._lobbyAutoRefresh) {
      this._lobbyAutoRefresh.destroy();
      this._lobbyAutoRefresh = null;
    }
    // Note: _hostingInput is NOT removed here to prevent keyboard flicker on mobile resize
  }

  private _render(): void {
    this._cleanup();

    const sw = this.scale.width;
    const sh = this.scale.height;
    const isPortrait = checkIsPortrait(sw, sh);

    // Center camera
    if (!isPortrait) {
      const extraW = Math.max(0, sw - W);
      this.cameras.main.scrollX = -Math.floor(extraW / 2);
      this.cameras.main.scrollY = 0;
    } else {
      this.cameras.main.scrollX = 0;
      this.cameras.main.scrollY = 0;
    }

    if (this._isLobbyVisible) {
      void this._showLobby();
      if (this._isHostingVisible) {
        this._startHosting();
      }
    } else {
      // If we are not in lobby, hosting modal definitely shouldn't be there
      if (this._hostingInput) {
        this._hostingInput.remove();
        this._hostingInput = null;
      }
      this._drawMainMenu(isPortrait, sw, sh);
    }
  }

  // ─── Main menu ──────────────────────────────────────────────────────────────

  private _drawMainMenu(isPortrait: boolean, sw: number, sh: number): void {
    const menuStart = this.children.list.length;

    if (isPortrait) {
      this._drawBackgroundPortrait(sw, sh);
      this._drawTitlePortrait(sw, sh);
      this._drawButtonsPortrait(sw, sh);
    } else {
      this._drawBackgroundLandscape();
      this._drawTitleLandscape();
      this._drawButtonsLandscape();
    }

    this._mainMenuObjs = (this.children.list as Phaser.GameObjects.GameObject[]).slice(menuStart);
  }

  private _drawBackgroundLandscape(): void {
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

  private _drawBackgroundPortrait(sw: number, sh: number): void {
    const gfx = this.add.graphics();
    gfx.fillGradientStyle(0x0a0f0a, 0x0a0f0a, 0x061208, 0x061208, 1);
    gfx.fillRect(0, 0, sw, sh);

    // Subtle decorative rink lines for portrait
    gfx.lineStyle(2, 0x36b346, 0.12);
    gfx.strokeRoundedRect(20, 20, sw - 40, sh - 40, 40);
    gfx.lineStyle(1, 0x36b346, 0.08);
    gfx.lineBetween(20, sh / 2, sw - 20, sh / 2);
    gfx.strokeCircle(sw / 2, sh / 2, sw * 0.2);
  }

  private _drawTitleLandscape(): void {
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
      fontSize: "16px", color: "#ffffff", letterSpacing: 2,
    }).setOrigin(0.5);
  }

  private _drawTitlePortrait(sw: number, sh: number): void {
    const hasLogo = this.textures.exists("logo");
    const logoSize = Math.min(sw * 0.6, 380);
    if (hasLogo) this.add.image(sw / 2, sh * 0.2, "logo").setOrigin(0.5).setDisplaySize(logoSize, logoSize);

    const titleY = hasLogo ? sh * 0.2 + logoSize / 2 + 60 : sh * 0.2;
    const titleSize = Math.floor(sw * 0.12);

    this.add.text(sw / 2 + 3, titleY + 3, "FLOORBALL\nFRENZY", {
      fontSize: `${titleSize}px`, fontStyle: "bold", color: "#000000", align: "center"
    } as Phaser.Types.GameObjects.Text.TextStyle).setOrigin(0.5).setAlpha(0.4);

    this.add.text(sw / 2, titleY, "FLOORBALL\nFRENZY", {
      fontSize: `${titleSize}px`, fontStyle: "bold", color: "#ffffff",
      stroke: "#1e7a29", strokeThickness: 8, align: "center"
    }).setOrigin(0.5);

    this.add.text(sw / 2, titleY + titleSize + 20, "LAMBS FLOORBALL CLUB\nFirst to 5 goals wins", {
      fontSize: "20px", color: "#ffffff", letterSpacing: 1, align: "center"
    }).setOrigin(0.5);
  }

  private _drawButtonsLandscape(): void {
    const btnW = 520;
    const btnH = 76;
    const hasPrompt = !!(window as any).deferredPrompt;
    const showIOSInstall = isIOS() && !isStandalone();
    const hasInstall = hasPrompt || showIOSInstall;

    const startY = hasInstall ? H / 2 + 10 : H / 2 - 20;

    this._makeButton(W / 2, startY, btnW, btnH, "🌐  Play Online", "BROWSE & CREATE ONLINE GAMES", GREEN, 0x1e7a29, () => {
      this._isLobbyVisible = true;
      this._render();
    });

    this._makeButton(W / 2, startY + 95, btnW, btnH, "⚡  Solo Match", "VS AI  ·  SOLO MATCH", 0x2255aa, 0x112244, () => {
      this._attemptVisuals();
      this.scene.start("GameScene", { mode: "local" });
    });

    if (hasInstall) {
      this._makeButton(W / 2, startY + 190, btnW, btnH, "📲  Install App", "PLAY FULLSCREEN & OFFLINE", 0xaa22aa, 0x441144, () => {
        if (hasPrompt) {
          void (window as any).deferredPrompt.prompt();
          void (window as any).deferredPrompt.userChoice.then(() => {
            (window as any).deferredPrompt = null;
            this._render();
          });
        } else if (showIOSInstall) {
          const el = document.getElementById("ios-install-overlay");
          if (el) el.style.display = "flex";
        }
      });
    }

    this._drawCommitInfoLandscape();
  }

  private _drawButtonsPortrait(sw: number, sh: number): void {
    const btnW = sw * 0.96;
    const btnH = 200;
    const hasPrompt = !!(window as any).deferredPrompt;
    const showIOSInstall = isIOS() && !isStandalone();
    const hasInstall = hasPrompt || showIOSInstall;

    // Push buttons lower to avoid overlap with title/logo on shorter screens
    const startY = hasInstall ? sh * 0.58 : sh * 0.62;

    this._makeButton(sw / 2, startY, btnW, btnH, "🌐  Play Online", "BROWSE & CREATE ONLINE GAMES", GREEN, 0x1e7a29, () => {
      this._isLobbyVisible = true;
      this._render();
    }, 2.3);

    this._makeButton(sw / 2, startY + 230, btnW, btnH, "⚡  Solo Match", "VS AI  ·  SOLO MATCH", 0x2255aa, 0x112244, () => {
      this._attemptVisuals();
      this.scene.start("GameScene", { mode: "local" });
    }, 2.3);

    if (hasInstall) {
      this._makeButton(sw / 2, startY + 460, btnW, btnH, "📲  Install App", "PLAY FULLSCREEN & OFFLINE", 0xaa22aa, 0x441144, () => {
        if (hasPrompt) {
          void (window as any).deferredPrompt.prompt();
          void (window as any).deferredPrompt.userChoice.then(() => {
            (window as any).deferredPrompt = null;
            this._render();
          });
        } else if (showIOSInstall) {
          const el = document.getElementById("ios-install-overlay");
          if (el) el.style.display = "flex";
        }
      }, 2.3);
    }

    this._drawCommitInfoPortrait(sw, sh);
  }

  private _drawCommitInfoLandscape(): void {
    const ago = formatGitAge(__GIT_DATE__);
    this.add.text(W / 2, H - 10, `${__GIT_HASH__}  ·  ${ago}  ·  ${__GIT_MSG__}`, {
      fontSize: "15px", color: "#ffffff",
    }).setOrigin(0.5, 1);
  }

  private _drawCommitInfoPortrait(sw: number, sh: number): void {
    const ago = formatGitAge(__GIT_DATE__);
    this.add.text(sw / 2, sh - 10, `${__GIT_HASH__}\n${ago}  ·  ${__GIT_MSG__}`, {
      fontSize: "14px", color: "#ffffff", align: "center"
    }).setOrigin(0.5, 1);
  }

  private _attemptVisuals(): void {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      void el.requestFullscreen().catch(() => { });
    }
    if (screen.orientation?.lock) {
      void screen.orientation.lock("landscape").catch(() => { });
    }
  }

  // ─── Lobby (full-screen) ────────────────────────────────────────────────────

  private async _showLobby(): Promise<void> {
    const sw = this.scale.width;
    const sh = this.scale.height;
    const isPortrait = checkIsPortrait(sw, sh);
    const cx = isPortrait ? sw / 2 : W / 2;
    const viewW = isPortrait ? sw : W;
    const viewH = isPortrait ? sh : H;

    // Full-screen background
    const bg = this.add.graphics().setDepth(9);
    bg.fillGradientStyle(0x0a0f0a, 0x0a0f0a, 0x061208, 0x061208, 1);
    bg.fillRect(0, 0, viewW, viewH);
    bg.lineStyle(1, 0x36b346, 0.1);
    bg.strokeRoundedRect(isPortrait ? 10 : 30, isPortrait ? 10 : 30, viewW - (isPortrait ? 20 : 60), viewH - (isPortrait ? 20 : 60), isPortrait ? 20 : 50);

    // Title
    const titleTxt = this.add.text(cx, isPortrait ? 40 : 68, "Join a Game", {
      fontSize: isPortrait ? "40px" : "30px", color: "#00cc66", fontStyle: "bold", letterSpacing: 4,
    }).setOrigin(0.5).setDepth(10);

    const divGfx = this.add.graphics().setDepth(10);
    divGfx.lineStyle(1, 0x224433, 0.7);
    divGfx.lineBetween(isPortrait ? 40 : 80, isPortrait ? 80 : 108, viewW - (isPortrait ? 40 : 80), isPortrait ? 80 : 108);

    const statusTxt = this.add.text(cx, viewH / 2, "Loading…", {
      fontSize: isPortrait ? "24px" : "20px", color: "#556688", align: "center",
    }).setOrigin(0.5).setDepth(10);

    // ── Bottom action bar ──────────────────────────────────────────────────────
    const BAR_Y = viewH - (isPortrait ? 400 : 190);
    const BTN_SCALE = isPortrait ? 2.5 : 2.0;

    const bgH = isPortrait ? 116 : 48 * BTN_SCALE;
    const backWidth = isPortrait ? sw * 0.46 : 180 * BTN_SCALE;
    const backX = isPortrait ? cx - sw * 0.25 : cx - (180 * BTN_SCALE / 2) - 15;

    const smallBtnY = isPortrait ? BAR_Y + 150 : BAR_Y + 110;
    const ts = isPortrait ? 1.4 : 0.9;

    const b1 = this._makeButton(backX, smallBtnY, backWidth, bgH, "‹  BACK", "", 0x666677, 0x333344, () => this._hideLobby(), ts, 10);

    const refreshX = isPortrait ? cx + sw * 0.25 : cx + (180 * BTN_SCALE / 2) + 15;
    const b2 = this._makeButton(refreshX, smallBtnY, backWidth, bgH, "↻  REFRESH", "", 0x1a44bb, 0x051144, () => { void loadGames(); }, ts, 10);

    const newGameY = BAR_Y;
    const newH = isPortrait ? 132 : 48 * BTN_SCALE;
    const tsNew = isPortrait ? 1.5 : 0.9;
    const b3 = this._makeButton(cx, newGameY, isPortrait ? sw * 0.95 : 260 * BTN_SCALE, newH, "✚  CREATE NEW GAME", "", GREEN, 0x1e7a29, () => {
      this._isHostingVisible = true;
      this._startHosting();
    }, tsNew, 10);

    this._lobbyObjs = [bg, titleTxt, divGfx, statusTxt, ...b1, ...b2, ...b3];

    // ── Game rows (rebuilt on every refresh) ──────────────────────────────────
    let knownRoomIds: Set<string> | null = null; // null = first load, no ding

    const loadGames = async (): Promise<void> => {
      // Async safety: check if the scene or lobby is still active
      if (!this.scene.isActive() || !this._isLobbyVisible) return;

      this._lobbyRowObjs.forEach(o => o.destroy());
      this._lobbyRowObjs = [];
      statusTxt.setText("Loading…").setVisible(true);

      let games: LobbyEntry[];
      try {
        const res = await fetch("/api/lobby");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        games = (await res.json()) as LobbyEntry[];
      } catch {
        if (!this.scene.isActive() || !this._isLobbyVisible) return;
        statusTxt.setText("Could not load games.\nCheck your connection.");
        return;
      }

      if (!this.scene.isActive() || !this._isLobbyVisible) return;

      if (knownRoomIds !== null) {
        const hasNew = games.some(g => !knownRoomIds!.has(g.roomId));
        if (hasNew) this._playLobbyDing();
      }
      knownRoomIds = new Set(games.map(g => g.roomId));

      if (games.length === 0) {
        statusTxt.setText("No open games right now.\nPress CREATE NEW GAME to start one!");
        return;
      }
      statusTxt.setVisible(false);

      const ROW_H = isPortrait ? 120 : 70;
      const ROW_W = viewW - (isPortrait ? 40 : 160);
      const rowsTop = isPortrait ? 100 : 130;
      const max = Math.min(games.length, isPortrait ? 5 : 7);

      for (let i = 0; i < max; i++) {
        const game = games[i];
        const rowY = rowsTop + i * ROW_H + ROW_H / 2;
        const isEven = i % 2 === 0;

        const rowBg = this.add.rectangle(cx, rowY, ROW_W, ROW_H - 6, isEven ? 0x0d0d1a : 0x0a0a14, 1)
          .setStrokeStyle(1, 0x1a2233, 1).setDepth(10);

        // Coloured dot
        const dot = this.add.circle(cx - ROW_W / 2 + (isPortrait ? 24 : 30), rowY, isPortrait ? 16 : 10, GREEN, 0.7).setDepth(11);

        const nameTxt = this.add.text(cx - ROW_W / 2 + (isPortrait ? 56 : 56), rowY, game.hostName, {
          fontSize: isPortrait ? "28px" : "20px", color: "#ffffff", fontStyle: "bold",
        }).setOrigin(0, 0.5).setDepth(11);

        const ageTxt = this.add.text(isPortrait ? cx + ROW_W / 2 - 190 : cx + 80, rowY, timeAgo(Date.now() - game.createdAt), {
          fontSize: isPortrait ? "20px" : "15px", color: "#556688",
        }).setOrigin(0.5, 0.5).setDepth(11);

        const joinBg = this.add.rectangle(cx + ROW_W / 2 - (isPortrait ? 60 : 70), rowY, isPortrait ? 100 : 120, isPortrait ? 70 : 44, GREEN, 1)
          .setInteractive({ useHandCursor: true }).setDepth(11);
        const joinTxt = this.add.text(joinBg.x, joinBg.y, "JOIN", {
          fontSize: isPortrait ? "24px" : "17px", color: "#000000", fontStyle: "bold",
        }).setOrigin(0.5).setDepth(12);
        joinTxt.disableInteractive();

        joinBg.on("pointerover", () => joinBg.setFillStyle(0x55dd77));
        joinBg.on("pointerout", () => joinBg.setFillStyle(GREEN));
        joinBg.on("pointerup", () => {
          this._attemptVisuals();
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

    const autoRefresh = this.time.addEvent({ delay: 5000, loop: true, callback: () => { void loadGames(); } });
    this._lobbyAutoRefresh = autoRefresh;
  }

  private _hideLobby(): void {
    this._isLobbyVisible = false;
    this._isHostingVisible = false;
    this._render();
  }

  private _startHosting(): void {
    const sw = this.scale.width;
    const sh = this.scale.height;
    const isPortrait = checkIsPortrait(sw, sh);
    const cx = isPortrait ? sw / 2 : W / 2;
    const cy = isPortrait ? sh / 2 : H / 2;

    const saved = this._savedGameName;
    const MW = isPortrait ? sw * 0.95 : 600, MH = 500;

    const overlay = this.add.rectangle(cx, cy, isPortrait ? sw : W, isPortrait ? sh : H, 0x000000, 0.75).setDepth(20).setInteractive();

    const modalGfx = this.add.graphics().setDepth(21);
    modalGfx.fillStyle(0x0d1a12, 1);
    modalGfx.fillRoundedRect(cx - MW / 2, cy - MH / 2, MW, MH, 16);
    modalGfx.lineStyle(1, 0x36b346, 0.7);
    modalGfx.strokeRoundedRect(cx - MW / 2, cy - MH / 2, MW, MH, 16);

    const titleTxt = this.add.text(cx, cy - MH / 2 + 76, "Enter Game Name", {
      fontSize: "42px", color: "#00cc66", fontStyle: "bold", letterSpacing: 5,
    }).setOrigin(0.5).setDepth(22);

    let el = this._hostingInput;
    if (!el) {
      el = document.createElement("input");
      this._hostingInput = el;
      el.maxLength = 50;
      el.value = saved;
      el.placeholder = "Game Name...";
      document.body.appendChild(el);
      el.addEventListener("focus", () => this.input.keyboard?.disableGlobalCapture());
      el.addEventListener("blur", () => {
        if (el) this._savedGameName = el.value;
        this.input.keyboard?.enableGlobalCapture();
      });
      el.addEventListener("input", () => {
        if (el) this._savedGameName = el.value;
      });
      setTimeout(() => { if (el) { el.focus(); el.select(); } }, 50);
    }

    if (el) Object.assign(el.style, {
      position: "fixed", left: "50%", top: "50%",
      transform: "translate(-50%, -50%)",
      width: isPortrait ? "90%" : "500px", height: "76px", background: "#0a0f0a",
      border: "1px solid #36b346", borderRadius: "8px",
      color: "#ffffff", fontSize: "32px", padding: "0 16px",
      outline: "none", fontFamily: "monospace", textAlign: "center",
      zIndex: "9999", boxSizing: "border-box",
    });

    const okBg = this.add.rectangle(cx + (isPortrait ? MW * 0.25 : 130), cy + MH / 2 - 80, isPortrait ? MW * 0.45 : 220, 80, GREEN, 1)
      .setStrokeStyle(1, 0x55ff77, 0.5).setInteractive({ useHandCursor: true }).setDepth(22);
    const okTxt = this.add.text(okBg.x, okBg.y, "Ok", {
      fontSize: "32px", color: "#000000", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(23);

    const cancelBg = this.add.rectangle(cx - (isPortrait ? MW * 0.25 : 130), cy + MH / 2 - 80, isPortrait ? MW * 0.45 : 220, 80, 0x111111, 1)
      .setStrokeStyle(1, 0x555555, 1).setInteractive({ useHandCursor: true }).setDepth(22);
    const cancelTxt = this.add.text(cancelBg.x, cancelBg.y, "Cancel", {
      fontSize: "32px", color: "#888888", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(23);
    okTxt.disableInteractive();
    cancelTxt.disableInteractive();

    this._hostingObjs = [overlay, modalGfx, titleTxt, okBg, okTxt, cancelBg, cancelTxt];
    const destroy = () => {
      this._isHostingVisible = false;
      if (this._hostingInput) {
        this._hostingInput.remove();
        this._hostingInput = null;
      }
      this._cleanup();
      this._render();
    };

    const confirm = () => {
      if (!el) return;
      const hostName = el.value.trim() || "Game";
      this._isHostingVisible = false;
      this._savedGameName = hostName;
      if (this._hostingInput) {
        this._hostingInput.remove();
        this._hostingInput = null;
      }
      this._cleanup();
      try {
        localStorage.setItem("floorball:gameName", hostName);
      } catch (e) {
        console.warn("localStorage setItem failed", e);
      }
      const roomId = randomRoomId();
      window.location.hash = roomId;
      void fetch("/api/lobby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register", roomId, hostName }),
      }).catch(() => undefined);
      this._attemptVisuals();
      this.scene.start("OnlineGameScene", { mode: "online", roomId, role: "host" });
    };

    okBg.on("pointerover", () => okBg.setFillStyle(0x55dd77));
    okBg.on("pointerout", () => okBg.setFillStyle(GREEN));
    okBg.on("pointerup", confirm);

    cancelBg.on("pointerover", () => cancelBg.setStrokeStyle(1, 0x888888, 1));
    cancelBg.on("pointerout", () => cancelBg.setStrokeStyle(1, 0x555555, 1));
    cancelBg.on("pointerup", destroy);

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter") confirm();
      if (e.key === "Escape") destroy();
    };
    el?.addEventListener("keydown", onKeydown);
    // Cleanup the event listener on next render
    this.events.once("render", () => { if (el) el.removeEventListener("keydown", onKeydown); });
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
    w: number, h: number,
    label: string, sublabel: string,
    color: number, colorDark: number,
    onClick: () => void,
    scale = 1.0,
    depth = 0
  ): Phaser.GameObjects.GameObject[] {
    const W_BTN = w, H_BTN = h;
    const colorHex = `#${color.toString(16).padStart(6, "0")}`;

    const glow = this.add.rectangle(x, y, W_BTN + 8 * scale, H_BTN + 8 * scale, color, 0).setStrokeStyle(3 * scale, color, 0.25).setDepth(depth);
    const gradGfx = this.add.graphics().setDepth(depth);
    const drawGrad = (alpha: number) => {
      gradGfx.clear();
      gradGfx.fillGradientStyle(color, color, colorDark, colorDark, alpha);
      gradGfx.fillRoundedRect(x - W_BTN / 2, y - H_BTN / 2, W_BTN, H_BTN, 10 * scale);
    };
    drawGrad(0.18);
    const border = this.add.rectangle(x, y, W_BTN, H_BTN, 0x000000, 0)
      .setStrokeStyle(1.5 * scale, color, 0.7).setInteractive({ useHandCursor: true }).setDepth(depth);
    const accentGfx = this.add.graphics().setDepth(depth);
    accentGfx.lineStyle(2 * scale, color, 0.6);
    accentGfx.lineBetween(x - W_BTN / 2 + 12 * scale, y - H_BTN / 2 + 1, x + W_BTN / 2 - 12 * scale, y - H_BTN / 2 + 1);

    const hasSub = sublabel !== "";
    const titleOffsetY = hasSub ? -12 * scale : 0;
    const title = this.add.text(x, y + titleOffsetY, label, {
      fontSize: `${26 * scale}px`, fontStyle: "bold", color: "#ffffff",
      shadow: { offsetX: 0, offsetY: 1 * scale, color: colorHex, blur: 8 * scale, stroke: false, fill: true },
    }).setOrigin(0.5).setDepth(depth + 1);
    title.disableInteractive();

    const objs: Phaser.GameObjects.GameObject[] = [glow, gradGfx, border, accentGfx, title];

    if (hasSub) {
      const sub = this.add.text(x, y + 18 * scale, sublabel, {
        fontSize: `${12 * scale}px`, color: "#ffffff", letterSpacing: 3 * scale,
      }).setOrigin(0.5).setDepth(depth + 1);
      sub.disableInteractive();
      objs.push(sub);
    }

    border.on("pointerover", () => { drawGrad(0.35); glow.setStrokeStyle(3 * scale, color, 0.55); title.setShadow(0, 0, colorHex, 16 * scale, false, true); });
    border.on("pointerout", () => { drawGrad(0.18); glow.setStrokeStyle(3 * scale, color, 0.25); title.setShadow(0, 1 * scale, colorHex, 8 * scale, false, true); });
    border.on("pointerup", onClick);

    return objs;
  }
}
