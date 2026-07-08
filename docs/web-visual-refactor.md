# Web Visual Refactor Checklist

## Baseline Issues

- Home, Setup, Rules, Load and Settings share theme colors but not a mature application shell or active navigation.
- Setup is a functional form, but it reads as a grid of generic controls rather than a deliberate pre-match configuration table.
- Game route puts the board below a tall top bar; desktop HUDs make the board smaller than it should be, and tablet/mobile place the board too low.
- Text panels are plain and sparse; Rules does not yet feel like a digital rulebook.
- Load and Settings expose implementation limitations, but the states are not presented as polished player-facing experiences.
- Buttons, selected states, badges, clocks, section headers, and panels are duplicated through ad hoc CSS classes.
- Board states exist, but the visual language for Special Squares, legal moves, selected pieces, defended Kings, and faction ownership needs stronger non-color cues.

## Components To Introduce

- `PageShell`, `PageHeader`, `SectionHeader`
- `GameButton`, `IconButton`
- `Panel`, `GameCard`
- `SegmentedControl`, `FormField`, `Toggle`
- `StatusBadge`, `FactionBadge`, `EmptyState`
- `Modal`, `ConfirmDialog`, `Tooltip`

## Routes To Redesign

- `/`: game landing screen with compact identity, immediate New Match action, Continue/Load, Rules and Settings.
- `/setup`: pre-match configuration with grouped sections, faction previews, concise helper text and strong summary/start action.
- `/game`: board-first command table with top status, side/bottom HUD, compact controls and readable messages.
- `/rules`: rulebook layout with contents, sections, and canonical README-aligned explanations.
- `/load`: saved-match card/empty-state experience with schema limitation messaging.
- `/settings`: implemented settings only, grouped by visual/accessibility preferences.

## Board And HUD Improvements

- Make board the central focus on desktop and prevent tablet/mobile from pushing it below all HUD content.
- Add a stronger stone/wood frame, coordinate labels, clearer legal move and capture indicators, and a non-color defended-King shield mark.
- Use faction badges, AP counters, timer slots, captured-piece rows and territory language in the HUD.
- Keep current engine-provided legal targets and placement highlights unchanged.

## Responsive Requirements

- Verify 360x800, 768x1024, 1366x768 and 1920x1080.
- Avoid horizontal scrolling.
- Keep the board readable and touch targets at usable sizes.
- Stack secondary HUD below the board on small screens while keeping current action status above or near the board.

## Accessibility Requirements

- Preserve semantic buttons, headings, fieldsets and board grid cells.
- Keep visible focus states and selected states that do not rely only on color.
- Add clear labels for navigation, setup groups, status badges and modal controls.
- Respect `prefers-reduced-motion`.

## Animation Opportunities

- Short route/page entrance movement.
- Board legal-target reveal and piece hover/selection lift.
- AI thinking pulse.
- Modal fade/scale.
- No animation may delay game logic or recompute game rules.

## Functionality To Preserve

- Existing routes and route guards.
- `MatchConfig`, resolved human/AI side behavior, timer presets and production seed fix.
- Current game store commands and engine state ownership.
- Manual and Quick Balanced start flows.
- AI-owned placement and AI turn wiring.
- Save/load commands, with current schema limitations clearly disclosed.

## Completed In This Slice

- Added a shared presentation layer in `web/src/ui/components.tsx` with buttons, panels, shell navigation, badges, segmented controls, toggles, empty states and confirmation dialogs.
- Added persisted visual/accessibility settings for reduced motion and high-contrast board mode.
- Reworked Home into a game landing screen with a tactical identity, quick actions and non-playable board preview.
- Reworked Setup into grouped pre-match sections with independent `MatchConfig` controls and a sticky summary/start panel.
- Reworked Game into a board-first command table with compact top status, player clocks, side HUDs, command panels, confirmation dialogs and AI-thinking status.
- Improved board presentation with a stronger frame, coordinate labels, clearer legal/capture/placement markers and non-color defended-King shield marks.
- Reworked Rules into a responsive rulebook with contents and README-aligned explanations.
- Reworked Load into a local-save card/empty-state experience with invalid/incomplete save messaging and delete confirmation.
- Reworked Settings to expose only implemented preferences.
- Added server-render presentation tests covering route rendering, setup selected states, game HUD rendering, confirmation dialogs and empty save state.
- Fixed SPA navigation scroll reset so `/game` does not inherit scroll from the Setup route.
- Follow-up UX slice: exposed Save during manual placement because the current save schema includes placement phase, board, cursor, current placement, remaining pieces, clocks and match config; added a store test proving placement save/load resumes the deployment state.
- Follow-up UX slice: added placement save helper copy noting unresolved Defended-King or Transform modal decisions still need fuller serialization before they can safely be saved.
- Release hardening slice: Load now recognizes schema-2 web saves, shows the save schema, exports either the stored local save or the active current match, imports JSON with validation, and keeps schema-1 warnings visible.
- Follow-up UX slice: expanded the Defended-King panel to show attacking pawn, attacked King, eligible defender squares, engine-provided attack path, bounce path, landing square, AP cost, Transform trigger and turn-ending status.
- Follow-up UX slice: Defended-King attacks now enter the preview state even when only one defender is eligible, so the sacrifice is visible before confirmation.
- Follow-up UX slice: added visible Rematch action to victory state, clarified restart/rematch confirmation copy, and disabled restart when no stored match setup exists.

## Remaining Visual/UX Limitations

- Full Defended-King animation still needs engine/store state for ordered animation steps: attack, defender sacrifice, bounce path, landing, optional Transform. The current preview shows available positions and paths but does not animate them.
- Defended-King decision ownership is still inferred from the attacking side in UI copy. The parity work should add explicit `PendingDecision.owner` so AI/human ownership is not inferred from `currentPlayer` or attacker.
- Timer countdown UI is now backed by a monotonic active-human clock with timeout victory, but full Python pause/save/load policy remains release parity work.
- Load cards can now show saved-at metadata and schema for new saves; older schema-1 local saves remain loadable with limitation messaging.
- Victory/rematch now has visible actions and confirmation, but exact rematch lifecycle parity and random-side rematch policy still belong to the match-controller work.
- Audio feedback is not implemented in this slice.

## Screenshot Report

- `docs/web-visual-refactor-screenshots/home.png`
- `docs/web-visual-refactor-screenshots/setup.png`
- `docs/web-visual-refactor-screenshots/game.png`
- `docs/web-visual-refactor-screenshots/rules.png`
- `docs/web-visual-refactor-screenshots/load.png`
- `docs/web-visual-refactor-screenshots/settings.png`
