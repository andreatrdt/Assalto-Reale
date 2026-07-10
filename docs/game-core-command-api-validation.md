# Game-core command API validation

This checkpoint completes Phase B.6 of the Assalto Reale roadmap by exposing a browser-independent match command API from `packages/game-core` and adapting the existing Zustand store to it.

The behaviour contract remains unchanged: no rule, UI, browser save-schema, public store API, AI-policy, timer or undo-semantic changes are introduced.

Local validation before pull-request CI:

- 44 Python reference tests;
- 272 web unit and characterisation tests;
- 141 Python–TypeScript parity tests;
- existing web coverage thresholds;
- standalone game-core typecheck without DOM libraries;
- standalone ESM build and plain-Node command/serialization smoke test;
- TypeScript typecheck, ESLint and Prettier;
- production web build;
- production dependency audit with zero vulnerabilities;
- Chromium/mobile Playwright suite;
- Firefox/WebKit smoke suite.

The pull-request CI remains the authoritative remote validation for the published branch.
