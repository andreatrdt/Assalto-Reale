# Pure TypeScript game-core extraction

## Status

Phase B.6 is in progress on `refactor/extract-game-core`. Checkpoint 6.1 (standalone package boundary) is implemented on this branch and under validation; checkpoint 6.2 (canonical match-command API) follows after 6.1 is merged and verified.

## Big-plan position

This work is Phase B.6 of the Assalto Reale roadmap. Release hardening, lifecycle/persistence hardening, browser-quality hardening, Python–TypeScript parity and the behaviour-preserving `gameStore.ts` decomposition are complete.

## Goal

Create a TypeScript game core that can be executed unchanged by the browser, a future authoritative Node.js server and tests. The core must not depend on React, Zustand, localStorage, routing, animation, audio or browser APIs.

## Current boundaries

- `web/src/game/engine/` owns pure board rules: actions, placement, Defended King, Transform, territory, victory, deterministic special-square generation and snapshot conversion.
- `web/src/game/turn/` coordinates committed actions and half-turn progression without React or Zustand, but currently uses web-app state shapes.
- `web/src/game/state/gameStore.ts` remains the public Zustand coordinator and owns browser-facing lifecycle and action wiring.
- `web/src/game/persistence/saveGame.ts` mixes pure save validation/restore patches with localStorage availability concerns.

## Extraction checkpoints

### 6.1 Establish the package boundary

- Introduce `packages/game-core` as a standalone TypeScript package.
- Move the existing pure rules engine into the package without changing behaviour.
- Keep a temporary web compatibility adapter so existing imports and tests remain stable.
- Prove that the package typechecks without DOM libraries or browser globals.
- Keep Python parity fixtures and all existing web tests unchanged.

### 6.2 Introduce the match command API

Define browser-independent canonical shapes for:

- `MatchState`
- `GameCommand`
- `GameEvent`
- `PendingDecision`
- `CommandResult`

Expose pure operations such as:

- `createMatch`
- `getLegalActions`
- `applyCommand`
- `resolveDefendedKing`
- `resolveTransform`
- `advanceTurn`
- `checkVictory`
- `serializeState`
- `validateState`

The Zustand store will adapt its existing 23 state fields and 21 public actions to this API. Public UI behaviour and the existing save schema remain unchanged.

## Non-goals

- no rule changes
- no UI changes
- no save-schema changes
- no AI-policy changes
- no multiplayer protocol yet
- no server, accounts or Android work
- no removal of the Python regression oracle

## Dependency direction

```text
packages/game-core
        ↑
web adapters / Zustand store
        ↑
React UI

future server
        └────────→ packages/game-core
```

`packages/game-core` must never import from `web/`.

## Validation gates

Every extraction checkpoint must keep green:

- Python reference tests
- Python–TypeScript parity fixture freshness and parity suites
- public Zustand contract test
- web unit coverage thresholds
- TypeScript typecheck
- ESLint and Prettier
- production dependency audit
- production web build
- Chromium/mobile Playwright
- Firefox/WebKit smoke
- visual job contract

## Completion criteria for Phase 6

Phase B.6 is complete only when the browser and a plain Node.js process can import the same package to create and advance a match, including Defended King and Transform decisions, without importing React, Zustand or browser APIs.
