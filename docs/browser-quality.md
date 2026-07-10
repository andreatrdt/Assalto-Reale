# Browser-quality contract

This phase hardens the web client's behaviour **in the browser**: accessibility,
keyboard and focus, cross-browser parity, responsive layout, reduced-motion and
high-contrast handling, PWA/offline, runtime teardown (AI pacing and stale board
animations), and save import/export through the real UI.

No gameplay rules, AI search, timer semantics or the visual design language were
changed. Source changes are limited to accessibility robustness (ARIA structure,
one form label, an Escape affordance on dismissible modals), a WCAG-AA tune of
the neutral text ramp, additive forced-colors / prefers-contrast CSS, and the
removal of a dead module.

## Test suites

All e2e specs live in `web/tests/e2e/`.

| Spec | Covers |
| --- | --- |
| `a11y.spec.ts` | axe on every primary route + an active match (blocking gate) |
| `keyboard.spec.ts` | Tab order, focus visibility, Enter/Space activation, Escape semantics |
| `motion-contrast.spec.ts` | forced-colors (blocking), prefers-contrast, reduced-motion CSS contract |
| `responsive.spec.ts` | desktop / tablet (portrait+landscape) / mobile, no horizontal scroll |
| `pwa.spec.ts` | service worker reaches `activated`, manifest + icons, offline shell |
| `save-io.spec.ts` | export download + real `<input type=file>` import + invalid-import error |
| `ai-cancellation.spec.ts` | leaving a match tears down the paced AI loop cleanly |
| `lifecycle.spec.ts` | explicit-save → reload → restore; no silent auto-save |
| `cross-browser.spec.ts` | small Firefox + WebKit smoke suite |
| `visual.spec.ts` | Chromium-only pixel regression (Linux baselines) |

## Accessibility

`a11y.spec.ts` runs axe-core (WCAG 2.0/2.1 A + AA) and **fails on any `serious`
or `critical` violation**. Fixes made to clear the baseline:

- Board `role="grid"` now wraps each rank in a `role="row"` group; the capture
  table on `/rules` gained `role="cell"` on its data cells (ARIA required
  parent/children).
- The import `<input type="file">` on `/load` gained an `aria-label`.
- The neutral text ramp (`--text-muted`, `--text-faint`) was darkened to meet
  4.5:1 on the darkest surface it is painted on, and the inactive player-clock
  de-emphasis moved from `opacity` (which dropped text below the contrast floor)
  to a colour/border treatment.

## Board keyboard interaction model

**Supported**

- Every square is a `role="gridcell"` with `tabIndex=0`. `Tab` / `Shift+Tab`
  moves focus square to square; the focused square shows a thick focus ring.
- `Enter` or `Space` activates the focused square (place / select / move), the
  same action as a click.
- All controls (buttons, links, inputs) are reachable by `Tab` with a visible
  `:focus-visible` outline.
- `Escape` dismisses genuinely dismissible dialogs only: the `Modal`/
  `ConfirmDialog` (e.g. "Leave match") and the `VictoryOverlay`.

**Intentionally NOT supported (documented limitation)**

- Arrow-key roving-tabindex grid navigation. The board uses one tab stop per
  square rather than arrow-key roaming; this is a known follow-up.
- The inline **Transform** and **Defended-King** decision panels are not
  dismissible and have no `Escape` path by design — a pending decision cannot be
  bypassed from the keyboard.

## Motion and contrast

- **Reduced motion** (`prefers-reduced-motion: reduce`) is neutralised by a
  global catch-all (`transition/animation-duration: 1ms`) and the board-motion
  controller reveals final state immediately. Behavioural coverage lives in
  `board-motion.spec.ts` / `game-feel.spec.ts`; the CSS contract is pinned in
  `motion-contrast.spec.ts`.
- **Forced colors** (`forced-colors: active`, Windows High Contrast) is a
  **blocking** contract: controls keep a system-coloured border, focus shows a
  `Highlight` outline, and board state cues (focus, selection, placement/legal
  targets) are re-expressed with system colours instead of brand fills.
- **Increased contrast** (`prefers-contrast: more`) darkens the text ramp and
  firms up borders. Covered but not a hard gate.

## Cross-browser policy

Chromium (plus a Pixel-5 mobile profile) runs the full functional + quality
suite. Firefox and WebKit run only the `cross-browser.spec.ts` smoke suite, in a
dedicated CI job (`web-e2e-cross-browser`). This keeps the matrix cheap and
stable while still proving the core journeys on all three engines.

## Visual regression

`visual.spec.ts` is Chromium-only, with tight per-assertion tolerances (no
permissive global `maxDiffPixelRatio`), animations frozen, and volatile regions
avoided/masked. Baselines are **Linux-only** and must be generated inside the
Playwright container so CI rendering is pixel-identical:

```bash
# from the repo root, one-time (and whenever an intended visual change lands):
docker run --rm --ipc=host -v "$PWD/web":/work -w /work \
  mcr.microsoft.com/playwright:v1.61.1-noble \
  sh -c "npm ci && npm run e2e:update-snapshots"
# then commit web/tests/e2e/visual.spec.ts-snapshots/
```

The CI `web-visual` job runs in the same container. Until baselines are
committed it emits a warning and skips the comparison (so it never blocks on a
missing baseline); once `tests/e2e/visual.spec.ts-snapshots/` exists it enforces.

## PWA and offline

`pwa.spec.ts` runs against the production preview, waits for the service worker
to reach `activated`, and asserts: the manifest is linked and served, every
declared icon resolves, and after caching the shell the app still renders with
the network offline. Contexts are per-test, so cache and storage stay isolated.

## Persistence policy (unchanged)

Saving is **explicit only** (the Save control / import). Backgrounding, hiding,
or unloading the tab does not auto-save; `lifecycle.spec.ts` asserts an unsaved
match is gone after a reload. Full bfcache restore and realistic mobile process
suspension are **not** covered here — they are documented limitations to avoid
fragile tests, tracked as follow-ups.

## Documented limitations

- Arrow-key grid navigation on the board (see keyboard model).
- bfcache back/forward restore and realistic mobile process suspension.
- An exhaustive viewport matrix — a small, stable set is used instead.
- Visual baselines require a one-time Docker seed (above).
