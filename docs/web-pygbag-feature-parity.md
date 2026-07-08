# Web/Pygbag Feature Parity Checklist

Python/Pygbag remains authoritative for gameplay and product behaviour:

- `assalto_pygbag_ready/assalto_core.py`
- `assalto_pygbag_ready/assalto_app_ai.py`

This checklist tracks confirmed web differences that must be closed before claiming parity. The deeper rules matrix remains in `docs/python-web-parity.md`.

| Area | Current status | Required next change | Test coverage required |
| --- | --- | --- | --- |
| Route separation | In progress: Home, Setup, Game, Rules, Load and Settings are separate browser routes. | Add full pause/victory/recovery overlays and route restore tests. | Navigation tests for `/`, `/setup`, `/game`, `/rules`, `/load`, `/settings`. |
| Match setup | In progress: setup form exposes timer, opponent, human side, difficulty, Transform and placement independently. | Add complete setup validation and exact Python defaults where any mismatch is found. | All Human/Computer, Manual/Quick, Transform, side, difficulty and timer combinations. |
| Match configuration persistence | In progress: resolved setup config is stored with the match and local save. | Version and validate the full save schema; migrate old web saves. | Save/load for each setup mode and resolved Random side. |
| Special Square generation | Partial: normal starts no longer use a fixed production seed, but TS seeded output is not yet proven Python-identical. | Implement or fixture-lock Python-compatible seeded layouts. | Multi-seed Python-generated Special Square fixtures. |
| Quick Balanced placement | Partial: still uses the current TS heuristic. | Port `_apply_quick_balanced_setup()` and `_choose_quick_placement_square()` exactly. | Full-board snapshot equality for multiple Python fixtures. |
| AI side selection | In progress: setup can resolve AI as Black or White. | Verify turn ownership, modal ownership and placement ownership in all AI-side combinations. | AI Black and AI White setup, placement and gameplay tests. |
| AI turn loop | In progress: gameplay page uses a paced controller loop instead of a single menu effect. | Replace greedy single-action choice with Python full-turn search in the worker. | Two one-AP actions, one two-AP action, move-pass and stale-result cancellation tests. |
| AI difficulty | Partial: config captures Easy, Medium and Hard. | Port Python difficulty limits and use them in worker search. | Difficulty-specific search limit tests. |
| AI manual placement | Partial: AI can place its scheduled pieces using current TS placement heuristic. | Port `_ai_choose_placement()` exactly. | Human Black/White manual placement with AI-owned schedule segments. |
| Human input locking | Partial: AI turn and AI placement block direct board input. | Add lock coverage for pending decisions, animations, undo/load/restart cancellation. | Board/action disabled tests during AI control. |
| Decision ownership | Missing: pending decisions still rely partly on current store fields. | Introduce explicit `PendingDecision.owner`. | Human/AI defended-King and Transform ownership tests. |
| Defended-King flow | Partial: selection UI exists and the panel now surfaces engine-provided attack path, bounce path, landing, AP cost, Transform trigger and turn-ending status; single-defender preview and animation are still reduced. | Add explicit decision owner, always show preview/confirmation, and animate engine-provided bounce path. | One/multiple defender, bounce and Transform-trigger fixtures plus UI tests. |
| Timers | Partial: monotonic active-human countdown and timeout victory now exist; setup presets initialize clocks. Full Python pause policy across all modal/AI/navigation cases is not yet proven. | Add full canonical pause/resume policy, save/load clock restoration and fake-clock tests for every lifecycle transition. | Presets, untimed, placement pause, AI thinking, modal decision, navigation and save/load timer tests. |
| Save/load | Partial: local save includes more setup fields, and manual placement now exposes Save because placement phase/cursor/current piece/remaining pieces are represented; unresolved modal decision restoration remains incomplete. | Add versioned schema, validation, migrations, export/import and safe modal restoration. | Mid-turn, placement, timer, territory, Transform and pending-decision restore tests. |
| Victory/rematch lifecycle | Partial: game-over phase exists with visible Rematch/New Match/Save/Home actions and restart confirmation; full lifecycle parity is not complete. | Add exact same-settings rematch controller semantics, restart cancellation, and confirmed home return. | King, territory, timeout, rematch and new-match tests. |
| Rules/help | Partial: route exists with a concise rules draft. | Transfer complete Pygbag help/rules content into the modern layout. | Rules route smoke and match-preservation navigation tests. |
| Audio and feedback | Missing. | Port movement, capture, shield, Transform and victory feedback. | Audio trigger tests or mocked event assertions. |
| E2E coverage | Partial: initial Playwright smoke coverage now verifies routes, Quick Balanced start, manual placement save feedback and live clock countdown on desktop/mobile. | Expand to canonical gameplay, AI, persistence, victory, direct production-route and responsive flows. | Release-scope Playwright suite. |
| PWA/deployment | Partial: manifest, generated local icons, service worker, static-host fallback, package script, CI and manual artifact workflow exist. | Verify update behavior, artifact publication target and full GitHub Pages/base-path flow before release. | Production preview, base-path build and deployment workflow tests. |
