import type { GameMessage, SignalMessage } from "./messages";
import { decodeMessage, encodeMessage } from "./messages";

export type Role = "host" | "client";

type OnMessageCb = (msg: GameMessage) => void;
type OnStateCb = (state: RTCPeerConnectionState) => void;

const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch("/api/ice-servers");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as RTCIceServer[];
  } catch {
    return FALLBACK_ICE_SERVERS;
  }
}

const SIGNAL_POLL_MS = 500;
const ICE_GATHER_TIMEOUT_MS = 5000;
// Delay before reconnecting after "disconnected" (transient drops often self-heal)
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 6;

const log = (role: string, ...args: unknown[]): void =>
  console.log(`[PeerConnection:${role}]`, ...args);

export class PeerConnection {
  private _pc!: RTCPeerConnection;
  private _channel: RTCDataChannel | null = null;
  private _role: Role;
  private _roomId: string;
  private _iceServers: RTCIceServer[] = FALLBACK_ICE_SERVERS;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempts = 0;

  onMessage: OnMessageCb = () => undefined;
  onStateChange: OnStateCb = () => undefined;
  onChannelOpen: () => void = () => undefined;
  onAnswerReceived: () => void = () => undefined;
  onReconnecting: () => void = () => undefined;
  onGiveUp: () => void = () => undefined;

  constructor(role: Role, roomId: string) {
    this._role = role;
    this._roomId = roomId;
    log(role, "PeerConnection created, room:", roomId);
  }

  async startAsHost(): Promise<void> {
    log(this._role, "startAsHost — fetching ICE config");
    this._iceServers = await fetchIceServers();
    log(this._role, "ICE servers:", this._iceServers.length, "entries");
    this._initPC();
    log(this._role, "creating offer");
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
    log(this._role, "startAsClient — fetching ICE config");
    this._iceServers = await fetchIceServers();
    log(this._role, "ICE servers:", this._iceServers.length, "entries");
    this._initPC();
    log(this._role, "starting poll");
    this._startPolling();
  }

  send(msg: GameMessage): void {
    if (this._channel?.readyState === "open") {
      this._channel.send(encodeMessage(msg));
    }
  }

  close(): void {
    this._clearTimers();
    this._channel?.close();
    this._pc.close();
  }

  get connectionState(): RTCPeerConnectionState {
    return this._pc.connectionState;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _initPC(): void {
    this._pc = new RTCPeerConnection({ iceServers: this._iceServers });

    this._pc.onconnectionstatechange = () => {
      const state = this._pc.connectionState;
      log(this._role, "connectionState →", state);
      this.onStateChange(state);

      if (state === "connected") {
        // Clear any pending reconnect timer — we're back
        if (this._reconnectTimer !== null) {
          clearTimeout(this._reconnectTimer);
          this._reconnectTimer = null;
        }
        this._reconnectAttempts = 0;
      } else if (state === "failed") {
        this._scheduleReconnect(0);
      } else if (state === "disconnected") {
        // Wait a moment — transient network hiccup may self-heal
        this._scheduleReconnect(RECONNECT_DELAY_MS);
      }
    };

    this._pc.oniceconnectionstatechange = () =>
      log(this._role, "iceConnectionState →", this._pc.iceConnectionState);
    this._pc.onicegatheringstatechange = () =>
      log(this._role, "iceGatheringState →", this._pc.iceGatheringState);
    this._pc.onsignalingstatechange = () =>
      log(this._role, "signalingState →", this._pc.signalingState);

    if (this._role === "host") {
      this._channel = this._pc.createDataChannel("game", {
        ordered: false,
        maxRetransmits: 0,
      });
      log(this._role, "created dataChannel");
      this._setupChannel(this._channel);
    } else {
      this._pc.ondatachannel = (ev) => {
        log(this._role, "received dataChannel");
        this._channel = ev.channel;
        this._setupChannel(this._channel);
      };
    }
  }

  private _scheduleReconnect(delayMs: number): void {
    // Don't stack multiple reconnect attempts
    if (this._reconnectTimer !== null) return;
    if (this._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log(this._role, "max reconnect attempts reached — giving up");
      this.onGiveUp();
      return;
    }
    log(this._role, `scheduling reconnect in ${delayMs}ms (attempt ${this._reconnectAttempts + 1})`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._doReconnect();
    }, delayMs);
  }

  private _doReconnect(): void {
    this._reconnectAttempts++;
    log(this._role, `reconnecting… attempt ${this._reconnectAttempts}`);

    // Tear down old connection
    this._clearTimers();
    this._channel?.close();
    this._pc.close();
    this._channel = null;

    // Fire callback so the scene can show "Reconnecting…" and pause game
    this.onReconnecting();

    // Build fresh PC and re-run signaling (reuse already-fetched ICE config)
    this._initPC();
    if (this._role === "host") {
      log(this._role, "reconnect — creating offer");
      void this._pc.createOffer().then(async (offer) => {
        const iceComplete = this._waitForICE();
        await this._pc.setLocalDescription(offer);
        const finalDesc = await iceComplete;
        await this._signal({ type: "offer", sdp: finalDesc.sdp!, roomId: this._roomId });
        this._startPolling();
      });
    } else {
      this._startPolling();
    }
  }

  private _clearTimers(): void {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _setupChannel(ch: RTCDataChannel): void {
    ch.onopen = () => {
      log(this._role, "dataChannel open ✓");
      this.onChannelOpen();
    };
    ch.onclose = () => {
      log(this._role, "dataChannel closed");
      this._scheduleReconnect(0);
    };
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
      this.onAnswerReceived();
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
