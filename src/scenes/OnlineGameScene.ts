import type { GameState } from "../types/game";
import { GameScene } from "./GameScene";
import { PeerConnection } from "../net/PeerConnection";
import type { GameMessage } from "../net/messages";
import { lerpState } from "../net/lerp";
import { stepPlayer } from "../physics/playerPhysics";
import { stepBall } from "../physics/ballPhysics";
import { resolvePlayerBallCollision } from "../physics/collision";

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

    this._peer = new PeerConnection(data.role, data.roomId);
    this._peer.onMessage = (msg) => this._onNetMessage(msg);
    // Fire when the data channel is actually open (safe to send)
    this._peer.onChannelOpen = () => {
      this._connected = true;
      this._statusText?.setText("");
      if (this._isHost) this._peer.send({ type: "start" });
    };
    this._peer.onStateChange = (state) => {
      if (state === "failed" || state === "disconnected" || state === "closed") {
        this._statusText?.setText("Connection lost — press ESC");
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

    this.add.text(640, 710,
      `Room: ${this._roomId} · ${this._isHost ? "Host (Blue)" : "Client (Red)"}`, {
        fontSize: "13px", color: "#888888",
      })
      .setOrigin(0.5, 1);
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
      // Full authoritative sim (same as local) — but super._fixedUpdate also
      // increments _elapsedMs, so we skip the super call and inline the logic
      // by calling super's helpers through a fresh invocation.
      // Simpler: just let super run (it will double-increment _elapsedMs,
      // so we subtract the extra here).
      this._elapsedMs -= elapsedMs; // undo our increment above; super will add it
      super._fixedUpdate(dt);

      this._snapshotTimer += elapsedMs;
      if (this._snapshotTimer >= SNAPSHOT_INTERVAL_MS) {
        this._snapshotTimer = 0;
        this._sendSnapshot();
      }
    } else {
      // Client: local physics for own (client) player only
      const input = this._readClientInput();
      if (input.moveX !== 0 || input.moveY !== 0) {
        this._clientAim = { x: input.moveX, y: input.moveY };
      }
      stepPlayer(this.client, input, dt, elapsedMs);
      resolvePlayerBallCollision(this.host, this.ball);
      resolvePlayerBallCollision(this.client, this.ball);
      stepBall(this.ball, dt);

      // Send input to host
      this._peer.send({ type: "input", seq: ++this._inputSeq, input });
    }
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
    this._peer?.close();
  }
}
