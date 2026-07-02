# Agent Freedom And Production Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relax AI strategy constraints to game legality and information correctness, then add a stable production HTTP runtime.

**Architecture:** Keep the pure rule engine and legal-action validator as hard guards. Simplify prompt strategy guidance to state, visibility, public facts, table talk, and output contract. Add a Node server that reuses `handleAiActionRequest` and serves built static files from `dist/`.

**Tech Stack:** React, TypeScript, Vite, Vitest, Node `http`, Node filesystem APIs.

---

### Task 1: AI Speech And Prompt Boundary

**Files:**
- Modify: `src/ai/prompt.test.ts`
- Modify: `src/ai/prompt.ts`
- Modify: `src/ai/types.ts`

- [ ] Add failing tests that legal but low-information or vote-mismatched speech stays `source: "model"`.
- [ ] Add failing tests that strategy-prescriptive `EV ... keep ME/KE`, `GOOD ... prefer public-good`, and `ST ...` prompt lines are absent.
- [ ] Keep tests proving legal actions, private knowledge, public facts, and output contract remain present.
- [ ] Remove speech repair reasons for `low-information` and `action-mismatch`.
- [ ] Remove strategy-prescriptive prompt helpers while keeping information and legality helpers.
- [ ] Run `npm test -- --run src/ai/prompt.test.ts` and confirm the prompt tests pass.

### Task 2: Production Server

**Files:**
- Create: `server/prodServer.ts`
- Create: `server/prodServer.test.ts`
- Modify: `package.json`
- Modify: `README.md`

- [ ] Add failing tests for static `index.html` serving and `/api/ai-action` routing.
- [ ] Implement a small Node HTTP server that serves `dist/`, falls back to `index.html` for app routes, and delegates `/api/ai-action`.
- [ ] Add `prod:start` script with `HOST=0.0.0.0` and `PORT=3238` defaults.
- [ ] Document separate dev and prod commands.
- [ ] Run `npm test -- --run server/prodServer.test.ts`.

### Task 3: Verification And Stable Production

**Files:**
- Modify as needed.

- [ ] Run `npm test -- --run`.
- [ ] Run `npm run build`.
- [ ] Stop any stale process on the chosen production port if it belongs to this repo.
- [ ] Start `npm run prod:start` with `HOST=0.0.0.0 PORT=3238` in a long-running session.
- [ ] Smoke test `http://127.0.0.1:3238/` and `/api/ai-action`.
