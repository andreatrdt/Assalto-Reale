# Rules v2: Defended King and Transform relocation

New matches and every newly created rematch use `CURRENT_GAME_RULES_VERSION` (version 2), protocol version 2, replay schema version 2 and browser save schema 3. Rules-v1 saves and schema-v1 immutable replays remain readable and retain the original stop-when-blocked deflection and Transform selection behavior; completed predecessor history is never rewritten when its rematch is created.

The Python reference remains the version-1 compatibility oracle. TypeScript/Python parity fixtures therefore execute rules version 1 explicitly; rules version 2 is shared by local play, AI, the authoritative server and replay through `game-core`.

## Defended King

An Attack Pawn may attack orthogonally at its normal one- or two-square range. At range two, exactly one enemy Defense Pawn may occupy the midpoint only when the target is the King and that pawn is adjacent to the King. It becomes the automatic sacrifice. The midpoint pawn is not a legal ordinary capture from that attacker in this exact position. Other captures are unchanged. Without a midpoint defender, existing adjacent-defender choice remains with the defending player.

Deflection starts at the King impact square in the direction opposite the incoming attack and has a budget of five traversed squares. The attacker origin and the selected sacrifice are empty for routing, so the first route squares may cross them; the King square is the route origin and is never a landing. Every other friendly or enemy piece is an identical obstacle.

At each step:

1. Take an empty primary-direction square.
2. At an occupied square, scan the contiguous obstacle run. If the first empty square beyond it is in bounds and the entire crossing fits the remaining budget, jump it. Occupied crossed squares and the landing each consume one step.
3. If that jump is impossible, construct clockwise and counter-clockwise bypasses. A bypass sidesteps one empty square, advances parallel to the primary direction, returns to the original lane at the first empty lane square, and then resumes the primary direction. Each entered square consumes one step; turning consumes none.
4. A board edge ends that route. Routes may finish short of five squares. If neither direction can leave the origin, the attacker remains at its original square.

A valid jump takes priority over a turn. If both turn directions yield materially different legal routes, both semantic route IDs are returned and the attacker selects one. The command contains only `primary`, `clockwise` or `counterClockwise`; the server recomputes the options and rejects missing, stale or invalid choices. The resolved event contains the route ID, full route, jumped squares, turn squares, sacrifice and landing for animation and replay.

## Board interaction

The first click on a defended King creates a presentation-only projection. It does not mutate canonical state or send an online command. The board shows the solid attack line, shielded King, marked sacrifice, every numbered route step, jump arcs, turn markers and a ghost landing. Route or landing clicks only choose a route. A second King click submits one command. The attacker, another friendly piece, Escape, or unrelated board space cancels according to selection semantics. Reconnect and authoritative rejection clear the projection.

## Transform relocation

In rules version 2, transformation is a separate optional action costing exactly one of the turn's two action tokens. Landing on the square
with a token remaining opens a board-anchored choice to transform or ignore it. Ignore consumes no token and returns to normal play. Landing
with the second token opens no decision, changes no piece and leaves the Transform Square in place. Eligibility is derived canonically from
the current player's pawn occupying the active Transform Square, so a pawn left there can activate the choice on a later turn by selecting
the pawn and square again. `ActivateTransform` opens that authoritative decision; `DeclineTransform` closes it without passing the turn.
Only a successful `ChooseTransform` consumes one token and relocates the square.

After a pawn transforms, legal candidates retain all existing rules: interior, empty, non-Special and equidistant to the nearest opposing pawns. Version 2 keeps only candidates at maximum Chebyshev distance from the consumed Transform Square, then maximum Chebyshev distance from the transformed pawn. The shared seeded generator chooses among remaining row-major ties. Version 1 retains the original seeded choice across all legal candidates.

Rules, replay, protocol and save version constants remain unchanged because rules version 2 has not been merged or deployed. Rules-v1 replay
commands continue through the legacy free/deferred Transform path exactly as recorded; new rules-v2 histories record activation, decline and
the token-costed choice explicitly.

No database migration is required. Rules, protocol and replay versions are already persisted as numeric history metadata, and canonical JSON snapshots now carry `rulesVersion` and `seed` while accepting old snapshots without those fields as version 1.
