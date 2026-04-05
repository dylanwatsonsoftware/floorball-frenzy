import { describe, it, expect, vi } from "vitest";

// Minimal reproduction of synchronized rematch logic to test the handshake
// without requiring the full Phaser scene.

interface RematchState {
  isHost: boolean;
  wantsRematch: boolean;
  remoteWantsRematch: boolean;
  gameStarted: boolean;
  messagesSent: any[];
}

function handleRematchClick(state: RematchState) {
  if (state.wantsRematch) return;
  state.wantsRematch = true;
  state.messagesSent.push({ type: "rematch" });

  if (state.isHost && state.wantsRematch && state.remoteWantsRematch) {
    state.gameStarted = true;
    state.messagesSent.push({ type: "start" });
  }
}

function handleRematchMessage(state: RematchState) {
  state.remoteWantsRematch = true;
  if (state.isHost && state.wantsRematch && state.remoteWantsRematch) {
    state.gameStarted = true;
    state.messagesSent.push({ type: "start" });
  }
}

function handleStartMessage(state: RematchState) {
  if (!state.isHost) {
    state.gameStarted = true;
  }
}

describe("Synchronized Rematch Handshake", () => {
  it("starts the game when Host clicks then Client clicks", () => {
    const host: RematchState = { isHost: true, wantsRematch: false, remoteWantsRematch: false, gameStarted: false, messagesSent: [] };
    const client: RematchState = { isHost: false, wantsRematch: false, remoteWantsRematch: false, gameStarted: false, messagesSent: [] };

    // 1. Host clicks rematch
    handleRematchClick(host);
    expect(host.wantsRematch).toBe(true);
    expect(host.gameStarted).toBe(false);
    expect(host.messagesSent).toContainEqual({ type: "rematch" });

    // 2. Client receives 'rematch' message (not modeled here, but it triggers handleRematchMessage)
    handleRematchMessage(client);
    expect(client.remoteWantsRematch).toBe(true);
    expect(client.gameStarted).toBe(false);

    // 3. Client clicks rematch
    handleRematchClick(client);
    expect(client.wantsRematch).toBe(true);
    expect(client.messagesSent).toContainEqual({ type: "rematch" });

    // 4. Host receives 'rematch' message
    handleRematchMessage(host);
    expect(host.gameStarted).toBe(true);
    expect(host.messagesSent).toContainEqual({ type: "start" });

    // 5. Client receives 'start' message
    handleStartMessage(client);
    expect(client.gameStarted).toBe(true);
  });

  it("starts the game when Client clicks then Host clicks", () => {
    const host: RematchState = { isHost: true, wantsRematch: false, remoteWantsRematch: false, gameStarted: false, messagesSent: [] };
    const client: RematchState = { isHost: false, wantsRematch: false, remoteWantsRematch: false, gameStarted: false, messagesSent: [] };

    // 1. Client clicks rematch
    handleRematchClick(client);
    expect(client.wantsRematch).toBe(true);
    expect(client.messagesSent).toContainEqual({ type: "rematch" });

    // 2. Host receives 'rematch' message
    handleRematchMessage(host);
    expect(host.remoteWantsRematch).toBe(true);
    expect(host.gameStarted).toBe(false);

    // 3. Host clicks rematch
    handleRematchClick(host);
    expect(host.wantsRematch).toBe(true);
    expect(host.gameStarted).toBe(true);
    expect(host.messagesSent).toContainEqual({ type: "start" });

    // 4. Client receives 'start' message
    handleStartMessage(client);
    expect(client.gameStarted).toBe(true);
  });

  it("does not start if only one player clicks", () => {
    const host: RematchState = { isHost: true, wantsRematch: false, remoteWantsRematch: false, gameStarted: false, messagesSent: [] };

    handleRematchClick(host);
    expect(host.gameStarted).toBe(false);

    // Simulate some time or other messages
    expect(host.wantsRematch).toBe(true);
    expect(host.remoteWantsRematch).toBe(false);
  });
});
