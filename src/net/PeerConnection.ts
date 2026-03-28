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
const ICE_GATHER_TIMEOUT_MS = 5000;

const log = (role: string, ...args: unknown[]): void =>
  console.log(`[PeerConnection:${role}]`, ...args);

export class PeerConnection {
  private _pc: RTCPeerConnection;
  private _channel: RTCDataChannel | null = null;
  private _role: Role;
  private _roomId: string;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  onMessage: OnMessageCb = () => undefined;
  onStateChange: OnStateCb = () => undefined;
  onChannelOpen: () => void = () => undefined;

  constructor(role: Role, roomId: string) {
    this._role = role;
    this._roomId = roomId;

    log(role, "creating RTCPeerConnection, room:", roomId);
    this._pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this._pc.onconnectionstatechange = () => {
      log(role, "connectionState →", this._pc.connectionState);
      this.onStateChange(this._pc.connectionState);
    };

    this._pc.oniceconnectionstatechange = () => {
      log(role, "iceConnectionState →", this._pc.iceConnectionState);
    };

    this._pc.onicegatheringstatechange = () => {
      log(role, "iceGatheringState →", this._pc.iceGatheringState);
    };

    this._pc.onsignalingstatechange = () => {
      log(role, "signalingState →", this._pc.signalingState);
    };

    if (role === "host") {
      this._channel = this._pc.createDataChannel("game", {
        ordered: false,
        maxRetransmits: 0,
      });
      log(role, "created dataChannel");
      this._setupChannel(this._channel);
    } else {
      this._pc.ondatachannel = (ev) => {
        log(role, "received dataChannel");
        this._channel = ev.channel;
        this._setupChannel(this._channel);
      };
    }
  }

  async startAsHost(): Promise<void> {
    log(this._role, "startAsHost — creating offer");
    const offer = await this._pc.createOffer();
    const iceComplete = this._waitForICE();
    await this._pc.setLocalDescription(offer);
    log(this._role, "localDescription set, waiting for ICE gathering…");
    const finalDesc = await iceComplete;
    log(this._role, "ICE gathering done, sending offer to signaling server");
    await this._signal({ type: "offer", sdp: finalDesc.sdp!, roomId: this._roomId });
    log(this._role, "offer sent, starting poll");
    this._startPolling();
  }

  async startAsClient(): Promise<void> {
    log(this._role, "startAsClient — starting poll");
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
    ch.onopen = () => {
      log(this._role, "dataChannel open ✓");
      this.onChannelOpen();
    };
    ch.onclose = () => log(this._role, "dataChannel closed");
    ch.onerror = (e) => log(this._role, "dataChannel error", e);
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
      const url = `/api/signal?room=${encodeURIComponent(this._roomId)}&role=${this._role}`;
      const res = await fetch(url);
      log(this._role, `poll → HTTP ${res.status}`);
      const msg: unknown = await res.json();
      if (!msg) {
        log(this._role, "poll → empty (no message waiting)");
        return;
      }
      log(this._role, "poll → received message:", (msg as { type?: string }).type ?? msg);
      await this._handleSignal(msg as SignalMessage);
    } catch (err) {
      log(this._role, "poll error:", err);
    }
  }

  private async _handleSignal(msg: SignalMessage): Promise<void> {
    if (msg.type === "offer" && this._role === "client") {
      log(this._role, "handling offer — setting remote description");
      await this._pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
      log(this._role, "creating answer");
      const answer = await this._pc.createAnswer();
      const iceComplete = this._waitForICE();
      await this._pc.setLocalDescription(answer);
      log(this._role, "waiting for ICE gathering…");
      const finalDesc = await iceComplete;
      log(this._role, "ICE done, sending answer");
      await this._signal({ type: "answer", sdp: finalDesc.sdp!, roomId: this._roomId });
      log(this._role, "answer sent");
    } else if (msg.type === "answer" && this._role === "host") {
      log(this._role, "handling answer — setting remote description");
      await this._pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
      log(this._role, "remote description set ✓");
    } else {
      log(this._role, "unhandled signal type:", msg.type, "for role:", this._role);
    }
  }

  private async _signal(msg: SignalMessage): Promise<void> {
    try {
      const res = await fetch("/api/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: this._roomId, role: this._role, msg }),
      });
      log(this._role, `signal POST → HTTP ${res.status}`);
    } catch (err) {
      log(this._role, "signal POST error:", err);
    }
  }

  private _waitForICE(): Promise<RTCSessionDescriptionInit> {
    return new Promise((resolve) => {
      const done = (): void => {
        log(this._role, "ICE gathering complete, candidates in SDP");
        resolve(this._pc.localDescription!);
      };
      const t = setTimeout(() => {
        log(this._role, `ICE gathering timed out after ${ICE_GATHER_TIMEOUT_MS}ms, using what we have`);
        done();
      }, ICE_GATHER_TIMEOUT_MS);
      const check = (): void => {
        if (this._pc.iceGatheringState === "complete") {
          clearTimeout(t);
          done();
        }
      };
      this._pc.onicegatheringstatechange = () => {
        log(this._role, "iceGatheringState →", this._pc.iceGatheringState);
        check();
      };
      check();
    });
  }
}
