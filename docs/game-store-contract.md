# Game store contract

`web/src/game/state/gameStore.ts` is the only public entry point for match state. React components and presentation hooks import `useGameStore`; they do not import controller internals.

## Invariants

- The runtime store surface is frozen by `storeContract.test.ts`: 23 state fields and 21 actions.
- This decomposition changes module ownership only. It does not change game rules, legal-action generation, turn order, AI policy, timer semantics, undo semantics or save meaning.
- The TypeScript engine under `web/src/game/engine/` remains the authority for movement, capture, Defended-King, Transform, territory and victory rules.
- Save schemas 1 and 2 remain accepted. Generated Special and Transform Squares are restored from the save and are never rerolled during load.
- Zustand `set` and `get` remain inside `gameStore.ts`. Extracted controllers receive state or domain values and return values or state patches.

## Module boundaries

- `state/storeTypes.ts`: shared state, action and persistence shapes.
- `placement/placementSetup.ts`: inventories, placement queue, base-board creation and Quick-Balanced placement.
- `turn/turnHelpers.ts`: target enumeration, descriptions, defender lookup, Transform-event detection and half-turn advance.
- `turn/commitAction.ts`: pure committed-action orchestration and resulting state patch.
- `clocks/clockController.ts`: monotonic clock arithmetic and timeout patches.
- `history/historyController.ts`: undo snapshots and restore patches.
- `persistence/saveGame.ts`: save construction, validation and restore patches.
- `state/gameStore.ts`: public actions and the minimal `set`/`get` coordination required to connect those modules.

## Dependency direction

Controllers may depend on engine types and pure engine functions. They must not import React, Zustand or `useGameStore`. `gameStore.ts` may import controllers, but controllers must not import the store. This keeps the dependency graph one-way and prevents circular state ownership.

## Validation

A store refactor is acceptable only when all of the following remain green:

- public-contract freeze test;
- web unit and parity suites;
- TypeScript typecheck, ESLint and Prettier;
- production build;
- Playwright lifecycle and browser suites;
- Python reference-engine tests.
