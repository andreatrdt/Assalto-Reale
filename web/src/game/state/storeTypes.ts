// Shared state/action shapes for the game store and its controllers. Splitting
// GameState (authoritative data) from GameActions (the command surface) lets the
// controller modules type against the data slice without depending on the store.
import type { PhaseState } from "../../app/phases";
import type { MatchConfig } from "../setup/matchConfig";
import type { Action, BoardState, DefendedKingPreview, PawnType, PieceType, Player, Vec2, toPythonSnapshot } from "../engine";

export type PiecesLeft = Record<Player, Record<PieceType, number>>;
export type PendingPlacement = { player: Player; pieceType: PieceType };
export type PendingTransform = { owner: Player; pos: Vec2; player: Player; pieceType: PawnType; forceTurnSwitch: boolean };
export type PendingDefendedKing = { owner: Player; action: Action; preview: DefendedKingPreview; defenders: Vec2[] };

export interface HistoryEntry {
  board: BoardState;
  currentPlayer: Player;
  movesThisTurn: number;
  kingMoved: boolean;
  turnCounter: number;
  placementCursor: number;
  currentPlacement: PendingPlacement | null;
  piecesLeft: PiecesLeft;
  phase: PhaseState;
  lastAction: string;
  message: string;
  pendingTransform: PendingTransform | null;
  pendingDefendedKing: PendingDefendedKing | null;
  timeLeft: Record<Player, number>;
}

export interface StartMatchOptions {
  transformEnabled?: boolean;
  aiEnabled?: boolean;
  aiPlayer?: Player;
  seed?: number;
}

export interface SavedGame {
  schema: 1 | 2;
  appVersion?: string;
  savedAt?: string;
  board: ReturnType<typeof toPythonSnapshot>;
  phase: PhaseState;
  currentPlayer: Player;
  movesThisTurn: number;
  kingMoved: boolean;
  turnCounter: number;
  placementCursor: number;
  currentPlacement: PendingPlacement | null;
  piecesLeft: PiecesLeft;
  lastAction: string;
  message: string;
  aiEnabled: boolean;
  aiPlayer: Player;
  hasActiveMatch: boolean;
  matchConfig: MatchConfig | null;
  timeLeft: Record<Player, number>;
  pendingTransform?: PendingTransform | null;
  pendingDefendedKing?: PendingDefendedKing | null;
  history?: HistoryEntry[];
}

/** Authoritative + transient data the store holds (no action functions). */
export interface GameState {
  phase: PhaseState;
  board: BoardState;
  currentPlayer: Player;
  movesThisTurn: number;
  kingMoved: boolean;
  turnCounter: number;
  selected: Vec2 | null;
  legalTargets: Vec2[];
  placementCursor: number;
  currentPlacement: PendingPlacement | null;
  piecesLeft: PiecesLeft;
  lastAction: string;
  message: string;
  history: HistoryEntry[];
  pendingTransform: PendingTransform | null;
  pendingDefendedKing: PendingDefendedKing | null;
  aiEnabled: boolean;
  aiPlayer: Player;
  hasActiveMatch: boolean;
  matchConfig: MatchConfig | null;
  timeLeft: Record<Player, number>;
  clockRunningFor: Player | null;
  clockLastSyncMs: number | null;
}

/** The public command surface. */
export interface GameActions {
  startConfiguredMatch: (config: MatchConfig) => void;
  startQuickMatch: (options?: StartMatchOptions) => void;
  startManualPlacement: (options?: StartMatchOptions) => void;
  startAiMatch: () => void;
  startTransformMatch: () => void;
  openRules: () => void;
  returnHome: () => void;
  activateSquare: (pos: Vec2) => void;
  chooseDefender: (pos: Vec2) => void;
  cancelDefenderSelection: () => void;
  chooseTransform: (newType: PawnType) => void;
  passTurn: () => void;
  undo: () => void;
  runAiTurn: () => void;
  startClock: (now: number) => void;
  stopClock: (now: number) => void;
  tickClock: (now: number) => void;
  saveGame: () => void;
  loadGame: () => void;
  exportSaveJson: () => string | null;
  importSaveJson: (raw: string) => boolean;
}

export type GameStore = GameState & GameActions;

/** A patch a controller returns for the store to apply via `set`. */
export type StatePatch = Partial<GameState>;
