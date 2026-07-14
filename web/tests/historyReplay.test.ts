import { describe, expect, it } from "vitest";
import {
  GAME_RULES_VERSION,
  REPLAY_SCHEMA_VERSION,
  applyCommand,
  canPlacePiece,
  createMatch,
  getLegalActions,
  getPiece,
  replayHistoricalMatch,
  serializeState,
  type CreateMatchOptions,
  type HistoricalCommandV1,
  type HistoricalReplayEventV1,
  type HistoricalReplayInput,
  type MatchState,
  type PawnType,
  type Player,
  type Vec2,
} from "../../packages/game-core/src/index.js";

function key(position: Vec2): string {
  return `${position[0]},${position[1]}`;
}

function distance(left: Vec2, right: Vec2): number {
  return Math.max(Math.abs(left[0] - right[0]), Math.abs(left[1] - right[1]));
}

function actorFor(state: MatchState, command: HistoricalCommandV1): Player {
  if (command.type === "ChooseDefender" || command.type === "CancelDefendedKing") {
    return state.pendingDefendedKing?.owner ?? state.currentPlayer;
  }
  if (command.type === "ChooseTransform" || command.type === "DeclineTransform") {
    return state.pendingTransform?.owner ?? state.currentPlayer;
  }
  return state.currentPlayer;
}

class ReplayRecorder {
  readonly events: HistoricalReplayEventV1[] = [];
  state: MatchState;

  constructor(readonly options: CreateMatchOptions) {
    this.state = createMatch(options);
  }

  command(command: HistoricalCommandV1): void {
    const actorSide = actorFor(this.state, command);
    this.events.push({
      sequenceNumber: this.events.length + 1,
      actorSide,
      payload: { schemaVersion: this.options.rulesVersion === 1 ? 1 : REPLAY_SCHEMA_VERSION, command },
    });
    if (command.type === "Resign") return;
    const result = applyCommand(this.state, command);
    if (!result.ok) throw new Error(`${command.type} was not legal: ${result.error.message}`);
    this.state = result.state;
  }

  input(overrides: Partial<HistoricalReplayInput> = {}): HistoricalReplayInput {
    return {
      rulesVersion: this.options.rulesVersion ?? GAME_RULES_VERSION,
      replaySchemaVersion: this.options.rulesVersion === 1 ? 1 : REPLAY_SCHEMA_VERSION,
      seed: this.options.seed,
      placementMode: this.options.placementMode,
      transformEnabled: this.options.transformEnabled ?? false,
      events: this.events,
      ...overrides,
    };
  }
}

function firstLegalPlacement(state: MatchState, reserved: Set<string>): Vec2 {
  const item = state.currentPlacement;
  if (!item) throw new Error("No placement is pending.");
  for (let row = 0; row < state.board.config.rows; row += 1) {
    for (let col = 0; col < state.board.config.cols; col += 1) {
      const position: Vec2 = [row, col];
      if (!reserved.has(key(position)) && canPlacePiece(state.board, position, item.player, item.pieceType).ok) return position;
    }
  }
  throw new Error(`No filler placement for ${item.player} ${item.pieceType}.`);
}

function manualScenario(
  seed: number,
  desired: Partial<Record<`${Player}:${"King" | PawnType}`, Vec2[]>>,
  reservedPositions: Vec2[],
): ReplayRecorder {
  const recorder = new ReplayRecorder({ placementMode: "Manual", transformEnabled: false, seed });
  const remaining = Object.fromEntries(Object.entries(desired).map(([name, positions]) => [name, [...(positions ?? [])]])) as Record<
    string,
    Vec2[]
  >;
  const reserved = new Set(reservedPositions.map(key));
  while (recorder.state.phase === "placement") {
    const item = recorder.state.currentPlacement!;
    const positions = remaining[`${item.player}:${item.pieceType}`];
    const position = positions?.shift() ?? firstLegalPlacement(recorder.state, reserved);
    if (!canPlacePiece(recorder.state.board, position, item.player, item.pieceType).ok) {
      throw new Error(`Desired placement ${key(position)} is not legal for ${item.player} ${item.pieceType}.`);
    }
    recorder.command({ type: "PlacePiece", position });
  }
  return recorder;
}

function combatScenario(defended: boolean): ReplayRecorder {
  const path: Vec2[] = [
    [5, 1],
    [5, 2],
    [5, 3],
    [5, 4],
    [5, 5],
    [5, 6],
    [5, 7],
    [5, 8],
  ];
  const whiteKingZone: Vec2[] = [];
  for (let row = 4; row <= 6; row += 1) {
    for (let col = 5; col <= 7; col += 1) whiteKingZone.push([row, col]);
  }
  const defender: Vec2 = [4, 6];
  const recorder = manualScenario(
    1,
    {
      "Black:King": [[10, 1]],
      "White:King": [[5, 6]],
      "Black:AttackPawn": [[5, 1]],
      ...(defended ? { "White:DefensePawn": [defender] } : {}),
    },
    [...path, ...whiteKingZone, [10, 1], ...(defended ? [defender] : [])],
  );
  recorder.command({ type: "SubmitAction", start: [5, 1], end: [5, 2] });
  recorder.command({ type: "SubmitAction", start: [5, 2], end: [5, 3] });
  recorder.command({ type: "PassTurn" });
  recorder.command({ type: "SubmitAction", start: [5, 3], end: [5, 4] });
  recorder.command({ type: "PassTurn" });
  recorder.command({ type: "PassTurn" });
  recorder.command({ type: "SubmitAction", start: [5, 4], end: [5, 6] });
  if (defended) recorder.command({ type: "ChooseDefender", position: defender });
  return recorder;
}

function transformScenario(rulesVersion: 1 | 2 = 2): ReplayRecorder {
  const recorder = new ReplayRecorder({ placementMode: "QuickBalanced", transformEnabled: true, seed: 2, rulesVersion });
  for (let index = 0; index < 20; index += 1) recorder.command({ type: "PassTurn" });
  const target = recorder.state.board.transformSquares[0];
  if (!target) throw new Error("Transform Square was not generated.");
  for (let guard = 0; !recorder.state.pendingTransform && guard < 20; guard += 1) {
    if (recorder.state.currentPlayer === "White") {
      recorder.command({ type: "PassTurn" });
      continue;
    }
    const action = getLegalActions(recorder.state)
      .filter(
        (candidate) =>
          candidate.kind === "move" && candidate.start && candidate.end && getPiece(recorder.state.board, candidate.start)?.type !== "King",
      )
      .sort((left, right) => distance(left.end!, target) - distance(right.end!, target))[0];
    if (!action?.start || !action.end) throw new Error("No pawn can approach the Transform Square.");
    if (rulesVersion === 2 && distance(action.end, target) === 0 && recorder.state.movesThisTurn === 1) {
      recorder.command({ type: "PassTurn" });
      continue;
    }
    recorder.command({ type: "SubmitAction", start: action.start, end: action.end });
  }
  const originalType = recorder.state.pendingTransform?.pieceType;
  const transformPosition = recorder.state.pendingTransform?.pos;
  if (!originalType) throw new Error("Transform decision was not reached.");
  if (!transformPosition) throw new Error("Transform position was not recorded.");
  const newType: PawnType = originalType === "AttackPawn" ? "DefensePawn" : "AttackPawn";
  if (rulesVersion === 1) {
    recorder.command({ type: "ChooseTransform", newType });
    return recorder;
  }
  recorder.command({ type: "DeclineTransform" });
  recorder.command({ type: "PassTurn" });
  recorder.command({ type: "PassTurn" });
  recorder.command({ type: "ActivateTransform", position: transformPosition });
  recorder.command({ type: "ChooseTransform", newType });
  return recorder;
}

interface TerritoryPlan {
  starts: Vec2[];
  paths: Vec2[][];
}

function territoryPlan(seed: number): TerritoryPlan {
  const initial = createMatch({ placementMode: "Manual", transformEnabled: false, seed });
  const occupied = new Set<string>();
  const paths: Vec2[][] = [];
  for (const target of initial.board.specialSquares) {
    let selected: Vec2[] | null = null;
    for (let row = 0; row < initial.board.config.rows && !selected; row += 1) {
      for (let col = 0; col < initial.board.config.cols && !selected; col += 1) {
        const start: Vec2 = [row, col];
        if (distance(start, target) !== 3 || !canPlacePiece(initial.board, start, "Black", "ConquestPawn").ok) continue;
        const path: Vec2[] = [start];
        let current = start;
        while (distance(current, target) > 0) {
          current = [current[0] + Math.sign(target[0] - current[0]), current[1] + Math.sign(target[1] - current[1])];
          path.push(current);
        }
        if (path.some((position) => occupied.has(key(position)))) continue;
        if (path.slice(0, -1).some((position) => initial.board.specialSquares.some((special) => key(special) === key(position)))) continue;
        selected = path;
      }
    }
    if (!selected) continue;
    paths.push(selected);
    selected.forEach((position) => occupied.add(key(position)));
    if (paths.length === 3) break;
  }
  if (paths.length !== 3) throw new Error("Could not construct three disjoint territory paths.");
  return { starts: paths.map((path) => path[0]!), paths };
}

function territoryScenario(): ReplayRecorder {
  const seed = 1;
  const plan = territoryPlan(seed);
  const recorder = manualScenario(seed, { "Black:ConquestPawn": plan.starts }, plan.paths.flat());
  for (const path of plan.paths) {
    recorder.command({ type: "SubmitAction", start: path[0]!, end: path[1]! });
    recorder.command({ type: "SubmitAction", start: path[1]!, end: path[2]! });
    recorder.command({ type: "PassTurn" });
    recorder.command({ type: "SubmitAction", start: path[2]!, end: path[3]! });
    recorder.command({ type: "PassTurn" });
    if (!recorder.state.victory) recorder.command({ type: "PassTurn" });
  }
  if (!recorder.state.board.territoryClaim) throw new Error("Territory claim was not created.");
  while (!recorder.state.victory) recorder.command({ type: "PassTurn" });
  return recorder;
}

describe("immutable history replay", () => {
  it("replays valid placement from the canonical genesis", () => {
    const recorder = new ReplayRecorder({ placementMode: "Manual", seed: 7 });
    recorder.command({ type: "PlacePiece", position: [0, 0] });
    const replay = replayHistoricalMatch(recorder.input());
    expect(replay).toMatchObject({ ok: true });
    if (replay.ok) expect(getPiece(replay.frames[1]!.state.board, [0, 0])).toEqual({ player: "Black", type: "King" });
  });

  it("replays movement and reconstructs deterministic intermediate frames", () => {
    const recorder = combatScenario(false);
    const first = replayHistoricalMatch(recorder.input());
    const second = replayHistoricalMatch(recorder.input());
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      const movementFrame = first.frames.find((frame) => frame.command?.type === "SubmitAction" && frame.state.movesThisTurn === 1)!;
      expect(getPiece(movementFrame.state.board, [5, 2])).toEqual({ player: "Black", type: "AttackPawn" });
      expect(serializeState(movementFrame.state)).toBe(serializeState(second.frames[movementFrame.sequenceNumber]!.state));
    }
  });

  it("replays a capture and exactly matches the stored terminal state", () => {
    const recorder = combatScenario(false);
    expect(recorder.state.victory).toMatchObject({ winner: "Black", reason: "king_capture" });
    const replay = replayHistoricalMatch(recorder.input());
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      const final = replay.frames.at(-1)!;
      expect(final.events.some((event) => event.type === "MatchEnded")).toBe(true);
      expect(final.terminal).toMatchObject({ winner: "Black", loser: "White", reason: "king_capture" });
      expect(serializeState(final.state)).toBe(serializeState(recorder.state));
    }
  });

  it("replays the Defended King sacrifice and bounce decision", () => {
    const replay = replayHistoricalMatch(combatScenario(true).input());
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      const decision = replay.frames.find((frame) => frame.state.phase === "defenderSelection");
      const resolved = replay.frames.at(-1)!;
      expect(decision?.state.pendingDefendedKing?.owner).toBe("White");
      expect(
        resolved.events.some((event) => event.type === "ActionApplied" && event.transition.events.some((item) => item.kind === "bounce")),
      ).toBe(true);
      expect(resolved.state.board.capturedPieces.White.DefensePawn).toBe(1);
      const applied = resolved.events.find((event) => event.type === "ActionApplied");
      expect(applied?.type === "ActionApplied" ? applied.transition.events[0]?.data.route_id : null).toBe("primary");
    }
  });

  it("keeps schema-v1 rules-v1 replays readable without reinterpretation", () => {
    const replay = replayHistoricalMatch({
      rulesVersion: 1,
      replaySchemaVersion: 1,
      seed: 4,
      placementMode: "QuickBalanced",
      transformEnabled: false,
      events: [{ sequenceNumber: 1, actorSide: "Black", payload: { schemaVersion: 1, command: { type: "PassTurn" } } }],
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.frames[0]?.state.rulesVersion).toBe(1);
      expect(replay.frames.at(-1)?.state.currentPlayer).toBe("White");
    }
  });

  it("replays decline and delayed transformation deterministically", () => {
    const recorder = transformScenario();
    const first = replayHistoricalMatch(recorder.input());
    const second = replayHistoricalMatch(recorder.input());
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.frames.some((frame) => frame.command?.type === "DeclineTransform" && frame.state.phase === "playing")).toBe(true);
      expect(first.frames.some((frame) => frame.command?.type === "ActivateTransform" && frame.state.phase === "transformSelection")).toBe(
        true,
      );
      expect(
        first.frames
          .at(-1)!
          .events.some((event) => event.type === "ActionApplied" && event.transition.events.some((item) => item.kind === "transform")),
      ).toBe(true);
      expect(serializeState(first.frames.at(-1)!.state)).toBe(serializeState(recorder.state));
      expect(serializeState(second.frames.at(-1)!.state)).toBe(serializeState(first.frames.at(-1)!.state));
    }
  });

  it("keeps a rules-v1 Transform replay on its recorded legacy path", () => {
    const recorder = transformScenario(1);
    const input = recorder.input();
    const encoded = JSON.stringify(input);
    const first = replayHistoricalMatch(input);
    const second = replayHistoricalMatch(JSON.parse(encoded) as HistoricalReplayInput);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.frames[0]?.state.rulesVersion).toBe(1);
      expect(first.frames.some((frame) => frame.command?.type === "ChooseTransform")).toBe(true);
      expect(first.frames.some((frame) => frame.command?.type === "ActivateTransform" || frame.command?.type === "DeclineTransform")).toBe(
        false,
      );
      expect(serializeState(first.frames.at(-1)!.state)).toBe(serializeState(recorder.state));
      expect(second).toEqual(first);
    }
    expect(JSON.stringify(input)).toBe(encoded);
  });

  it("replays territory-claim creation through terminal maturity", () => {
    const recorder = territoryScenario();
    const replay = replayHistoricalMatch(recorder.input());
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.frames.some((frame) => frame.state.board.territoryClaim?.claimant === "Black")).toBe(true);
      expect(replay.frames.at(-1)!.terminal).toMatchObject({ winner: "Black", reason: "territory" });
      expect(serializeState(replay.frames.at(-1)!.state)).toBe(serializeState(recorder.state));
    }
  });

  it("represents resignation as a terminal historical event", () => {
    const recorder = new ReplayRecorder({ placementMode: "QuickBalanced", seed: 4 });
    recorder.events.push({
      sequenceNumber: 1,
      actorSide: "White",
      payload: { schemaVersion: REPLAY_SCHEMA_VERSION, command: { type: "Resign" } },
    });
    const replay = replayHistoricalMatch(recorder.input());
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.frames.at(-1)!.terminal).toEqual({ winner: "Black", loser: "White", reason: "resignation" });
  });

  it("rejects unsupported replay and rules versions", () => {
    const recorder = new ReplayRecorder({ placementMode: "QuickBalanced", seed: 1 });
    expect(replayHistoricalMatch(recorder.input({ replaySchemaVersion: 99 }))).toMatchObject({
      ok: false,
      code: "unsupported_replay_schema",
    });
    expect(replayHistoricalMatch(recorder.input({ rulesVersion: 99 }))).toMatchObject({ ok: false, code: "unsupported_rules_version" });
  });

  it("rejects sequence gaps, incompatible event schemas, and invalid actors", () => {
    const event = (
      sequenceNumber: number,
      actorSide: Player | null,
      schemaVersion: number = REPLAY_SCHEMA_VERSION,
    ): HistoricalReplayEventV1 => ({
      sequenceNumber,
      actorSide,
      payload: { schemaVersion, command: { type: "PassTurn" } },
    });
    const base = new ReplayRecorder({ placementMode: "QuickBalanced", seed: 1 }).input();
    expect(replayHistoricalMatch({ ...base, events: [event(2, "Black")] })).toMatchObject({ ok: false, code: "invalid_replay" });
    expect(replayHistoricalMatch({ ...base, events: [event(1, "Black", 7)] })).toMatchObject({ ok: false, code: "invalid_replay" });
    expect(replayHistoricalMatch({ ...base, events: [event(1, "White")] })).toMatchObject({ ok: false, code: "invalid_replay" });
    expect(replayHistoricalMatch({ ...base, events: [event(1, null)] })).toMatchObject({ ok: false, code: "invalid_replay" });
  });

  it("rejects illegal historical commands", () => {
    const recorder = new ReplayRecorder({ placementMode: "QuickBalanced", seed: 1 });
    recorder.events.push({
      sequenceNumber: 1,
      actorSide: "Black",
      payload: { schemaVersion: REPLAY_SCHEMA_VERSION, command: { type: "SubmitAction", start: [11, 11], end: [11, 10] } },
    });
    expect(replayHistoricalMatch(recorder.input())).toMatchObject({ ok: false, code: "invalid_replay" });
  });

  it("rejects commands appended after a terminal resignation", () => {
    const recorder = new ReplayRecorder({ placementMode: "QuickBalanced", seed: 1 });
    recorder.command({ type: "Resign" });
    recorder.events.push({
      sequenceNumber: 2,
      actorSide: "Black",
      payload: { schemaVersion: REPLAY_SCHEMA_VERSION, command: { type: "PassTurn" } },
    });
    expect(replayHistoricalMatch(recorder.input())).toMatchObject({ ok: false, code: "invalid_replay" });
  });
});
