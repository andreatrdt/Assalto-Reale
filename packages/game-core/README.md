# @assalto-reale/game-core

Pure TypeScript rules engine for Assalto Reale.

This package owns board state, legal actions, placement validation, Defended King,
Transform, territory, victory, deterministic random generation and snapshot
conversion. It has no React, Zustand, storage, routing or browser dependencies.

The web application currently consumes it through compatibility adapters under
`web/src/game/engine/`. A future authoritative server will import the built
package directly.
