import LogRocket from "logrocket";
import { type GameState, type Player, NEUTRAL_INPUT } from "../types/game";
import { GameScene } from "./GameScene";
import { PeerConnection } from "../net/PeerConnection";
import type { GameMessage } from "../net/messages";
import {
  GOAL_LINE_LEFT,
  GOAL_LINE_RIGHT,
  GOAL_TOP,
  GOAL_BOTTOM
} from "../physics/constants";

const SNAPSHOT_INTERVAL_MS = 1000 / 60; // 60 Hz

interface BufferedSnapshot {
  t: number;      // host's elapsedMs
  arrival: number; // client's performance.now()
  state: GameState;
}

export class OnlineGameScene extends GameScene {
  private _peer!: PeerConnection;
  private _isHost = false;
  private _snapshotBuffer: BufferedSnapshot[] = [];
  private static readonly INTERP_DELAY_MS = 60; // 3.6 frames at 60Hz
  private _roomId = "";
  private _connected = false;
  private _opponentInTutorial = false;
  private _snapshotTimer = 0;
  private _pingTimer = 0;
  private _pingMs = 0;
  private _inputSeq = 0;
  private _startSignalTimer: Phaser.Time.TimerEvent | null = null;

  private _statusText!: Phaser.GameObjects.Text;
  private _pingText!: Phaser.GameObjects.Text;
  private _sharePanelObjects: Phaser.GameObjects.GameObject[] = [];

  private _waitingBallGfx!: Phaser.GameObjects.Graphics;
  private _waitingBallQuat: [number, number, number, number] = [1, 0, 0, 0];
  private _waitingTitleText: Phaser.GameObjects.Text | null = null;
  private _waitingSubText: Phaser.GameObjects.Text | null = null;
  private _connectTimeoutTimer: Phaser.Time.TimerEvent | null = null;

  private _countdownMs = 0;
  private _startedCountdown = false;
  private _countdownText!: Phaser.GameObjects.Text;
  private _lastCountdownLabel = "";

  private _rematchRequested = false;
  private _opponentRequestedRematch = false;

  protected override get _isAuthoritative(): boolean {
    return this._isHost;
  }

  constructor() {
    super();
    this.sys.settings.key = "OnlineGameScene";
  }

  init(data: { mode: "online"; roomId: string; role: "host" | "client" }): void {
    super.init({ mode: "online" });
    this._isHost = data.role === "host";
    this._snapshotBuffer = [];
    this._roomId = data.roomId;
    this._connected = false;
    this._opponentInTutorial = false;
    this._snapshotTimer = 0;
    this._pingTimer = 0;
    this._inputSeq = 0;
    this._startedCountdown = false;

    this._hostAim = { x: 1, y: 0 };
    this._clientAim = { x: -1, y: 0 };
    this._hostAimSmooth = { x: 1, y: 0 };
    this._clientAimSmooth = { x: -1, y: 0 };
    this._hostShoot = { chargeMs: 0, charging: false };

    this._hostDribblePhase = 0;
    this._clientDribblePhase = 0;
    this._hostHasPossession = false;
    this._clientHasPossession = false;

    this._peer = new PeerConnection(data.role, data.roomId);
    this._peer.onMessage = (msg) => this._onNetMessage(msg);
    this._peer.onChannelOpen = () => {
      if (this._connected) return;
      this._connected = true;
      if (this._connectTimeoutTimer) { this._connectTimeoutTimer.destroy(); this._connectTimeoutTimer = null; }
      this._sharePanelObjects.forEach(o => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false));
      this._statusText?.setText("");
      if (this._isHost) {
        this._playDing();
        if (this._opponentInTutorial) {
          this._statusText?.setText("Opponent in tutorial…");
        }
        // Send start signal multiple times to ensure it gets through the unreliable channel
        this._peer.send({ type: "start" });
        this._startSignalTimer = this.time.addEvent({
          delay: 500,
          repeat: 5,
          callback: () => {
            if (this._connected) this._peer.send({ type: "start" });
          },
        });
        this._startedCountdown = true;
        this._startCountdown();
      }
    };
    this._peer.onAnswerReceived = () => {
      if (this._waitingTitleText) this._waitingTitleText.setText("Connecting to opponent…");
      // Start a timeout — if ICE hasn't connected after 12s, flag likely TURN issue
      this._connectTimeoutTimer = this.time.delayedCall(12000, () => {
        if (!this._connected && this._waitingSubText) {
          this._waitingSubText.setText("Taking longer than expected…\nCheck your network connection.");
        }
      });
    };
    this._peer.onIceStateChange = (state) => {
      if (this._connected) return;
      const labels: Partial<Record<RTCIceConnectionState, string>> = {
        checking: "Checking connection…",
        connected: "Almost there…",
        completed: "Almost there…",
        failed: "Connection failed — retrying…",
        disconnected: "Connection lost — retrying…",
      };
      if (labels[state] && this._waitingTitleText) {
        this._waitingTitleText.setText(labels[state]!);
      }
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

    if (this._isHost) {
      const gameName = localStorage.getItem("floorball:gameName") || this._roomId;
      LogRocket.identify(`host-${this._roomId}`, { name: gameName, role: "host" });
      LogRocket.track("game_created", { gameName, roomId: this._roomId });
    } else {
      LogRocket.identify(`client-${this._roomId}`, { name: `Guest · ${this._roomId}`, role: "client" });
      LogRocket.track("game_joined", { roomId: this._roomId });
    }

    this._pingText = this.add
      .text(1270, 10, "", { fontSize: "13px", color: "#888888" })
      .setOrigin(1, 0)
      .setDepth(15);

    this._statusText = this.add
      .text(640, 30, "", { fontSize: "18px", color: "#ff8800", stroke: "#000", strokeThickness: 2 })
      .setOrigin(0.5, 0)
      .setDepth(35); // Above match-over overlay (30)

    this.add.text(640, 708,
      `Room: ${this._roomId} · ${this._isHost ? "Host (Red)" : "Client (Blue)"}`, {
      fontSize: "13px", color: "#888888",
    })
      .setOrigin(0.5, 1)
      .setDepth(15);

    this._countdownText = this.add
      .text(640, 360, "", {
        fontSize: "120px",
        color: "#ffffff",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(22)
      .setVisible(false);

    this._buildSharePanel();

    if (!localStorage.getItem("floorball:tutorialDone")) {
      if (!this._isHost) this._peer.send({ type: "tutorial", status: "start" });
      this.scene.pause();
      this.scene.launch("TutorialScene", {
        team: this._isHost ? "host" : "client",
        onComplete: () => {
          localStorage.setItem("floorball:tutorialDone", "true");
          if (!this._isHost) this._peer.send({ type: "tutorial", status: "end" });
          this.scene.resume();
        }
      });
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
        dw * qy + dx * qz,
        dw * qz - dx * qy,
      ];
      const len = Math.hypot(...this._waitingBallQuat);
      this._waitingBallQuat = this._waitingBallQuat.map(v => v / len) as [number, number, number, number];

      const ballX = this._isHost ? 640 + 155 : 640;
      const ballY = this._isHost ? 360 - 120 : 360;
      this._waitingBallGfx.clear();
      this._waitingBallGfx.setPosition(ballX, ballY);
      this._drawBallAt(this._waitingBallGfx, 0, 0, 16, this._waitingBallQuat);
    }

    if (!this._connected) return;

    // 3-2-1 countdown after peer connects — physics is frozen during this time
    if (this._countdownMs > 0) {
      this._countdownMs -= delta;
      const label = this._countdownMs > 3000 ? "3"
        : this._countdownMs > 2000 ? "2"
          : this._countdownMs > 1000 ? "1" : "GO!";
      if (label !== this._lastCountdownLabel) {
        this._lastCountdownLabel = label;
        this._playCountdownBeep(label);
      }
      this._countdownText.setText(label).setVisible(true);
      if (this._countdownMs <= 0) {
        this._countdownText.setVisible(false);
      }
      return; // freeze physics during countdown
    }

    // Ping HUD
    this._pingTimer += delta;
    if (this._pingTimer >= 2000) {
      this._pingTimer = 0;
      this._peer.send({ type: "ping", t: performance.now() });
    }
    if (this._pingMs > 0) this._pingText.setText(`${this._pingMs} ms`);


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
      const hostInput = this._readHostInput();
      const clientInput = this.client.input || NEUTRAL_INPUT;
      this._runPhysics(hostInput, clientInput, dt, elapsedMs);
      this._snapshotTimer += elapsedMs;
      if (this._snapshotTimer >= SNAPSHOT_INTERVAL_MS) {
        this._snapshotTimer = 0;
        this._sendSnapshot();
      }
    } else {
      const clientInput = this._readOnlineClientInput();
      // Client prediction for own movement (client player)
      const hostInputPredict = this.host.input || NEUTRAL_INPUT;
      this._runPhysics(hostInputPredict, clientInput, dt, elapsedMs, true);
      this._peer.send({ type: "input", seq: ++this._inputSeq, input: clientInput });

      // Entity Interpolation for others (host player and ball)
      this._applyInterpolation();
    }
  }

  private _applyInterpolation(): void {
    if (this._snapshotBuffer.length < 2) return;

    // Use a fixed delay behind the latest arrival to smooth over jitter
    const renderTime = performance.now() - OnlineGameScene.INTERP_DELAY_MS;

    // Find two snapshots that bracket renderTime
    let i = 0;
    for (; i < this._snapshotBuffer.length - 2; i++) {
      if (this._snapshotBuffer[i + 1].arrival > renderTime) break;
    }

    const s0 = this._snapshotBuffer[i];
    const s1 = this._snapshotBuffer[i + 1];

    let f = (renderTime - s0.arrival) / (s1.arrival - s0.arrival);
    f = Math.max(0, Math.min(1, f));

    const lerp = (a: number, b: number) => a + (b - a) * f;

    // Interpolate Host Player (Opponent)
    this.host.x = lerp(s0.state.players.host.x, s1.state.players.host.x);
    this.host.y = lerp(s0.state.players.host.y, s1.state.players.host.y);
    this.host.vx = lerp(s0.state.players.host.vx, s1.state.players.host.vx);
    this.host.vy = lerp(s0.state.players.host.vy, s1.state.players.host.vy);
    this.host.aimX = lerp(s0.state.players.host.aimX, s1.state.players.host.aimX);
    this.host.aimY = lerp(s0.state.players.host.aimY, s1.state.players.host.aimY);
    this.host.dashCooldownMs = s1.state.players.host.dashCooldownMs;
    this.host.chargeMs = s1.state.players.host.chargeMs;
    this.host.input = { ...s1.state.players.host.input };

    this._hostAim = { x: this.host.aimX, y: this.host.aimY };
    this._hostShoot.chargeMs = this.host.chargeMs;
    this._hostShoot.charging = this.host.input.slap;

    // Interpolate Ball
    this.ball.x = lerp(s0.state.ball.x, s1.state.ball.x);
    this.ball.y = lerp(s0.state.ball.y, s1.state.ball.y);
    this.ball.z = lerp(s0.state.ball.z, s1.state.ball.z);
    this.ball.vx = lerp(s0.state.ball.vx, s1.state.ball.vx);
    this.ball.vy = lerp(s0.state.ball.vy, s1.state.ball.vy);
    this.ball.vz = lerp(s0.state.ball.vz, s1.state.ball.vz);
    this.ball.isPerfect = s1.state.ball.isPerfect;
    this.ball.isBolt = s1.state.ball.isBolt;
    this.ball.boltTimerMs = s1.state.ball.boltTimerMs;
    this.ball.possessedBy = s1.state.ball.possessedBy;

    // Correct possession flags
    this._hostHasPossession = (this.ball.possessedBy === "host");
    this._clientHasPossession = (this.ball.possessedBy === "client");

    // Sync scores
    this.score.host = s1.state.score.host;
    this.score.client = s1.state.score.client;

    // Soft reconciliation for local player (the client)
    // Use the newest available authoritative state for reconciliation
    const newest = this._snapshotBuffer[this._snapshotBuffer.length - 1];
    this._reconcileLocalPlayer(newest.state.players.client);
  }

  private _reconcileLocalPlayer(authoritative: Player): void {
    // Distance between predicted and authoritative position
    const dx = authoritative.x - this.client.x;
    const dy = authoritative.y - this.client.y;
    const distSq = dx * dx + dy * dy;

    if (distSq > 40 * 40) {
      // Large error: Hard snap
      this.client.x = authoritative.x;
      this.client.y = authoritative.y;
    } else if (distSq > 2 * 2) {
      // Medium error: Soft lerp correction (10% per frame)
      this.client.x += dx * 0.1;
      this.client.y += dy * 0.1;
    }
    // Small error (<2px): Ignore to keep movement feeling responsive
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

    if (this._controlMode === "follow") {
      // Follow-touch steering: move toward pointer if active and not over a button
      const pts = [this.input.pointer1, this.input.pointer2, this.input.pointer3];
      const localPlayer = this._isHost ? this.host : this.client;
      for (const pointer of pts) {
        if (pointer.isDown && !this._hostButtons.contains(pointer.worldX, pointer.worldY)) {
          const dx = pointer.worldX - localPlayer.x;
          const dy = pointer.worldY - localPlayer.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 15) {
            mx = dx / dist;
            my = dy / dist;
          } else {
            mx = 0;
            my = 0;
          }
          break;
        }
      }
    } else {
      // Virtual joystick steering
      if (this._hostJoy.isActive()) {
        mx = this._hostJoy.value.x;
        my = this._hostJoy.value.y;
      }
    }

    const touch = this._hostButtons.read();

    return {
      moveX: mx,
      moveY: my,
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
          vx: this.host.vx, vy: this.host.vy,
          aimX: this.host.aimX, aimY: this.host.aimY,
          dashCooldownMs: this.host.dashCooldownMs,
          dashCharges: this.host.dashCharges,
          chargeMs: this.host.chargeMs,
          input: this.host.input,
        },
        client: {
          id: this.client.id, x: this.client.x, y: this.client.y,
          vx: this.client.vx, vy: this.client.vy,
          aimX: this.client.aimX, aimY: this.client.aimY,
          dashCooldownMs: this.client.dashCooldownMs,
          dashCharges: this.client.dashCharges,
          chargeMs: this.client.chargeMs,
          input: this.client.input,
        },
      },
      score: { ...this.score },
    };
    this._peer.send({ type: "state", snapshot });
  }

  private _onNetMessage(msg: GameMessage): void {
    switch (msg.type) {
      case "start": {
        if (this._startedCountdown && !this._matchOverObjects.length) return;
        this._startedCountdown = true;
        this._connected = true;
        this._snapshotBuffer = [];
        this._sharePanelObjects.forEach(o => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false));
        this._statusText?.setText("");
        this._clearMatchOver();
        this._resetMatch();
        this._startCountdown();
        this._rematchRequested = false;
        this._opponentRequestedRematch = false;
        break;
      }
      case "state": {
        if (!this._isHost) {
          const last = this._snapshotBuffer[this._snapshotBuffer.length - 1];
          if (last && msg.snapshot.t <= last.t) {
            return; // Drop out-of-order or duplicate state
          }

          this._snapshotBuffer.push({
            t: msg.snapshot.t,
            arrival: performance.now(),
            state: msg.snapshot
          });
          // Keep buffer small
          if (this._snapshotBuffer.length > 30) {
            this._snapshotBuffer.shift();
          }
        }
        break;
      }
      case "input": {
        if (this._isHost) {
          this.client.input = msg.input;
        }
        break;
      }
      case "goal": {
        if (!this._isHost) {
          // Snap ball to center of goal mouth for better visual transition on prediction error
          const mouthX = msg.scorer === "host" ? GOAL_LINE_RIGHT : GOAL_LINE_LEFT;
          this.ball.x = mouthX;
          this.ball.y = (GOAL_TOP + GOAL_BOTTOM) / 2;
          this.ball.z = 0;
          this.ball.vx = 0;
          this.ball.vy = 0;
          this.ball.vz = 0;
          this._onGoal(msg.scorer);
        }
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
      case "rematch": {
        this._opponentRequestedRematch = true;
        this._playDing();
        if (this._rematchBtn && !this._rematchRequested) {
          this._statusText.setText("Opponent wants a rematch!");
          this._rematchBtnText?.setText("ACCEPT REMATCH");
        }
        if (this._isHost && this._rematchRequested) {
          // Host sends start signal
          this._peer.send({ type: "start" });
          this._startCountdown();
        }
        break;
      }
      case "tutorial": {
        if (this._isHost) {
          if (msg.status === "start") {
            this._opponentInTutorial = true;
            if (this._connected) {
              this._statusText?.setText("Opponent in tutorial…");
            }
          } else {
            this._opponentInTutorial = false;
            if (this._connected) {
              this._statusText?.setText("Starting game…");
              this._startCountdown();
            }
          }
        }
        break;
      }
    }
  }

  /** Big centered panel shown while waiting to connect. Host sees share UI; client sees connecting UI. */
  private _buildSharePanel(): void {
    const cx = 640, cy = 360;

    this._waitingBallQuat = [1, 0, 0, 0];
    this._waitingBallGfx = this.add.graphics().setDepth(19);

    if (!this._isHost) {
      const overlay = this.add.rectangle(cx, cy, 520, 260, 0x000000, 0.8).setDepth(18);
      const title = this.add.text(cx, cy - 70, "Connecting…", {
        fontSize: "28px", color: "#ffffff", fontStyle: "bold",
      }).setOrigin(0.5).setDepth(19);
      const sub = this.add.text(cx, cy + 60, "Getting you into the game", {
        fontSize: "16px", color: "#556688", align: "center",
      }).setOrigin(0.5).setDepth(19);
      this._waitingTitleText = title;
      this._waitingSubText = sub;
      this._sharePanelObjects = [overlay, title, sub, this._waitingBallGfx];
      return;
    }

    const shareUrl = `${window.location.origin}${window.location.pathname}#${this._roomId}`;

    const overlay = this.add.rectangle(cx, cy, 560, 340, 0x000000, 0.8).setDepth(18);

    const title = this.add.text(cx - 30, cy - 120, "Waiting for opponent", {
      fontSize: "24px", color: "#ffffff", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(19);
    this._waitingTitleText = title;

    const gameName = localStorage.getItem("floorball:gameName") || this._roomId;
    const roomLabel = this.add.text(cx, cy - 72, gameName, {
      fontSize: "26px", color: "#aaaaff", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(19);

    this._sharePanelObjects = [overlay, title, roomLabel, this._waitingBallGfx];

    // Lazy-load QR code from external API
    const qrKey = `qr-${this._roomId}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(shareUrl)}`;

    this.load.image(qrKey, qrUrl);
    this.load.once(`filecomplete-image-${qrKey}`, () => {
      if (!this.scene.isActive("OnlineGameScene")) return;
      const qrSprite = this.add.sprite(cx, cy + 45, qrKey).setDepth(19);
      this._sharePanelObjects.push(qrSprite);
      // If we already connected while loading, hide it immediately
      if (this._connected) qrSprite.setVisible(false);
    });
    this.load.start();
  }

  private _playCountdownBeep(label: string): void {
    try {
      const ctx = (this.game.sound as any).context;
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      const isGo = label === "GO!";
      osc.frequency.value = isGo ? 1046 : 440; // C6 for GO!, A4 for numbers
      gain.gain.setValueAtTime(isGo ? 0.4 : 0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (isGo ? 0.8 : 0.15));
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + (isGo ? 0.8 : 0.15));
    } catch { /* audio not available */ }
  }

  private _playDing(): void {
    try {
      const ctx = (this.game.sound as any).context;
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(1046, ctx.currentTime);       // C6
      osc.frequency.setValueAtTime(1318, ctx.currentTime + 0.1); // E6
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 1.2);
    } catch { /* audio not available */ }
  }

  private _startCountdown(): void {
    if (this._isHost && this._opponentInTutorial) return;
    this._snapshotBuffer = [];
    this._resetRound();
    this._countdownMs = 4000; // 3…2…1… then GO! for 1s
    this._lastCountdownLabel = "";
    this._countdownText.setVisible(true);
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
      .rectangle(cx, cy + 50, 320, 70, 0x2a55d4, 1)
      .setStrokeStyle(2, 0x6699ff, 1)
      .setInteractive({ useHandCursor: true })
      .setDepth(26);

    const btnLabel = this.add.text(cx, cy + 50, "← Back to Menu", {
      fontSize: "22px", color: "#ffffff", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(26);
    btnLabel.disableInteractive();

    btnBg.on("pointerover", () => btnBg.setFillStyle(0x3a66e5, 1));
    btnBg.on("pointerout", () => btnBg.setFillStyle(0x2a55d4, 1));
    btnBg.on("pointerup", () => this.scene.start("MenuScene"));
  }

  protected override _showMatchOver(winner: "host" | "client"): void {
    super._showMatchOver(winner);

    if (this._opponentRequestedRematch && this._rematchBtnText) {
      this._statusText.setText("Opponent wants a rematch!");
      this._rematchBtnText.setText("ACCEPT REMATCH");
    }
  }

  protected override _handleRematchClick(btn: Phaser.GameObjects.Rectangle, text: Phaser.GameObjects.Text): void {
    text.setText("WAITING...");
    btn.disableInteractive();
    btn.setAlpha(0.6);
    this._rematchRequested = true;
    this._statusText.setText("");
    this._peer.send({ type: "rematch" });

    if (this._isHost && this._opponentRequestedRematch) {
      // Both ready - host triggers start
      this._peer.send({ type: "start" });
      this._startCountdown();
    }
  }

  shutdown(): void {
    history.replaceState(null, "", window.location.pathname);
    if (this._startSignalTimer) { this._startSignalTimer.destroy(); this._startSignalTimer = null; }
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
