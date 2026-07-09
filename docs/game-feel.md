# Game feel: presentation, audio and board motion

This document describes the presentation layer for board motion, sound and the
victory moment. It does **not** change any game rule, legal-action generation,
AI scoring, save schema, timer semantics or engine parity — the presentation
layer only reads resulting state.

## Presentation-event architecture

The presentation layer is decoupled from the engine. Rather than hooking into
engine internals, it observes the *resulting* store state (which already reflects
accepted canonical actions) and derives sequenced events.

- `src/audio/presentationEvents.ts` — `derivePresentationEvents(prev, next, seq)`
  is a pure function of two `PresentationSnapshot`s. It returns events such as
  `select`, `move`, `capture`, `sacrifice`, `transform`, `turn`, `victory`,
  `defeat`, each with a monotonically increasing `seq`.
- `src/audio/usePresentationSound.ts` — subscribes to the game store, converts
  each state change into a snapshot, derives events and plays the matching sound.
  It initialises its previous snapshot on mount, so nothing fires on entry, and
  cancels its subscription on unmount.
- `src/board/boardMotion.ts` — compares the previous and next authoritative
  boards and derives one visual motion draft: move, capture, placement,
  defended-King or Transform. The pure derivation is independent of React and is
  covered by deterministic unit tests.
- `src/board/useBoardMotion.ts` — turns drafts into short, sequenced visual events
  with stable IDs, a deliberately bounded queue and cancellation on unmount,
  undo, load and state restoration.

Observing state keeps animation and sound out of engine and save data. A fresh
mount re-baselines instead of replaying old actions.

## Board-motion rendering

`src/board/GameBoard.tsx` remains the authoritative board renderer. During a
motion event it temporarily suppresses only the already-committed destination
piece and draws an SVG overlay above the board:

- **Move:** an overlay copy travels from source to destination, then the
  authoritative destination piece is revealed.
- **Capture:** the target contracts/fades while the attacker travels; the
  captured counter still comes solely from canonical board state.
- **Placement:** the newly placed piece receives a short fade-and-settle.
- **Defended King:** the attacker approaches the King, the selected Defense Pawn
  is emphasised and removed, and the attacker continues to the canonical landing
  square. The squares come from accepted action context/resulting state; the
  renderer never invents a bounce destination.
- **Transform:** the Transform square activates subtly, the old silhouette fades,
  and the canonical resulting piece appears.

The board uses its fixed SVG viewBox coordinate system (`cell = viewBoxSize /
rows`), so motion scales automatically with desktop/mobile rendering and browser
resizes. `squareDelta()` also defines flipped-coordinate mapping for a future
flipped-board view; the current UI renders in canonical orientation.

Only board-cell activation is ignored while an overlay is active, preventing a
duplicate action. Navigation and surrounding match controls remain available.
The authoritative engine transition is never delayed or mutated. Test hooks are
exposed on the SVG as `data-animation-state`, `data-animation-id` and
`data-animation-type`.

## Cancellation and concurrency

The controller subscribes once to the Zustand game store, assigns increasing
motion IDs and clears timers/subscriptions on unmount. It cancels immediately
when it recognises undo, load/import, new deployment or a large restored-state
delta. The queue is capped to prevent stale visual work. Existing AI pacing is
longer than ordinary movement animation, so AI actions remain visually ordered
without changing AI computation or turn timing.

## Audio system

`src/audio/audioService.ts` is a small singleton that **synthesizes** short tones
with the Web Audio API. There are therefore **no audio files** in the bundle, no
downloads and no third-party/licensed assets.

- API: `audioService.play(name)`, `setMuted(bool)`, `setVolume(0..1)`, `getState()`.
- Volume is clamped to `[0,1]`; muting is global; rapid duplicates of the same
  sound within about 55 ms are suppressed.
- If Web Audio is unavailable or blocked by autoplay policy, playback is a no-op
  and never blocks gameplay.
- Preferences (`soundEnabled`, `volume`) live in the existing `uiSettings` store
  and are synced to the service in `AppRouter`.

### Adding a new sound

1. Add a `SoundName` and a `SOUND_SPECS` entry.
2. Emit it from `derivePresentationEvents`, or call the service directly for a
   UI confirmation.
3. Extend the audio and presentation-event tests.

## Audio settings

Settings contains a Sound section with an accessible on/off control and volume
slider. Defaults are enabled and 60%. Volume previews once on release. No
background music is introduced.

## Victory presentation

`src/pages/VictoryOverlay.tsx` renders a restrained victory moment:

- a vignette dims but preserves the final board;
- `role="alertdialog"`, labels and an assertive announcement support assistive
  technology;
- title and reason are derived from canonical outcome data;
- actions include Rematch, New Match, Save and Home;
- Escape deliberately reveals the final board.

## Reduced motion

Board motion respects both the stored reduced-motion setting and
`prefers-reduced-motion`. Translations and bounce-like sequencing collapse to a
short opacity presentation; switching reduced motion on cancels an active
translation and reveals authoritative state immediately. The global catch-all in
`styles/global.css` also shortens transitions. No critical information is
communicated through animation or sound alone.

## Restrained visual feedback

- Selection and legal-action markers fade in once on appearance.
- The active clock/status receives emphasis while the inactive clock recedes.
- Board sequences use only transforms, opacity and small restrained highlights;
  no particles, confetti or animation library is introduced.

## Testing animations deterministically

Tests assert data and observable lifecycle markers rather than frame timing:

- `tests/boardMotion.test.ts` covers coordinate mapping, normal/flipped deltas,
  movement, capture, placement, Transform, defended-King resolution, AI direct
  resolution, cancellation and reduced-motion duration bounds.
- Audio and victory tests continue to use pure functions and injected browser
  APIs.
- Browser checks can wait for `data-animation-state="running"` and then `idle`
  rather than sleeping for an arbitrary duration.
