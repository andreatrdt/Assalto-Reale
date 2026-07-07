import { DEFAULT_CONFIG, PIECE_TYPES, PLAYERS } from "./config";
import type { BoardState, GameConfig, Grid, Piece, PieceType, Player, Vec2 } from "./types";

export function createEmptyGrid(config: GameConfig): Grid {
  return Array.from({ length: config.rows }, () => Array.from({ length: config.cols }, () => null));
}

export function createBoard(config: Partial<GameConfig> = {}): BoardState {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  return {
    config: fullConfig,
    grid: createEmptyGrid(fullConfig),
    specialSquares: [],
    transformSquares: [],
    controlledSquares: { Black: [], White: [] },
    capturedPieces: {
      Black: { AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0, King: 0 },
      White: { AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0, King: 0 },
    },
    territoryClaim: null,
  };
}

export function cloneBoard(board: BoardState): BoardState {
  return {
    config: { ...board.config },
    grid: board.grid.map((row) => row.map((piece) => (piece ? { ...piece } : null))),
    specialSquares: board.specialSquares.map((pos) => [pos[0], pos[1]]),
    transformSquares: board.transformSquares.map((pos) => [pos[0], pos[1]]),
    controlledSquares: {
      Black: board.controlledSquares.Black.map((pos) => [pos[0], pos[1]]),
      White: board.controlledSquares.White.map((pos) => [pos[0], pos[1]]),
    },
    capturedPieces: {
      Black: { ...board.capturedPieces.Black },
      White: { ...board.capturedPieces.White },
    },
    territoryClaim: board.territoryClaim ? { ...board.territoryClaim } : null,
  };
}

export function isPlayer(value: string): value is Player {
  return PLAYERS.includes(value as Player);
}

export function isPieceType(value: string): value is PieceType {
  return PIECE_TYPES.includes(value as PieceType);
}

export function createPiece(type: PieceType, player: Player): Piece {
  return { player, type };
}

export function inBounds(board: BoardState, pos: Vec2): boolean {
  const [row, col] = pos;
  return row >= 0 && row < board.config.rows && col >= 0 && col < board.config.cols;
}

export function getPiece(board: BoardState, pos: Vec2): Piece | null {
  return inBounds(board, pos) ? board.grid[pos[0]][pos[1]] : null;
}

export function setPiece(board: BoardState, pos: Vec2, piece: Piece | null): void {
  board.grid[pos[0]][pos[1]] = piece;
}

export function samePos(a: Vec2, b: Vec2): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export function hasPos(list: readonly Vec2[], pos: Vec2): boolean {
  return list.some((item) => samePos(item, pos));
}

export function cheb(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

export function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

export function direction(start: Vec2, end: Vec2): Vec2 {
  return [sign(end[0] - start[0]), sign(end[1] - start[1])];
}

export function squareName(pos: Vec2, rows = 12): string {
  return `${String.fromCharCode("A".charCodeAt(0) + pos[1])}${rows - pos[0]}`;
}

export function pieceIdAt(board: BoardState, pos: Vec2): string {
  const piece = getPiece(board, pos);
  if (!piece) {
    throw new Error(`No piece at ${pos[0]},${pos[1]}`);
  }
  return `${piece.player}:${piece.type}@${squareName(pos, board.config.rows)}`;
}

export function serializePos(pos: Vec2): string {
  return `${pos[0]},${pos[1]}`;
}

export function sortPositions(positions: Vec2[]): Vec2[] {
  return [...positions].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
