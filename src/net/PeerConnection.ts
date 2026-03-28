import type { GameMessage, SignalMessage } from "./messages";
import { decodeMessage, encodeMessage } from "./messages";

export type Role = "host" | "client";

type OnMessageCb = (msg: GameMessage) => void;
type OnStateCb = (state: RTCPeerConnectionState) => void;

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const SIGNAL_POLL_MS = 500;
/** Max time to wait for ICE gathering to complete before sending SDP. */
const ICE_GATHER_TIMEOUT_MS = 5000;

export class PeerConnection {
  private _pc: RTCPeerConnection;
  private _channel: RTCDataChannel | null = null;
  private _role: Role;
  private _roomId: string;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  onMessage: OnMessageCb = () => undefined;
  onStateChange: OnStateCb = () => undefined;
  /** Fired when the data channel is open and ready to send. */
  onChannelOpen: () => void = () => undefined;

  constructor(role: Role, roomId: string) {
    this._role = role;
    this._roomId = roomId;

    this._pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this._pc.onconnectionstatechange = () => {
      this.onStateChange(this._pc.connectionState);
    };

    if (role === "host") {
      // Host creates the data channel
      this._channel = this._pc.createDataChannel("game", {
        ordered: false,
        maxRetransmits: 0, // UDP-like
      });
      this._setupChannel(this._channel);
    } else {
      // Client receives the channel
      this._pc.ondatachannel = (ev) => {
        this._channel = ev.channel;
        this._setupChannel(this._channel);
      };
    }
  }

  /**
   * Host: gather all ICE candidates first, then send the complete offer.
   * Using non-trickle ICE so the signaling relay only needs to store one
   * message per direction (offer → client, answer → host).
   */
  async startAsHost(): Promise<void> {
    const offer = await this._pc.createOffer();
    const iceComplete = this._waitForICE();
    await this._pc.setLocalDescription(offer);
    const finalDesc = await iceComplete;
    await this._signal({ type: "offer", sdp: finalDesc.sdp!, roomId: this._roomId });
    this._startPolling();
  }

  /** Client: start polling for the host's offer. */
  async startAsClient(): Promise<void> {
    this._startPolling();
  }

  send(msg: GameMessage): void {
    if (this._channel?.readyState === "open") {
      this._channel.send(encodeMessage(msg));
    }
  }

  close(): void {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._channel?.close();
    this._pc.close();
  }

  get connectionState(): RTCPeerConnectionState {
    return this._pc.connectionState;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _setupChannel(ch: RTCDataChannel): void {
    ch.onopen = () => this.onChannelOpen();
    ch.onmessage = (ev: MessageEvent<string>) => {
      const msg = decodeMessage(ev.data);
      if (msg) this.onMessage(msg);
    };
  }

  private _startPolling(): void {
    this._pollTimer = setInterval(() => void this._poll(), SIGNAL_POLL_MS);
  }

  private async _poll(): Promise<void> {
    try {
      const res = await fetch(
        `/api/signal?room=${encodeURIComponent(this._roomId)}&role=${this._role}`
      );
      const msg: unknown = await res.json();
      if (!msg) return;
      await this._handleSignal(msg as SignalMessage);
    } catch {
      // network error — keep polling
    }
  }

  private async _handleSignal(msg: SignalMessage): Promise<void> {
    if (msg.type === "offer" && this._role === "client") {
      await this._pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
      const answer = await this._pc.createAnswer();
      const iceComplete = this._waitForICE();
      await this._pc.setLocalDescription(answer);
      const finalDesc = await iceComplete;
      await this._signal({ type: "answer", sdp: finalDesc.sdp!, roomId: this._roomId });
    } else if (msg.type === "answer" && this._role === "host") {
      await this._pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
    }
    // "ice" messages are no longer sent (non-trickle mode), but handled gracefully if received
  }

  private async _signal(msg: SignalMessage): Promise<void> {
    try {
      await fetch("/api/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: this._roomId, role: this._role, msg }),
      });
    } catch {
      // signaling failure — connection won't establish
    }
  }

  /**
   * Returns a promise that resolves with the final local description once
   * ICE gathering is complete, or after ICE_GATHER_TIMEOUT_MS (takes what we have).
   * Must be called before setLocalDescription so the handler is wired up in time.
   */
  private _waitForICE(): Promise<RTCSessionDescriptionInit> {
    return new Promise((resolve) => {
      const done = (): void => resolve(this._pc.localDescription!);
      const t = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
      const check = (): void => {
        if (this._pc.iceGatheringState === "complete") {
          clearTimeout(t);
          done();
        }
      };
      this._pc.onicegatheringstatechange = check;
      check(); // in case gathering already completed
    });
  }
}
