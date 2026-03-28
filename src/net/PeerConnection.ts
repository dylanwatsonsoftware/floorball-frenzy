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

export class PeerConnection {
  private _pc: RTCPeerConnection;
  private _channel: RTCDataChannel | null = null;
  private _role: Role;
  private _roomId: string;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  onMessage: OnMessageCb = () => undefined;
  onStateChange: OnStateCb = () => undefined;

  constructor(role: Role, roomId: string) {
    this._role = role;
    this._roomId = roomId;

    this._pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this._pc.onconnectionstatechange = () => {
      this.onStateChange(this._pc.connectionState);
    };

    this._pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      this._signal({ type: "ice", candidate: ev.candidate.toJSON(), roomId: this._roomId });
    };

    if (role === "host") {
      // Host creates the data channel
      this._channel = this._pc.createDataChannel("game", {
        ordered: false,
        maxRetransmits: 0, // UDP-like
      });
      this._setupChannel(this._channel);
    } else {
      // Client receives it
      this._pc.ondatachannel = (ev) => {
        this._channel = ev.channel;
        this._setupChannel(this._channel);
      };
    }
  }

  /** Host calls this to create an offer and begin signaling. */
  async startAsHost(): Promise<void> {
    const offer = await this._pc.createOffer();
    await this._pc.setLocalDescription(offer);
    await this._signal({
      type: "offer",
      sdp: offer.sdp!,
      roomId: this._roomId,
    });
    this._startPolling();
  }

  /** Client calls this to pick up the offer and send an answer. */
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
      await this._pc.setLocalDescription(answer);
      await this._signal({ type: "answer", sdp: answer.sdp!, roomId: this._roomId });
    } else if (msg.type === "answer" && this._role === "host") {
      await this._pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
    } else if (msg.type === "ice") {
      await this._pc.addIceCandidate(msg.candidate);
    }
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
}
