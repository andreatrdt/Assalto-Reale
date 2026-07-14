# Web Visual Refactor Status

> **Historical design/audit note.** Kept for design history; it may not reflect the current application. The authoritative current status is [`current-product-status.md`](current-product-status.md) — where they disagree, the status doc wins.

## Product direction

The modern web client should feel like a calm, contemporary digital board game:

- board-first during play
- muted green and neutral surfaces
- clear sans-serif typography
- restrained borders and shadows
- plain player-facing language
- no medieval, heraldic, gold-heavy or fantasy decoration
- no duplicated dashboard information

The visual layer must not recompute game rules. Engine and store state remain the source of truth.

## Locked public setup

Every newly started public web match uses:

- manual placement
- Transform enabled
- Human vs Human or Human vs Computer
- Black, White or Random side selection for Computer matches
- timed or untimed play

`QuickBalanced`, AI difficulty values and older Transform configurations remain internally compatible for tests and saved games, but are not exposed in the public setup screen.

## Completed

### Shared foundation

- muted green/neutral design tokens
- shared shell, buttons, panels, form controls, badges, empty states and confirmation dialogs
- persisted reduced-motion and high-contrast-board preferences
- responsive layouts at mobile, tablet and desktop sizes

### Home

- single Assalto Reale title
- dominant Start Match action
- conditional Resume Match action
- restrained Load, Rules and Settings utilities
- no decorative board preview or promotional dashboard content

### Match setup

- minimal centred layout
- Human / Computer selector
- side selection shown only for Computer
- compact timer selector
- Manual placement and Transform displayed as fixed public rules
- no public Quick Balanced, Transform toggle or AI difficulty selector

### Game layout

- compact game-specific header
- board-first desktop layout
- one compact status/control panel
- panel below the board on smaller screens
- placement, active play, defended-King, Transform and victory states retained
- timers, action points, save, load, undo, restart and rematch retained

### Board foundation

- larger board sizing
- lighter sage/neutral square palette
- clearer Black and White pieces
- improved movement, capture, placement and selection markers
- visual captured-piece rows using piece glyphs
- defended-King shield removed
- high-contrast board variant retained

### Secondary pages

- Rules rewritten around the actual public product and canonical rules
- Settings reduced to implemented preferences only
- Saved Matches rewritten with player-facing load, import, export and compatibility messages
- README aligned with the current React product, internal compatibility paths and legacy deployment status

## Accessibility requirements

The current redesign preserves or improves:

- semantic buttons and headings
- board grid and grid-cell semantics
- keyboard square activation
- visible focus states
- selected/action states that use shape as well as colour
- reduced-motion support
- high-contrast board support
- screen-reader labels for pieces, squares and defended Kings

## Functionality that must remain unchanged

- canonical movement and capture rules
- action-point rules and King action restriction
- manual placement order and restrictions
- defended-King sacrifice and bounce resolution
- Transform eligibility and timing
- Special Square control and territory claims
- victory precedence
- AI ownership and turn lifecycle
- timers and timeout victory
- undo
- save/load and old-save compatibility
- route protection, PWA and packaging behaviour

## Remaining visual and UX work

### Board-state clarity

- replace the remaining central Special Square symbol with a restrained border/corner treatment
- replace the Transform emblem with a distinct minimal border treatment
- show defended-King attack path, eligible defenders, bounce path and landing square directly on the board
- keep these overlays driven by the existing pending-decision preview data

### Game feel

- movement and capture transitions
- defended-King sacrifice and bounce sequence
- Transform transition
- stronger victory presentation
- move, capture, Transform and victory audio
- mute and volume controls

### Technical/release work

- resolve the Linux/Python CI failure
- improve the computer opponent as a separate project
- expand exact Python/TypeScript parity coverage
- deploy the React artifact instead of the legacy Pygbag build
- verify production routing, persistence and PWA installation

### Later features

- recent completed matches
- match history
- replay and step-through controls
- match statistics

## Validation baseline

The established pre-cleanup baseline is:

- 37 Python tests
- more than 100 web unit tests
- 20 Playwright executions
- successful production build

All visual slices should preserve or increase those totals and must not remove or silently skip existing coverage.
