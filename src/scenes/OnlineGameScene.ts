import type { GameState } from "../types/game";
import { GameScene } from "./GameScene";
import { PeerConnection } from "../net/PeerConnection";
import type { GameMessage } from "../net/messages";
import type { InputState } from "../types/game";
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
  private _onlineClientSlapWasDown = false;
  private _clientWristWasDown = false;

  constructor() {
    super();
    // Override the scene key registered by the parent
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
    this._clientWristWasDown = false;

    this._peer = new PeerConnection(data.role, data.roomId);
    this._peer.onMessage = (msg) => this._onNetMessage(msg);
    // Fire when the data channel is actually open (safe to send)
    this._peer.onChannelOpen = () => {
      this._connected = true;
      this._statusText?.setText("");
      if (this._isHost) this._peer.send({ type: "start" });
    };
    this._peer.onStateChange = (state) => {
      console.log("[OnlineGame] connectionState →", state);
      if (state === "connecting" || state === "new") {
        this._statusText?.setText(`Connecting… (${state})`);
      } else if (state === "failed" || state === "disconnected" || state === "closed") {
        this._statusText?.setText(`Connection ${state} — press ESC`);
      }
    };

    if (this._isHost) {
      void this._peer.startAsHost();
    } else {
      void this._peer.startAsClient();
    }
  }

  create(): void {
    super.create();

    this._statusText = this.add
      .text(640, 350, "Connecting…", {
        fontSize: "32px", color: "#ffff00", stroke: "#000", strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(15);

    this._pingText = this.add
      .text(1270, 10, "", { fontSize: "13px", color: "#888888" })
      .setOrigin(1, 0)
      .setDepth(15);

    this.add.text(640, 708,
      `Room: ${this._roomId} · ${this._isHost ? "Host (Blue)" : "Client (Red)"}`, {
        fontSize: "13px", color: "#888888",
      })
      .setOrigin(0.5, 1);

    if (this._isHost) {
      const shareUrl = `${window.location.origin}${window.location.pathname}#${this._roomId}`;
      const shareBtn = this.add
        .text(640, 692,
          "⬡  Tap to share link with opponent",
          { fontSize: "15px", color: "#4488ff", stroke: "#000", strokeThickness: 2 }
        )
        .setOrigin(0.5, 1)
        .setDepth(15)
        .setInteractive({ useHandCursor: true });

      shareBtn.on("pointerover", () => shareBtn.setAlpha(0.75));
      shareBtn.on("pointerout",  () => shareBtn.setAlpha(1));
      shareBtn.on("pointerdown", () => {
        if (navigator.share) {
          void navigator.share({ title: "Floorball Frenzy — join my game!", url: shareUrl });
        } else {
          void navigator.clipboard.writeText(shareUrl).then(() => {
            shareBtn.setText("✓  Link copied!");
            this.time.delayedCall(2000, () => shareBtn.setText("⬡  Tap to share link with opponent"));
          });
        }
      });
    }
  }

  update(time: number, delta: number): void {
    if (!this._connected) return;

    // Ping HUD
    this._pingTimer += delta;
    if (this._pingTimer >= 2000) {
      this._pingTimer = 0;
      const t = performance.now();
      this._peer.send({ type: "ping", t });
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
      // Detect wrist-shot rising edge from client network input before super runs physics
      const clientWristFired = this.client.input.wrist && !this._clientWristWasDown;
      this._clientWristWasDown = this.client.input.wrist;
      if (clientWristFired) this._doWristShot("client");

      // Full authoritative sim — _readClientInput() is overridden to return
      // this.client.input (the latest network input), so slap/move/dash all work.
      this._elapsedMs -= elapsedMs; // undo our increment; super will add it back
      super._fixedUpdate(dt);

      this._snapshotTimer += elapsedMs;
      if (this._snapshotTimer >= SNAPSHOT_INTERVAL_MS) {
        this._snapshotTimer = 0;
        this._sendSnapshot();
      }
    } else {
      // Client: local physics prediction for own player + send input to host
      const input = this._readOnlineClientInput();
      if (input.moveX !== 0 || input.moveY !== 0) {
        this._clientAim = { x: input.moveX, y: input.moveY };
      }
      stepPlayer(this.client, input, dt, elapsedMs);

      // Slap: check release BEFORE updating charge so chargeMs is still populated
      if (this._onlineClientSlapWasDown && !input.slap) {
        this._clientShoot.chargeMs = 0;
        this._clientShoot.charging = false;
      }
      this._onlineClientSlapWasDown = input.slap;
      updateShootCharge(this._clientShoot, input.slap, elapsedMs);

      // Local prediction: stick tip and possession (visual only — host is authoritative)
      const clientStick = this._stickDir(this.client, this._clientAim);
      resolvePlayerBallCollision(this.host, this.ball);
      resolvePlayerBallCollision(this.client, this.ball);
      resolveStickTipCollision(this.client, this.ball, clientStick.x, clientStick.y);
      stepBall(this.ball, dt);

      // Send input to host (host is authoritative for all ball physics)
      this._peer.send({ type: "input", seq: ++this._inputSeq, input });
    }
  }

  /**
   * When running as host, return the latest received client input instead of
   * reading local keyboard — the keyboard is only for the host player online.
   */
  protected override _readClientInput(): InputState {
    if (this._isHost) return this.client.input;
    return super._readClientInput();
  }

  /**
   * Reads input for the client player on their own device.
   * Accepts WASD, arrow keys, virtual joystick, and action buttons.
   */
  private _readOnlineClientInput() {
    const w = this._wasd;
    const a = this._arrows;
    let mx = 0, my = 0;
    if (w.left.isDown  || a.left.isDown)  mx -= 1;
    if (w.right.isDown || a.right.isDown) mx += 1;
    if (w.up.isDown    || a.up.isDown)    my -= 1;
    if (w.down.isDown  || a.down.isDown)  my += 1;

    if (this._hostJoy.isActive()) {
      mx = this._hostJoy.value.x;
      my = this._hostJoy.value.y;
    }

    const touch = this._hostButtons.read();
    if (touch.wrist) this._doWristShot("client");

    return {
      moveX: mx,
      moveY: my,
      wrist: w.wrist.isDown || a.wrist.isDown,
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
          lerpState(current, msg.snapshot, 0.25);
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
          this.score[msg.scorer]++;
          this._messageText.setText(
            `${msg.scorer === "host" ? "Blue" : "Red"} scores!  ${this.score.host} — ${this.score.client}`
          );
          this._frozenMs = 1500;
        }
        break;
      }
      case "start": {
        this._connected = true;
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

  shutdown(): void {
    // Clear the room hash so returning to menu doesn't auto-rejoin
    history.replaceState(null, "", window.location.pathname);
    this._peer?.close();
  }
}
