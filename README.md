# 🏑 Floorball Frenzy (Working Title)

A fast-paced, arcade-style 1v1 floorball game built for the web. Designed for mobile-first play, quick matches, and easy multiplayer via shareable links.

---

## 🎯 Vision

Create a highly accessible, skill-based multiplayer sports game that blends:
- The speed and intensity of ice hockey
- The control and finesse of floorball
- The simplicity and immediacy of mobile web games

Players should be able to:
- Open a link
- Start a match within seconds
- Experience tight, responsive gameplay with meaningful skill expression

---

## 🧭 Long-Term Direction

### Core Pillars

**1. Fast & Fluid Gameplay**
- 2-minute matches
- Minimal interruptions
- Continuous play with quick resets

**2. Skill Expression**
- Timing (one-touch bonuses)
- Mind games (fake shots)
- Positioning and movement (dash, spacing)

**3. Accessible Multiplayer**
- No accounts required
- Link-based matchmaking
- Works instantly on mobile

**4. Depth Over Time**
- Start simple (arcade core)
- Layer mechanics gradually
- Introduce complexity without overwhelming players

---

## 🕹️ Core Gameplay

### Match Format
- 1v1
- 2 minutes
- Highest score wins

### Perspective
- Top-down

### Controls
- Virtual joystick (movement)
- Wrist shot (tap/hold)
- Slap shot (power shot)
- Dash (burst movement)

---

## ⚙️ Core Mechanics

### 🟠 Ball Physics (Arcade + Floorball Hybrid)
- Fast-moving, low-mass ball
- Slight friction for control
- Bounces off walls and players
- Can be lifted into the air (pseudo-3D)

---

### 🟣 Lift / Air Mechanics
- Holding shot increases:
  - Power
  - Height (Z-axis)
- Ball can:
  - Travel over players/walls
  - Go out of bounds if overhit

---

### 🔵 Possession Assist
- Ball slightly follows nearby player movement
- Enables dribbling feel without “stick attachment”

---

### 🟢 One-Touch Bonus
- Shooting immediately after receiving ball grants:
  - Increased shot power
- Encourages fast passing play

---

### 🟡 Fake Shot / Cancel
- Begin shot → cancel before release
- Used to bait opponents
- May give slight movement boost

---

### 🔴 Dash / Burst
- Short speed boost
- Cooldown-based
- Used for:
  - Closing distance
  - Creating space
  - Defensive recovery

---

### ⚪ Lightweight Collisions
- Soft player-to-player collisions
- No heavy hits or knockdowns
- Maintains flow and control

---

### 🧤 Goalie Reaction Mini-Game (Planned)
- Triggered during close-range shots
- Quick reaction input (left/center/right)
- Adds clutch moments and tension

---

## 🎮 Game Modes

### Local Play
- Two players on one device
- Split controls (left/right sides)

### Online Play
- Create game → share link
- Peer-to-peer via WebRTC
- Host authoritative simulation

---

## 🌐 Tech Philosophy

- Client-heavy architecture
- Minimal backend (only signaling + leaderboard proxy)
- Real-time gameplay via peer-to-peer networking
- Designed for Vercel deployment

---

## 🚀 Future Ideas

- Teams / skins (local clubs)
- Ranked matchmaking
- 2v2 or more players
- Advanced stick handling
- AI opponents
- Tournament modes

---

## 🧱 Development Approach

1. Build a tight, fun core loop
2. Validate feel locally
3. Add multiplayer sync
4. Layer in mechanics incrementally
5. Polish visuals and UX

---

## 📝 Notes

This document defines the **intent and direction** of the game.

Implementation details may evolve, but:
- The core feel (fast, skill-based, mobile-first)
- The simplicity of access
- The layered depth

…should remain constant.
