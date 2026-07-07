import type { GameConfig, PieceType, Player, Vec2 } from "./types";

export const PLAYERS = ["Black", "White"] as const satisfies readonly Player[];
export const PAWN_TYPES = ["AttackPawn", "DefensePawn", "ConquestPawn"] as const;
export const PIECE_TYPES = ["AttackPawn", "DefensePawn", "ConquestPawn", "King"] as const satisfies readonly PieceType[];
export const ADJACENT_8: Vec2[] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];
export const ORTHOGONAL_4: Vec2[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export const DEFAULT_CONFIG: GameConfig = {
  rows: 12,
  cols: 12,
  specialCount: 5,
  transformEnabled: false,
  transformRound: 10,
};

export const PIECE_ORDER: PieceType[] = [
  "King",
  "AttackPawn",
  "AttackPawn",
  "AttackPawn",
  "AttackPawn",
  "DefensePawn",
  "DefensePawn",
  "DefensePawn",
  "DefensePawn",
  "ConquestPawn",
  "ConquestPawn",
  "ConquestPawn",
  "ConquestPawn",
];
