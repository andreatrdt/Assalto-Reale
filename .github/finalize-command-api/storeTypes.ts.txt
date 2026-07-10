import type { PhaseState } from "../../app/phases";
import type {
  BoardState,
  PawnType,
  PendingDefendedKing as CorePendingDefendedKing,
  PendingPlacement,
  PendingTransform as CorePendingTransform,
  PiecesLeft as CorePiecesLeft,
  Player,
  Vec2,
} from "../engine";
import type { ResolvedMatchConfig } from "../setup/matchConfig";

export type PiecesLeft = CorePiecesLeft;
export type PlacementItem = PendingPlacement;
export type PendingTransform = CorePendingTransform;
export type PendingDefendedKing = CorePendingDefendedKing;

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
  schema: 1 | 2;
  board: unknown;
  currentPlayer: Player;
  movesThisTurn: number;
  kingMoved: boolean;
  turnCounter: number;
  placementCursor: number;
  piecesLeft: PiecesLeft;
  phase: PhaseState;
  lastAction: string;
  pendingTransform: PendingTransform | null;
  pendingDefendedKing: PendingDefendedKing | null;
  aiEnabled: boolean;
  aiPlayer: Player;
  hasActiveMatch: boolean;
  matchConfig: ResolvedMatchConfig | null;
  timeLeft: Record<Player, number>;
}

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
  currentPlacement: PlacementItem | null;
  piecesLeft: PiecesLeft;
  lastAction: string;
  message: string;
  history: HistoryEntry[];
  pendingTransform: PendingTransform | null;
  pendingDefendedKing: PendingDefendedKing | null;
  aiEnabled: boolean;
  aiPlayer: Player;
  hasActiveMatch: boolean;
  matchConfig: ResolvedMatchConfig | null;
  timeLeft: Record<Player, number>;
  clockRunningFor: Player | null;
  clockLastSyncMs: number | null;
}

export interface GameActions {
  startConfiguredMatch: (config: ResolvedMatchConfig) => void;
  startQuickMatch: (options?: { aiEnabled?: boolean; aiPlayer?: Player; transformEnabled?: boolean; seed?: number }) => void;
  startAiMatch: () => void;
  startTransformMatch: () => void;
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
