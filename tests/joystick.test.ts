import { describe, it, expect } from "vitest";
import { normaliseJoystick, deadZone } from "../src/ui/joystickMath";

describe("normaliseJoystick", () => {
  it("returns zero vector when pointer equals origin", () => {
    const v = normaliseJoystick(0, 0, 0, 0, 60);
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it("clamps magnitude to 1 when drag exceeds radius", () => {
    const v = normaliseJoystick(0, 0, 200, 0, 60);
    expect(v.x).toBeCloseTo(1, 5);
    expect(v.y).toBeCloseTo(0, 5);
  });

  it("returns fractional magnitude within radius", () => {
    const v = normaliseJoystick(0, 0, 30, 0, 60);
    expect(v.x).toBeCloseTo(0.5, 5);
    expect(v.y).toBeCloseTo(0, 5);
  });

  it("normalises diagonal drag correctly", () => {
    // 45° drag of radius distance → both components ≈ 0.707
    const r = 60;
    const d = r * Math.SQRT2; // ensures magnitude > r → clamps to 1
    const v = normaliseJoystick(0, 0, d, d, r);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 4);
    expect(v.x).toBeCloseTo(v.y, 4);
  });

  it("returns negative x for leftward drag", () => {
    const v = normaliseJoystick(100, 100, 0, 100, 60);
    expect(v.x).toBeLessThan(0);
    expect(v.y).toBeCloseTo(0, 5);
  });
});

describe("deadZone", () => {
  it("returns 0 when magnitude below threshold", () => {
    expect(deadZone(0.05, 0.1)).toBe(0);
  });

  it("returns value unchanged when above threshold", () => {
    expect(deadZone(0.5, 0.1)).toBeCloseTo(0.5, 5);
  });

  it("threshold boundary: exactly at threshold returns 0", () => {
    expect(deadZone(0.1, 0.1)).toBe(0);
  });
});
