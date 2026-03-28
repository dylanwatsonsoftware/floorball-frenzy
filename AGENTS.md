# 🤖 AGENTS.md — Development Workflow Guide

---

## 🎯 Purpose

This document defines how coding agents (or developers) should work on this project.

Goals:
- Maintain steady progress
- Avoid large, risky changes
- Ensure working software at every step
- Keep the codebase stable and testable

---

## 🧭 Core Principles

1. **Work incrementally**
2. **Always keep the project runnable**
3. **Write tests alongside features**
4. **Commit small, meaningful changes**
5. **Push frequently**

---

## 🔁 Development Loop (Required Process)

Every task should follow this exact loop:

### 1. Plan a Small Step
- Break work into the smallest meaningful unit
- Example:
  - “Render player on screen”
  - “Add joystick input”
  - “Send input over network”

---

### 2. Implement the Step
- Write only the code needed for this step
- Avoid adding unrelated features
- Keep scope tight

---

### 3. Write / Update Tests
- Add tests for new logic where applicable
- Update existing tests if behavior changes

Examples:
- Physics calculations
- Input handling
- State transitions

---

### 4. Verify Locally
- Ensure:
  - App runs without errors
  - Feature works as expected
  - No regressions introduced

---

### 5. Commit

Each commit must:
- Represent a **working state**
- Be **small and focused**

Commit message format:

```
<type>: <short description>

Examples:
feat: add player movement system
fix: correct ball collision response
test: add unit tests for dash mechanic
```

---

### 6. Push

- Push after every working commit
- Do not batch large changes
- Keep remote branch always deployable

---

## 🧱 Task Sizing Guidelines

Good tasks:
- Can be completed in < 1–2 hours
- Have clear success criteria
- Do not depend on large unfinished systems

Bad tasks:
- “Implement multiplayer”
- “Build full physics engine”
- “Add all UI”

---

## 🧪 Testing Strategy

### Priority Areas
- Physics calculations
- Game state updates
- Networking message handling

### Not Required (initially)
- Visual rendering tests
- Full end-to-end automation

---

## 🧩 Feature Development Order

Follow this order strictly:

1. Local gameplay (no networking)
2. Core physics (movement, ball)
3. Shooting mechanics
4. UI controls
5. Networking (WebRTC sync)
6. Advanced mechanics (dash, bonuses, etc.)

---

## 🚫 Constraints

- Do NOT introduce large refactors without necessity
- Do NOT break working features
- Do NOT skip testing for core logic
- Do NOT combine unrelated changes in one commit

---

## ✅ Definition of Done

A task is complete when:
- Feature works
- Tests pass (if applicable)
- Code is committed
- Code is pushed

---

## 📝 Notes

This workflow is designed to:
- Minimize bugs
- Enable fast iteration
- Support automated coding agents

Consistency is more important than speed.
