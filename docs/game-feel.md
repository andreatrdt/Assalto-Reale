# Game feel: presentation, audio and victory

This document describes the presentation layer added for animations, sound and
the victory moment. It does **not** change any game rule, legal-action
generation, AI, save schema, timer semantics or engine parity — the presentation
layer only reads resulting state.

## Presentation-event architecture

The presentation layer is decoupled from the engine. Rather than hooking into
engine internals, it observes the *resulting* store state (which already reflects
accepted canonical actions) and derives sequenced events.

- `src/audio/presentationEvents.ts` — `derivePresentationEvents(prev, next, seq)`
  is a pure function of two `PresentationSnapshot`s. It returns events such as
  `select`, `move`, `capture`, `sacrifice`, `transform`, `turn`, `victory`,
  `defeat`, each with a monotonically increasing `seq`. Being pure, it is fully
  unit-tested (`tests/presentationEvents.test.ts`).
- `src/audio/usePresentationSound.ts` — subscribes to the game store, converts
  each state change into a snapshot, derives events and plays the matching sound.
  It initialises its "previous" snapshot on mount (so nothing fires on entry),
  uses a sequence id so a rerender cannot replay handled events, and cancels its
  subscription on unmount.

Why observe state instead of engine events: it keeps animation/sound layers from
contaminating engine or save state, survives save/load and navigation (a fresh
mount just re-baselines), and is trivially testable.

## Audio system

`src/audio/audioService.ts` is a small singleton that **synthesizes** short tones
with the Web Audio API. There are therefore **no audio files** in the bundle, no
downloads and no third-party/licensed assets — the "asset" is a few oscillator
specs (`SOUND_SPECS`).

- API: `audioService.play(name)`, `setMuted(bool)`, `setVolume(0..1)`, `getState()`.
- Volume is clamped to `[0,1]`; muting is global; rapid duplicates of the same
  sound within ~55 ms are suppressed.
- Fails silently: if Web Audio is unavailable or blocked by autoplay policy,
  `play()` is a no-op and never throws. The `AudioContext` is created lazily and
  resumed on demand, so nothing plays before a user gesture.
- Preferences (`soundEnabled`, `volume`) live in the existing `uiSettings` store
  and are synced to the service in `AppRouter`.

### Adding a new sound

1. Add a `SoundName` and a `SOUND_SPECS` entry (frequency, type, duration, gain).
2. Emit it from `derivePresentationEvents` (or call `audioService.play` directly
   for a UI confirmation).
3. Add/extend a test in `tests/audioService.test.ts` /
   `tests/presentationEvents.test.ts`.

## Audio settings

Settings gains a **Sound** section (`src/pages/SettingsPage.tsx`): a "Sound
effects" toggle and a keyboard-accessible volume slider (0–100%, with a visible
percentage and `aria-valuetext`). Defaults: enabled, 60%. Changing the volume
previews a single short cue on release (not continuously while dragging). No
background music is introduced.

## Victory presentation

`src/pages/VictoryOverlay.tsx` renders a restrained victory moment:

- A subtle vignette dims the board **without hiding the final position**.
- `role="alertdialog"` + `aria-modal`, labelled title/description, plus an
  `aria-live="assertive"` announcement for screen readers.
- Title "Victory" / "Defeat" (defeat only when the local human lost vs the
  computer) and a sentence built from canonical outcome data via the pure
  `describeOutcome()` (king capture / territory / timeout) — outcomes are never
  hard-coded.
- Actions: Rematch, New Match, Save, Home. Escape deliberately reveals the final
  board ("View final board") rather than leaving the match.

## Reduced motion

All animations respect the existing reduced-motion setting and
`prefers-reduced-motion`: the global catch-all in `styles/global.css`
(`html[data-motion="reduced"] *` and the media query) neutralises transition and
animation durations, so the victory entrance, marker fades and turn-transition
emphasis collapse to immediate, readable state changes. No critical state is
conveyed by motion or sound alone (turn/AP/timer/status remain textual; victory
is announced).

## Restrained visual feedback

- Selection / legal-action markers fade in once on appearance (they only mount
  when a piece is selected; React preserves them across the per-tick rerenders,
  so the fade does not flicker).
- Turn transition: the active clock/status gains emphasis and the inactive clock
  recedes (opacity) via CSS transitions on persistent elements.

### Deliberately deferred: piece-translate animation

A full source→destination *translate* of moving/captured pieces is **not**
included in this slice. The board renders pieces by grid position without a
stable per-piece identity across renders, so a robust FLIP/overlay translate is a
larger, board-coupled change that is hard to verify frame-accurately. The
presentation-event layer already provides the hook points (`move` / `capture` /
`sacrifice` / `transform` events with squares), so a later slice can add an
SVG-internal overlay that animates a temporary piece between cells and suppresses
the destination cell during the tween — without touching engine timing.

## Testing animations deterministically

Tests assert observable outcomes, not timing:

- Pure functions (`derivePresentationEvents`, `describeOutcome`, `clampVolume`,
  `shouldPlay`) are unit-tested directly.
- The audio service is tested with an injected mock `AudioContext`
  (`_setContextFactory`) to assert mute/volume/dedupe without real audio.
- The victory overlay is asserted via server-render (roles, announcement, copy).
- Playwright covers audio-setting persistence and reduced-motion application
  without arbitrary sleeps (`expect.poll` / observable state).
