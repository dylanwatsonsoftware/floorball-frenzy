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
