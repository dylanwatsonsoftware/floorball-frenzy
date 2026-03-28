# 📐 Technical Specification — Floorball Web Game

---

## 1. Architecture Overview

### Stack
- Frontend: Phaser (TypeScript)
- Hosting: Vercel
- Networking: WebRTC (DataChannel)
- Backend:
  - Vercel Functions (signaling + leaderboard proxy)
- Storage:
  - Ephemeral KV (for signaling only)

---

## 2. Game Modes

```ts
type GameMode = "local" | "online"
type Role = "host" | "client"
```

---

## 3. Scene Structure

```
BootScene
MenuScene
GameScene
```

---

## 4. Core Game Loop

### Fixed timestep

```ts
const FIXED_DT = 1 / 60
```

### Host:
- Runs authoritative simulation
- Sends snapshots at 10–20Hz

### Client:
- Runs prediction
- Applies reconciliation

---

## 5. Entity Models

### Player

```ts
type Player = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  input: InputState
}
```

---

### Ball (Pseudo-3D)

```ts
type Ball = {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}
```

---

## 6. Input Model

```ts
type InputState = {
  moveX: number
  moveY: number
  wrist: boolean
  slap: boolean
  dash: boolean
}
```

---

## 7. Physics Constants

```ts
const PLAYER_MAX_SPEED = 300
const PLAYER_ACCEL = 1200

const BALL_FRICTION = 0.92
const BALL_BOUNCE = 0.8

const GRAVITY = 900
const BALL_BOUNCE_Z = 0.5

const CONTROL_RADIUS = 40

const DASH_FORCE = 400
const DASH_COOLDOWN = 1000

const ONE_TOUCH_WINDOW = 300
```

---

## 8. Ball Physics

```ts
ball.vz -= GRAVITY * dt
ball.z += ball.vz * dt
```

```ts
if (ball.z <= 0) {
  ball.z = 0
  ball.vz *= -BALL_BOUNCE_Z
}
```

---

## 9. Possession Assist

```ts
if (distance(player, ball) < CONTROL_RADIUS) {
  ball.vx += (player.vx - ball.vx) * 0.1
  ball.vy += (player.vy - ball.vy) * 0.1
}
```

---

## 10. Shooting System

```ts
charge = clamp(holdTime / maxCharge, 0, 1)

ball.vx = aimX * (basePower + charge * powerScale)
ball.vy = aimY * (basePower + charge * powerScale)
ball.vz = charge * liftScale
```

---

## 11. One-Touch Bonus

```ts
if (lastTouch.playerId !== currentPlayer &&
    now - lastTouch.time < ONE_TOUCH_WINDOW) {
  power *= 1.25
}
```

---

## 12. Dash Mechanic

```ts
if (dashPressed && dashReady) {
  player.vx += aimX * DASH_FORCE
  player.vy += aimY * DASH_FORCE
}
```

---

## 13. Goal Detection

```ts
if (ball.z < GOAL_HEIGHT_THRESHOLD &&
    ball within goal bounds) {
  score++
}
```

---

## 14. Networking

### Message Types

```ts
type Message =
  | { type: "input", seq: number, input: InputState }
  | { type: "state", snapshot: GameState }
  | { type: "start" }
  | { type: "goal" }
  | { type: "ping", t: number }
  | { type: "pong", t: number }
```

---

## 15. Game State Snapshot

```ts
type GameState = {
  t: number
  ball: Ball
  players: {
    host: Player
    client: Player
  }
  score: {
    host: number
    client: number
  }
}
```

---

## 16. Local Mode

- No networking
- Two players instantiated locally
- Split controls

---

## 17. UI Layout (Mobile)

- Landscape only
- Left: joystick
- Right: buttons
- Safe-area padding

---

## 18. Non-Goals (MVP)

- Reconnect handling
- Anti-cheat
- Persistent accounts
- Dedicated servers

---

## 19. Deliverables for MVP

- Playable local match
- Online match via link
- Stable sync
- Basic scoring
- Mobile-ready UI
