import type {
  Action,
  BoardState,
  DefendedKingPreview,
  PawnType,
  PieceType,
  Player,
  TransitionResult,
  Vec2,
  VictoryResult,
} from "./types.js";
import type { PythonBoardSnapshot } from "./serialization.js";

export type MatchPhase = "placement" | "playing" | "defenderSelection" | "transformSelection" | "gameOver";
export type PlacementMode = "Manual" | "QuickBalanced";

export type PiecesLeft = Record<Player, Record<PieceType, number>>;

export interface PendingPlacement {
  player: Player;
  pieceType: PieceType;
}

export interface PendingTransform {
  owner: Player;
  pos: Vec2;
  player: Player;
  pieceType: PawnType;
  forceTurnSwitch: boolean;
}

export interface PendingDefendedKing {
  owner: Player;
  action: Action;
  preview: DefendedKingPreview;
  defenders: Vec2[];
}

export type PendingDecision = { kind: "defendedKing"; value: PendingDefendedKing } | { kind: "transform"; value: PendingTransform };

export interface MatchState {
  rulesVersion: 1 | 2;
  seed: number;
  board: BoardState;
  phase: MatchPhase;
  currentPlayer: Player;
  movesThisTurn: number;
  kingMoved: boolean;
  turnCounter: number;
  placementCursor: number;
  currentPlacement: PendingPlacement | null;
  piecesLeft: PiecesLeft;
  pendingDefendedKing: PendingDefendedKing | null;
  pendingTransform: PendingTransform | null;
  victory: VictoryResult | null;
}

export interface CreateMatchOptions {
  placementMode: PlacementMode;
  transformEnabled?: boolean;
  seed: number;
  rulesVersion?: 1 | 2;
}

export type GameCommand =
  | { type: "PlacePiece"; position: Vec2 }
  | { type: "SubmitAction"; start: Vec2; end: Vec2; routeId?: import("./types.js").DeflectionRouteId }
  | { type: "ChooseDefender"; position: Vec2 }
  | { type: "CancelDefendedKing" }
  | { type: "ChooseTransform"; newType: PawnType }
  | { type: "PassTurn" };

export type MatchEvent =
  | { type: "PiecePlaced"; player: Player; pieceType: PieceType; position: Vec2 }
  | { type: "ActionApplied"; action: Action; transition: TransitionResult }
  | { type: "DecisionRequired"; decision: PendingDecision }
  | { type: "DecisionCancelled"; decision: "defendedKing" }
  | { type: "TurnChanged"; player: Player; turnCounter: number }
  | { type: "MatchEnded"; victory: VictoryResult };

export interface CommandError {
  code: "wrong_phase" | "illegal_placement" | "illegal_action" | "wrong_player" | "decision_required" | "invalid_decision" | "match_over";
  message: string;
}

export type CommandResult =
  | {
      ok: true;
      command: GameCommand;
      state: MatchState;
      events: MatchEvent[];
      action?: Action;
      transition?: TransitionResult;
    }
  | {
      ok: false;
      command: GameCommand;
      state: MatchState;
      events: [];
      error: CommandError;
    };

export interface MatchSnapshot {
  schema: 1;
  rulesVersion?: 1 | 2;
  seed?: number;
  board: PythonBoardSnapshot;
  phase: MatchPhase;
  currentPlayer: Player;
  movesThisTurn: number;
  kingMoved: boolean;
  turnCounter: number;
  placementCursor: number;
  currentPlacement: PendingPlacement | null;
  piecesLeft: PiecesLeft;
  pendingDefendedKing: PendingDefendedKing | null;
  pendingTransform: PendingTransform | null;
  victory: VictoryResult | null;
}
