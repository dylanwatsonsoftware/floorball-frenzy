import { describe, it, expect } from "vitest";
import { stepBall } from "../src/physics/ballPhysics";
import type { Ball } from "../src/types/game";
import {
  GOAL_LINE_RIGHT,
  GOAL_TOP,
  GOAL_BOTTOM,
} from "../src/physics/constants";

describe("stepBall — goal anti-tunneling", () => {
  it("detects goal even if ball center skips over goal line in one step", () => {
    // Ball starts just before the right goal line
    const ball: Ball = {
      x: GOAL_LINE_RIGHT - 5,
      y: (GOAL_TOP + GOAL_BOTTOM) / 2,
      z: 0,
      vx: 2000, // Very fast
      vy: 0,
      vz: 0,
      possessedBy: null
    };

    // One step at 60Hz (1/60s)
    // vx * dt = 2000 * 0.0166 = 33.33px
    // New x will be ~1081 + 33 = 1114
    // Goal line is at 1086.
    // Without anti-tunneling, ball.x - BALL_RADIUS might still be > GOAL_LINE_RIGHT?
    // ball.x = 1081 + 33 = 1114.
    // 1114 - 10 = 1104. 1104 > 1086. Correct, it would have been missed if we only checked current position.

    const result = stepBall(ball, 1/60);
    expect(result.goal).toBe("host");
  });
});
