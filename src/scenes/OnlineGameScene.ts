import type { GameState } from "../types/game";
import { GameScene } from "./GameScene";
import { PeerConnection } from "../net/PeerConnection";
import type { GameMessage } from "../net/messages";
import { lerpState } from "../net/lerp";
import { stepPlayer } from "../physics/playerPhysics";
import { stepBall } from "../physics/ballPhysics";
import { resolvePlayerBallCollision, resolveStickTipCollision } from "../physics/collision";
import { updateShootCharge } from "../physics/shooting";

const SNAPSHOT_INTERVAL_MS = 1000 / 15; // 15 Hz

export class OnlineGameScene extends GameScene {
  private _peer!: PeerConnection;
  private _isHost = false;
  private _roomId = "";
  private _connected = false;
  private _snapshotTimer = 0;
  private _pingTimer = 0;
  private _pingMs = 0;
  private _inputSeq = 0;

  private _statusText!: Phaser.GameObjects.Text;
  private _pingText!: Phaser.GameObjects.Text;
  private _sharePanelObjects: Phaser.GameObjects.GameObject[] = [];
  private _debugInputText!: Phaser.GameObjects.Text;

  private _waitingBallGfx!: Phaser.GameObjects.Graphics;
  private _waitingBallQuat: [number, number, number, number] = [1, 0, 0, 0];

  private _onlineClientSlapWasDown = false;
  private _pendingWristShot = false;      // client → host: latched on key-down
  private _pendingClientWrist = false;    // host side: set when any input msg has wrist:true

  constructor() {
    super();
    this.sys.settings.key = "OnlineGameScene";
  }

  init(data: { mode: "online"; roomId: string; role: "host" | "client" }): void {
    super.init({ mode: "online" });
    this._isHost = data.role === "host";
    this._roomId = data.roomId;
    this._connected = false;
    this._snapshotTimer = 0;
    this._pingTimer = 0;
    this._inputSeq = 0;
    this._onlineClientSlapWasDown = false;
    this._pendingWristShot = false;
    this._pendingClientWrist = false;

    this._peer = new PeerConnection(data.role, data.roomId);
    this._peer.onMessage = (msg) => this._onNetMessage(msg);
    this._peer.onChannelOpen = () => {
      this._connected = true;
      this._sharePanelObjects.forEach(o => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false));
      this._statusText?.setText("");
      if (this._isHost) this._peer.send({ type: "start" });
    };
    this._peer.onReconnecting = () => {
      this._connected = false;
      this._statusText?.setText("Reconnecting…");
    };
    this._peer.onGiveUp = () => {
      this._connected = false;
      this._statusText?.setText("");
      this._buildDisconnectOverlay();
    };
    this._peer.onStateChange = (state) => {
      console.log("[OnlineGame] connectionState →", state);
    };

    if (this._isHost) {
      void this._peer.startAsHost();
    } else {
      void this._peer.startAsClient();
    }
  }

  create(): void {
    super.create();
    this.events.once("shutdown", this.shutdown, this);

    this._pingText = this.add
      .text(1270, 10, "", { fontSize: "13px", color: "#888888" })
      .setOrigin(1, 0)
      .setDepth(15);

    this._statusText = this.add
      .text(640, 30, "", { fontSize: "18px", color: "#ff8800", stroke: "#000", strokeThickness: 2 })
      .setOrigin(0.5, 0)
      .setDepth(15);

    this.add.text(640, 708,
      `Room: ${this._roomId} · ${this._isHost ? "Host (Green)" : "Client (Black)"}`, {
      fontSize: "13px", color: "#888888",
    })
      .setOrigin(0.5, 1)
      .setDepth(15);

    // Debug HUD: shows received client input on host (helps diagnose input sync)
    this._debugInputText = this.add
      .text(10, 50, "", { fontSize: "12px", color: "#ffff00" })
      .setDepth(20);

    this._buildSharePanel();

    // GameScene.create() binds Q→host and comma→client for local 2-player.
    // In online mode each machine controls only one player, so replace those
    // bindings with role-correct ones.
    this._wasd.wrist.removeAllListeners("down");
    this._arrows.wrist.removeAllListeners("down");

    if (this._isHost) {
      // Host controls the green player; comma key does nothing locally.
      this._wasd.wrist.on("down", () => this._doWristShot("host"));
    } else {
      // Client controls the black player; either Q or comma works.
      // Also latch _pendingWristShot so the host sees the rising edge even if
      // the key is pressed and released within a single fixed-step interval.
      this._wasd.wrist.on("down", () => { this._doWristShot("client"); this._pendingWristShot = true; });
      this._arrows.wrist.on("down", () => { this._doWristShot("client"); this._pendingWristShot = true; });
    }
  }

  update(time: number, delta: number): void {
    // Animate waiting ball even before connection is established
    if (this._waitingBallGfx?.visible) {
      const angle = 3 * (delta / 1000); // 3 rad/s rolling speed
      const halfAngle = angle / 2;
      // Rotate around X axis (rolls forward)
      const dw = Math.cos(halfAngle), dx = Math.sin(halfAngle);
      const [qw, qx, qy, qz] = this._waitingBallQuat;
      this._waitingBallQuat = [
        dw * qw - dx * qx,
        dw * qx + dx * qw,
        dw * qy + dx * qz,   // note: dy=0, dz=0 simplifies the full product
        dw * qz - dx * qy,
      ];
      const len = Math.hypot(...this._waitingBallQuat);
      this._waitingBallQuat = this._waitingBallQuat.map(v => v / len) as [number, number, number, number];

      const cx = 640, cy = 360;
      const ballX = cx + 158, ballY = cy - 120;
      this._waitingBallGfx.clear();
      this._waitingBallGfx.setPosition(ballX, ballY);
      this._drawBallAt(this._waitingBallGfx, 0, 0, 16, this._waitingBallQuat);
    }

    if (!this._connected) return;

    // Ping HUD
    this._pingTimer += delta;
    if (this._pingTimer >= 2000) {
      this._pingTimer = 0;
      this._peer.send({ type: "ping", t: performance.now() });
    }
    if (this._pingMs > 0) this._pingText.setText(`${this._pingMs} ms`);

    // Debug: show received client input on host's screen
    if (this._isHost) {
      const ci = this.client.input;
      this._debugInputText.setText(
        `P2 net input: ${ci.moveX.toFixed(1)},${ci.moveY.toFixed(1)} slap:${ci.slap}`
      );
    }

    super.update(time, delta);
  }

  /**
   * Override fixed step.
   * Host: authoritative physics + snapshot broadcast.
   * Client: local prediction for own player + send input.
   */
  protected override _fixedUpdate(dt: number): void {
    const elapsedMs = dt * 1000;
    this._elapsedMs += elapsedMs;

    if (this._isHost) {
      // Fire client wrist shot from the latch set in _onNetMessage.
      // Using a latch rather than rising-edge on client.input avoids missing
      // shots when two packets arrive between host fixed steps (wrist:true then
      // wrist:false — the second overwrites the first before we read it).
      if (this._pendingClientWrist) {
        this._pendingClientWrist = false;
        this._doWristShot("client");
      }

      // Call physics directly with explicit inputs — no override tricks, no super call.
      // this.client.input is updated from network messages in _onNetMessage.
      const hostInput = this._readHostInput();
      this._runPhysics(hostInput, this.client.input, dt, elapsedMs);

      this._snapshotTimer += elapsedMs;
      if (this._snapshotTimer >= SNAPSHOT_INTERVAL_MS) {
        this._snapshotTimer = 0;
        this._sendSnapshot();
      }
    } else {
      // Client: local prediction for own player + send input to host
      const input = this._readOnlineClientInput();
      if (input.moveX !== 0 || input.moveY !== 0) {
        this._clientAim = { x: input.moveX, y: input.moveY };
      }
      this._clientAimSmooth = this._lerpAim(this._clientAimSmooth, this._clientAim);
      stepPlayer(this.client, input, dt, elapsedMs);

      // Slap: check release BEFORE updating charge
      if (this._onlineClientSlapWasDown && !input.slap) {
        this._clientShoot.chargeMs = 0;
        this._clientShoot.charging = false;
      }
      this._onlineClientSlapWasDown = input.slap;
      updateShootCharge(this._clientShoot, input.slap, elapsedMs);

      // Local prediction: stick tip collision + possession (host is authoritative)
      const clientStick = this._stickDir(this.client, this._clientAimSmooth);
      resolvePlayerBallCollision(this.host, this.ball);
      resolvePlayerBallCollision(this.client, this.ball);
      resolveStickTipCollision(this.client, this.ball, clientStick.x, clientStick.y);
      this._clientHasPossession = this._applyStickPossession(this.client, clientStick, this._clientDribblePhase, this._clientShoot.charging);
      if (this._clientHasPossession) this._clientDribblePhase += dt * 2 * Math.PI * 4.5;
      stepBall(this.ball, dt);

      this._peer.send({ type: "input", seq: ++this._inputSeq, input });
    }
  }

  protected override _onGoal(scorer: "host" | "client"): void {
    super._onGoal(scorer);
    if (this._isHost) {
      this._peer.send({ type: "goal", scorer });
    }
  }

  private _readOnlineClientInput() {
    const w = this._wasd;
    const a = this._arrows;
    let mx = 0, my = 0;
    if (w.left.isDown || a.left.isDown) mx -= 1;
    if (w.right.isDown || a.right.isDown) mx += 1;
    if (w.up.isDown || a.up.isDown) my -= 1;
    if (w.down.isDown || a.down.isDown) my += 1;

    if (this._hostJoy.isActive()) {
      mx = this._hostJoy.value.x;
      my = this._hostJoy.value.y;
    }

    const touch = this._hostButtons.read();
    if (touch.wrist) { this._doWristShot("client"); this._pendingWristShot = true; }

    // Latch: wrist is true for exactly one input packet after the key/button
    // was pressed, regardless of how quickly it was released.
    const wrist = this._pendingWristShot;
    this._pendingWristShot = false;

    return {
      moveX: mx,
      moveY: my,
      wrist,
      slap: w.slap.isDown || a.slap.isDown || touch.slapHeld,
      dash: w.dash.isDown || a.dash.isDown || touch.dash,
    };
  }

  private _sendSnapshot(): void {
    const snapshot: GameState = {
      t: this._elapsedMs,
      ball: { ...this.ball },
      players: {
        host: {
          id: this.host.id, x: this.host.x, y: this.host.y,
          vx: this.host.vx, vy: this.host.vy, input: this.host.input,
        },
        client: {
          id: this.client.id, x: this.client.x, y: this.client.y,
          vx: this.client.vx, vy: this.client.vy, input: this.client.input,
        },
      },
      score: { ...this.score },
    };
    this._peer.send({ type: "state", snapshot });
  }

  private _onNetMessage(msg: GameMessage): void {
    switch (msg.type) {
      case "state": {
        if (!this._isHost) {
          const current: GameState = {
            t: this._elapsedMs,
            ball: this.ball,
            players: { host: this.host, client: this.client },
            score: this.score,
          };
          lerpState(current, msg.snapshot, 0.15);
        }
        break;
      }
      case "input": {
        if (this._isHost) {
          if (msg.input.wrist) this._pendingClientWrist = true;
          this.client.input = msg.input;
        }
        break;
      }
      case "goal": {
        if (!this._isHost) {
          this._onGoal(msg.scorer);
        }
        break;
      }
      case "start": {
        this._connected = true;
        this._sharePanelObjects.forEach(o => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false));
        this._statusText?.setText("");
        break;
      }
      case "ping": {
        this._peer.send({ type: "pong", t: msg.t });
        break;
      }
      case "pong": {
        this._pingMs = Math.round(performance.now() - msg.t);
        break;
      }
    }
  }

  /** Big centered panel shown on host while waiting for opponent. */
  private _buildSharePanel(): void {
    if (!this._isHost) return;

    const shareUrl = `${window.location.origin}${window.location.pathname}#${this._roomId}`;
    const cx = 640, cy = 360;

    const overlay = this.add.rectangle(cx, cy, 560, 340, 0x000000, 0.8).setDepth(18);

    const title = this.add.text(cx - 20, cy - 120, "Waiting for opponent…", {
      fontSize: "28px", color: "#ffffff", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(19);

    // Rolling ball loading icon
    this._waitingBallQuat = [1, 0, 0, 0];
    this._waitingBallGfx = this.add.graphics().setDepth(19);
    this._sharePanelObjects.push(this._waitingBallGfx);

    const roomLabel = this.add.text(cx, cy - 72, `Room code: ${this._roomId}`, {
      fontSize: "22px", color: "#aaaaff",
    }).setOrigin(0.5).setDepth(19);

    // Large share button — direct children on scene (no Container) so input works first tap
    const btnBg = this.add.rectangle(cx, cy, 440, 80, 0x1a44bb, 1)
      .setStrokeStyle(2, 0x6699ff, 1)
      .setInteractive({ useHandCursor: true })
      .setDepth(19);

    const btnLabel = this.add.text(cx, cy, "📤  Share link with friend", {
      fontSize: "22px", color: "#ffffff",
    }).setOrigin(0.5).setDepth(19);

    // Use pointerup (not pointerdown) — avoids first-tap-is-hover on mobile
    btnBg.on("pointerup", () => {
      if (navigator.share) {
        void navigator.share({ title: "Floorball Frenzy — join my game!", url: shareUrl })
          .then(() => btnLabel.setText("✓  Shared!"))
          .catch(() => { /* user cancelled */ });
      } else {
        // Prompt is the most reliable cross-browser fallback; user can copy from dialog
        window.prompt("Copy this link and send to your friend:", shareUrl);
      }
    });

    const hint = this.add.text(cx, cy + 70, "Or copy the URL from your address bar", {
      fontSize: "15px", color: "#556688",
    }).setOrigin(0.5).setDepth(19);

    this._sharePanelObjects = [overlay, title, roomLabel, btnBg, btnLabel, hint];
  }

  /** Full-screen overlay shown when reconnection gives up. */
  private _buildDisconnectOverlay(): void {
    const cx = 640, cy = 360;

    this.add.rectangle(cx, cy, 560, 280, 0x000000, 0.85).setDepth(25);

    this.add.text(cx, cy - 80, "Connection lost", {
      fontSize: "30px", color: "#ff6644", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(26);

    this.add.text(cx, cy - 38, "Could not reconnect to your opponent.", {
      fontSize: "18px", color: "#888888",
    }).setOrigin(0.5).setDepth(26);

    const btnBg = this.add
      .rectangle(cx, cy + 50, 320, 70, 0x1a44bb, 1)
      .setStrokeStyle(2, 0x6699ff, 1)
      .setInteractive({ useHandCursor: true })
      .setDepth(26);

    const btnLabel = this.add.text(cx, cy + 50, "← Back to Menu", {
      fontSize: "22px", color: "#ffffff", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(26);
    btnLabel.disableInteractive();

    btnBg.on("pointerover", () => btnBg.setFillStyle(0x2255cc, 1));
    btnBg.on("pointerout", () => btnBg.setFillStyle(0x1a44bb, 1));
    btnBg.on("pointerup", () => this.scene.start("MenuScene"));
  }

  shutdown(): void {
    history.replaceState(null, "", window.location.pathname);
    if (this._peer) {
      // Clear all callbacks before closing so async events (channel close,
      // reconnect timers) don't fire on already-destroyed scene objects.
      this._peer.onMessage = () => undefined;
      this._peer.onChannelOpen = () => undefined;
      this._peer.onReconnecting = () => undefined;
      this._peer.onGiveUp = () => undefined;
      this._peer.onStateChange = () => undefined;
      this._peer.close();
    }
  }
}
