import type { PhaseState } from "../../app/phases";
import type {
  BoardState,
  Action,
  DefendedKingPreview,
  PawnType,
  PendingDefendedKing as CorePendingDefendedKing,
  PendingPlacement,
  PendingTransform as CorePendingTransform,
  PiecesLeft as CorePiecesLeft,
  Player,
  PythonBoardSnapshot,
  Vec2,
} from "../engine";
import type { MatchConfig } from "../setup/matchConfig";

export type PiecesLeft = CorePiecesLeft;
export type PlacementItem = PendingPlacement;
export type PendingTransform = CorePendingTransform;
export type PendingDefendedKing = CorePendingDefendedKing;
export interface ProjectedDefendedKing {
  preview: DefendedKingPreview;
  defenders: Vec2[];
}

export interface ResolvedDefendedKing {
  action: Action;
  defenders: Vec2[];
}

export interface HistoryEntry {
  board: BoardState;
  currentPlayer: Player;
  movesThisTurn: number;
  kingMoved: boolean;
  turnCounter: number;
  placementCursor: number;
  currentPlacement: PlacementItem | null;
  piecesLeft: PiecesLeft;
  phase: PhaseState;
  lastAction: string;
  message: string;
  pendingTransform: PendingTransform | null;
  pendingDefendedKing: PendingDefendedKing | null;
  timeLeft: Record<Player, number>;
}

export interface SavedGame {
  schema: 1 | 2 | 3;
  rulesVersion?: 1 | 2;
  seed?: number;
  appVersion?: string;
  savedAt?: string;
  board: PythonBoardSnapshot;
  phase: PhaseState;
  currentPlayer: Player;
  movesThisTurn: number;
  kingMoved: boolean;
  turnCounter: number;
  placementCursor: number;
  currentPlacement: PlacementItem | null;
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
  projectedDefendedKing?: ProjectedDefendedKing | null;
}

export interface GameState {
  rulesVersion: 1 | 2;
  seed: number;
  phase: PhaseState;
  board: BoardState;
  currentPlayer: Player;
  movesThisTurn: number;
  kingMoved: boolean;
  turnCounter: number;
  selected: Vec2 | null;
  legalTargets: Vec2[];
  placementCursor: number;
  currentPlacement: PlacementItem | null;
  piecesLeft: PiecesLeft;
  lastAction: string;
  message: string;
  history: HistoryEntry[];
  pendingTransform: PendingTransform | null;
  pendingDefendedKing: PendingDefendedKing | null;
  projectedDefendedKing: ProjectedDefendedKing | null;
  resolvedDefendedKing: ResolvedDefendedKing | null;
  aiEnabled: boolean;
  aiPlayer: Player;
  hasActiveMatch: boolean;
  matchConfig: MatchConfig | null;
  timeLeft: Record<Player, number>;
  clockRunningFor: Player | null;
  clockLastSyncMs: number | null;
}

export interface GameActions {
  startConfiguredMatch: (config: MatchConfig) => void;
  startManualPlacement: (options?: { aiEnabled?: boolean; aiPlayer?: Player; transformEnabled?: boolean; seed?: number }) => void;
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
export type StatePatch = Partial<GameState>;
