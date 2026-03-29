import { describe, it, expect } from "vitest";
import { stickDir, ballInRange } from "../src/physics/stickUtils";
import { STICK_REACH, BALL_RADIUS, PLAYER_RADIUS } from "../src/physics/constants";

const PLAYER = { x: 100, y: 100 };

// Compute the stick tip position for a given aim
function tipFor(aim: { x: number; y: number }) {
  const sd = stickDir(aim);
  return { x: PLAYER.x + sd.x * STICK_REACH, y: PLAYER.y + sd.y * STICK_REACH };
}

describe("stickDir", () => {
  it("facing right (1,0) → stick extends downward (0,1)", () => {
    const d = stickDir({ x: 1, y: 0 });
    expect(d.x).toBeCloseTo(0);
    expect(d.y).toBeCloseTo(1);
  });

  it("facing up (0,-1) → stick extends right (1,0)", () => {
    const d = stickDir({ x: 0, y: -1 });
    expect(d.x).toBeCloseTo(1);
    expect(d.y).toBeCloseTo(0);
  });

  it("returns unit vector for diagonal aim", () => {
    const d = stickDir({ x: 1, y: 1 });
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
  });

  it("zero aim returns safe fallback (0,1)", () => {
    const d = stickDir({ x: 0, y: 0 });
    expect(d.x).toBe(0);
    expect(d.y).toBe(1);
  });
});

describe("ballInRange — tip check", () => {
  it("ball exactly at tip surface is in range", () => {
    const aim = { x: 1, y: 0 };
    const tip = tipFor(aim);
    // Place ball just touching the tip (BALL_RADIUS away)
    const ball = { x: tip.x + BALL_RADIUS, y: tip.y };
    expect(ballInRange(PLAYER, ball, aim)).toBe(true);
  });

  it("ball just inside tip threshold is in range", () => {
    const aim = { x: 1, y: 0 };
    const tip = tipFor(aim);
    const ball = { x: tip.x + BALL_RADIUS + 10, y: tip.y }; // 10 < 18 threshold
    expect(ballInRange(PLAYER, ball, aim)).toBe(true);
  });

  it("ball too far from tip is out of range", () => {
    const aim = { x: 1, y: 0 };
    const tip = tipFor(aim);
    const ball = { x: tip.x + BALL_RADIUS + 50, y: tip.y }; // 50 > 18 threshold
    expect(ballInRange(PLAYER, ball, aim)).toBe(false);
  });
});

describe("ballInRange — body check (aim-independent)", () => {
  it("ball touching player body is in range regardless of aim direction", () => {
    // Ball right next to player body — should fire even if aim points away
    const ball = { x: PLAYER.x + PLAYER_RADIUS + BALL_RADIUS, y: PLAYER.y };
    const aimAway = { x: -1, y: 0 }; // aim pointing opposite direction
    expect(ballInRange(PLAYER, ball, aimAway)).toBe(true);
  });

  it("ball far from body is out of range when tip also doesn't reach", () => {
    const ball = { x: PLAYER.x + 300, y: PLAYER.y };
    const aim = { x: 1, y: 0 };
    expect(ballInRange(PLAYER, ball, aim)).toBe(false);
  });
});

describe("ballInRange — possession scenario", () => {
  it("ball at stick tip is in range when aim is facing right", () => {
    const aim = { x: 1, y: 0 };
    const sd = stickDir(aim);
    // Ball at exactly the tip (dist = 0)
    const ball = { x: PLAYER.x + sd.x * STICK_REACH, y: PLAYER.y + sd.y * STICK_REACH };
    expect(ballInRange(PLAYER, ball, aim)).toBe(true);
  });

  it("ball at stick tip is in range even with slightly misaligned smooth aim", () => {
    const rawAim = { x: 1, y: 0 };
    const smoothAim = { x: 0.92, y: 0.38 }; // ~22° off — lagging smooth aim

    // Ball is at raw aim's tip (where possession physically placed it)
    const rawSd = stickDir(rawAim);
    const ball = { x: PLAYER.x + rawSd.x * STICK_REACH, y: PLAYER.y + rawSd.y * STICK_REACH };

    // Even with smooth aim slightly off, body-proximity check should save us
    expect(ballInRange(PLAYER, ball, smoothAim)).toBe(true);
  });
});
