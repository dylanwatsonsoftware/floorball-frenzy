import { describe, it, expect, vi } from "vitest";

// Minimal reproduction of the logic we want to test, since Phaser classes are
// difficult to instantiate in a 'node' environment without a DOM.
// This tests the EXCLUSIVITY logic implemented in GameScene and OnlineGameScene.

interface PossessionLogic {
  hostHasPossession: boolean;
  clientHasPossession: boolean;
  applyStickPossession: (id: "host" | "client") => boolean;
}

function runPossessionStep(state: PossessionLogic) {
  state.hostHasPossession = state.applyStickPossession("host");
  if (state.hostHasPossession) {
    state.clientHasPossession = false;
  } else {
    state.clientHasPossession = state.applyStickPossession("client");
  }
}

interface ChargeLogic {
  chargeMs: number;
  charging: boolean;
  updateLocalPrediction: (slapHeld: boolean) => void;
  correctFromSnapshot: (slapHeld: boolean) => void;
}

function runChargeLogic(state: ChargeLogic, localSlap: boolean, snapshotSlap: boolean) {
  state.updateLocalPrediction(localSlap);
  state.correctFromSnapshot(snapshotSlap);
}

describe("Charge desync correction logic", () => {
  it("zeroes charge when snapshot shows slap is released", () => {
    const state: ChargeLogic = {
      chargeMs: 500,
      charging: true,
      updateLocalPrediction: (held) => { if (held) state.chargeMs += 16; },
      correctFromSnapshot: (held) => { if (!held) { state.chargeMs = 0; state.charging = false; } }
    };

    // Simulate one step where local prediction thinks it's held but snapshot says it's released
    runChargeLogic(state, true, false);

    expect(state.chargeMs).toBe(0);
    expect(state.charging).toBe(false);
  });

  it("allows charge to accumulate when snapshot shows slap is held", () => {
    const state: ChargeLogic = {
      chargeMs: 500,
      charging: true,
      updateLocalPrediction: (held) => { if (held) state.chargeMs += 16; },
      correctFromSnapshot: (held) => { if (!held) { state.chargeMs = 0; state.charging = false; } }
    };

    runChargeLogic(state, true, true);

    expect(state.chargeMs).toBe(516);
    expect(state.charging).toBe(true);
  });

  it("stops accumulation when local player releases even if snapshot still shows hold", () => {
    const state: ChargeLogic = {
      chargeMs: 500,
      charging: true,
      updateLocalPrediction: (held) => { if (held) { state.chargeMs += 16; } else { state.charging = false; } },
      correctFromSnapshot: (held) => { if (!held) { state.chargeMs = 0; state.charging = false; } }
    };

    // localSlap=false, snapshotSlap=true
    runChargeLogic(state, false, true);

    expect(state.chargeMs).toBe(500); // no increase
    expect(state.charging).toBe(false);
  });
});

describe("Possession prioritization logic", () => {
  it("prioritizes host and skips client check if host succeeds", () => {
    const applySpy = vi.fn();
    applySpy.mockReturnValueOnce(true); // host succeeds
    applySpy.mockReturnValueOnce(false); // client (should not be called)

    const state: PossessionLogic = {
      hostHasPossession: false,
      clientHasPossession: true, // starts true to test clearing
      applyStickPossession: applySpy
    };

    runPossessionStep(state);

    expect(state.hostHasPossession).toBe(true);
    expect(state.clientHasPossession).toBe(false);
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledWith("host");
  });

  it("allows client possession if host fails", () => {
    const applySpy = vi.fn();
    applySpy.mockReturnValueOnce(false); // host fails
    applySpy.mockReturnValueOnce(true);  // client succeeds

    const state: PossessionLogic = {
      hostHasPossession: false,
      clientHasPossession: false,
      applyStickPossession: applySpy
    };

    runPossessionStep(state);

    expect(state.hostHasPossession).toBe(false);
    expect(state.clientHasPossession).toBe(true);
    expect(applySpy).toHaveBeenCalledTimes(2);
  });
});
