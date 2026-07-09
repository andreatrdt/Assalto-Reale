import type { BoardState, Piece, Vec2 } from "../game/engine";

export type BoardMotionKind = "move" | "capture" | "place" | "defendedKing" | "transform";

interface DefendedKingSnapshot {
  action: {
    start?: Vec2;
    end?: Vec2;
    defendedKing?: {
      landingPosition: Vec2;
    };
  };
  defenders: Vec2[];
}

interface TransformSnapshot {
  pos: Vec2;
  pieceType: string;
}

export interface BoardMotionSnapshot {
  board: BoardState;
  phase: string;
  lastAction: string;
  message: string;
  placementCursor: number;
  historyLength: number;
  pendingTransform: TransformSnapshot | null;
  pendingDefendedKing: DefendedKingSnapshot | null;
}

interface MotionBase {
  kind: BoardMotionKind;
}

export interface MoveMotion extends MotionBase {
  kind: "move";
  piece: Piece;
  from: Vec2;
  to: Vec2;
}

export interface CaptureMotion extends MotionBase {
  kind: "capture";
  piece: Piece;
  captured: Piece;
  from: Vec2;
  to: Vec2;
}

export interface PlaceMotion extends MotionBase {
  kind: "place";
  piece: Piece;
  at: Vec2;
}

export interface DefendedKingMotion extends MotionBase {
  kind: "defendedKing";
  piece: Piece;
  sacrificedPiece: Piece;
  from: Vec2;
  king: Vec2;
  sacrifice: Vec2;
  landing: Vec2;
}

export interface TransformMotion extends MotionBase {
  kind: "transform";
  fromPiece: Piece;
  toPiece: Piece;
  at: Vec2;
}

export type BoardMotionDraft = MoveMotion | CaptureMotion | PlaceMotion | DefendedKingMotion | TransformMotion;

export type BoardMotionEvent = BoardMotionDraft & {
  id: number;
  durationMs: number;
  reducedMotion: boolean;
};

export interface BoardMotionDerivation {
  event: BoardMotionDraft | null;
  reset: boolean;
}

interface PieceChange {
  pos: Vec2;
  before: Piece | null;
  after: Piece | null;
}

function copyPos(pos: Vec2): Vec2 {
  return [pos[0], pos[1]];
}

export function samePosition(left: Vec2, right: Vec2): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

export function samePiece(left: Piece | null, right: Piece | null): boolean {
  if (left === right) return true;
  return Boolean(left && right && left.player === right.player && left.type === right.type);
}

export function orientedPosition(pos: Vec2, rows: number, cols: number, flipped = false): Vec2 {
  return flipped ? [rows - 1 - pos[0], cols - 1 - pos[1]] : copyPos(pos);
}

export function squareDelta(
  from: Vec2,
  to: Vec2,
  cell: number,
  rows: number,
  cols: number,
  flipped = false,
): { x: number; y: number } {
  const orientedFrom = orientedPosition(from, rows, cols, flipped);
  const orientedTo = orientedPosition(to, rows, cols, flipped);
  return {
    x: (orientedTo[1] - orientedFrom[1]) * cell,
    y: (orientedTo[0] - orientedFrom[0]) * cell,
  };
}

export function motionDuration(kind: BoardMotionKind, reducedMotion: boolean): number {
  if (reducedMotion) return 80;
  switch (kind) {
    case "place":
      return 150;
    case "move":
      return 220;
    case "capture":
      return 270;
    case "transform":
      return 330;
    case "defendedKing":
      return 480;
  }
}

function boardChanges(before: BoardState, after: BoardState): PieceChange[] {
  const changes: PieceChange[] = [];
  const rows = Math.min(before.config.rows, after.config.rows);
  const cols = Math.min(before.config.cols, after.config.cols);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const previousPiece = before.grid[row]?.[col] ?? null;
      const nextPiece = after.grid[row]?.[col] ?? null;
      if (!samePiece(previousPiece, nextPiece)) {
        changes.push({ pos: [row, col], before: previousPiece, after: nextPiece });
      }
    }
  }
  return changes;
}

function pieceAt(board: BoardState, pos: Vec2 | null | undefined): Piece | null {
  if (!pos) return null;
  return board.grid[pos[0]]?.[pos[1]] ?? null;
}

function findKing(board: BoardState, player: Piece["player"]): Vec2 | null {
  for (let row = 0; row < board.config.rows; row += 1) {
    for (let col = 0; col < board.config.cols; col += 1) {
      const piece = board.grid[row]?.[col] ?? null;
      if (piece?.player === player && piece.type === "King") return [row, col];
    }
  }
  return null;
}

function isResetTransition(previous: BoardMotionSnapshot, next: BoardMotionSnapshot, changeCount: number): boolean {
  const message = next.message.toLowerCase();
  const action = next.lastAction.toLowerCase();
  return (
    next.historyLength < previous.historyLength ||
    message === "undone." ||
    message.includes("game loaded") ||
    message.includes("imported save loaded") ||
    action === "ready." ||
    action.includes("quick balanced deployment complete") ||
    action.includes("manual deployment started") ||
    Math.abs(next.placementCursor - previous.placementCursor) > 1 ||
    changeCount > 4
  );
}

function deriveTransform(previous: BoardMotionSnapshot, next: BoardMotionSnapshot, changes: PieceChange[]): TransformMotion | null {
  const actionIsTransform = next.lastAction.toLowerCase().includes("transformed into");
  if (!actionIsTransform && !(previous.pendingTransform && !next.pendingTransform)) return null;
  if (changes.length !== 1) return null;
  const [change] = changes;
  if (!change.before || !change.after) return null;
  if (change.before.player !== change.after.player || change.before.type === change.after.type) return null;
  return {
    kind: "transform",
    fromPiece: change.before,
    toPiece: change.after,
    at: copyPos(change.pos),
  };
}

function deriveDefendedKing(previous: BoardMotionSnapshot, next: BoardMotionSnapshot, changes: PieceChange[]): DefendedKingMotion | null {
  const context = previous.pendingDefendedKing;
  const describedAsDefended = next.lastAction.toLowerCase().includes("attacked a defended king");
  if (!context && !describedAsDefended) return null;

  const additions = changes.filter((change) => change.after !== null);
  const removals = changes.filter((change) => change.before !== null);
  const landing = context?.action.defendedKing?.landingPosition ?? additions[0]?.pos ?? null;
  const landingPiece = pieceAt(next.board, landing);

  const from = context?.action.start ??
    removals.find((change) => change.before && landingPiece && samePiece(change.before, landingPiece))?.pos ??
    null;
  const attacker = pieceAt(previous.board, from) ?? landingPiece;
  if (!from || !landing || !attacker) return null;

  const sacrifice =
    context?.defenders.find((pos) => pieceAt(previous.board, pos) && !pieceAt(next.board, pos)) ??
    removals.find((change) => !samePosition(change.pos, from) && change.before?.type === "DefensePawn")?.pos ??
    null;
  const sacrificedPiece = pieceAt(previous.board, sacrifice);
  if (!sacrifice || !sacrificedPiece) return null;

  const king = context?.action.end ?? findKing(previous.board, sacrificedPiece.player);
  if (!king) return null;

  return {
    kind: "defendedKing",
    piece: attacker,
    sacrificedPiece,
    from: copyPos(from),
    king: copyPos(king),
    sacrifice: copyPos(sacrifice),
    landing: copyPos(landing),
  };
}

function derivePlacement(next: BoardMotionSnapshot, changes: PieceChange[]): PlaceMotion | null {
  if (!next.lastAction.toLowerCase().includes(" placed ")) return null;
  const additions = changes.filter((change) => change.before === null && change.after !== null);
  const removals = changes.filter((change) => change.before !== null);
  if (additions.length !== 1 || removals.length !== 0 || !additions[0].after) return null;
  return { kind: "place", piece: additions[0].after, at: copyPos(additions[0].pos) };
}

function deriveMoveOrCapture(changes: PieceChange[]): MoveMotion | CaptureMotion | null {
  const additions = changes.filter((change) => change.after !== null);
  const destination = additions.length === 1 ? additions[0] : undefined;
  const movingPiece = destination?.after ?? null;
  if (!destination || !movingPiece) return null;

  const source = changes.find(
    (change) =>
      !samePosition(change.pos, destination.pos) &&
      change.before !== null &&
      samePiece(change.before, movingPiece) &&
      (change.after === null || !samePiece(change.after, movingPiece)),
  );
  if (!source || !source.before) return null;

  if (destination.before && destination.before.player !== movingPiece.player) {
    return {
      kind: "capture",
      piece: movingPiece,
      captured: destination.before,
      from: copyPos(source.pos),
      to: copyPos(destination.pos),
    };
  }

  return {
    kind: "move",
    piece: movingPiece,
    from: copyPos(source.pos),
    to: copyPos(destination.pos),
  };
}

/**
 * Derives one transient visual event from two authoritative store snapshots.
 * The engine state is already committed; the board renderer temporarily hides
 * the authoritative destination piece while this event presents the transition.
 */
export function deriveBoardMotion(previous: BoardMotionSnapshot | null, next: BoardMotionSnapshot): BoardMotionDerivation {
  if (!previous) return { event: null, reset: false };
  if (previous.board === next.board) return { event: null, reset: false };

  const changes = boardChanges(previous.board, next.board);
  if (changes.length === 0) return { event: null, reset: false };
  if (isResetTransition(previous, next, changes.length)) return { event: null, reset: true };

  const transform = deriveTransform(previous, next, changes);
  if (transform) return { event: transform, reset: false };

  const defendedKing = deriveDefendedKing(previous, next, changes);
  if (defendedKing) return { event: defendedKing, reset: false };

  const placement = derivePlacement(next, changes);
  if (placement) return { event: placement, reset: false };

  return { event: deriveMoveOrCapture(changes), reset: false };
}
