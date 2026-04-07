import { describe, it, expect } from "vitest";
import { normaliseJoystick, deadZone } from "../src/ui/joystickMath";

describe("joystickMath — normaliseJoystick", () => {
  it("returns zero vector when origin and touch are identical", () => {
    const v = normaliseJoystick(100, 100, 100, 100, 50);
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it("returns unit vector when touch is at exactly radius distance", () => {
    const radius = 50;
    const v = normaliseJoystick(100, 100, 150, 100, radius);
    expect(v.x).toBe(1);
    expect(v.y).toBe(0);
  });

  expect(normaliseJoystick(100, 100, 100, 150, 50).y).toBe(1);

  it("clamps magnitude to 1 when touch is beyond radius", () => {
    const v = normaliseJoystick(0, 0, 1000, 0, 50);
    expect(v.x).toBe(1);
    expect(v.y).toBe(0);
  });

  it("returns fractional magnitude when touch is inside radius", () => {
    const v = normaliseJoystick(0, 0, 25, 0, 50);
    expect(v.x).toBe(0.5);
  });
});

describe("joystickMath — deadZone", () => {
  it("returns zero when value is below threshold", () => {
    expect(deadZone(0.05, 0.1)).toBe(0);
    expect(deadZone(-0.05, 0.1)).toBe(0);
  });

  it("returns value when value is above threshold", () => {
    expect(deadZone(0.15, 0.1)).toBe(0.15);
    expect(deadZone(-0.15, 0.1)).toBe(-0.15);
  });
});
