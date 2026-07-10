import { ADJACENT_8, ORTHOGONAL_4 } from "./config.js";
import { cheb, direction, getPiece, hasPos, inBounds, pieceIdAt, samePos } from "./board.js";
import type { BoardState, DefendedKingPreview, Vec2 } from "./types.js";

function attackPath(start: Vec2, end: Vec2): Vec2[] {
  const dist = cheb(start, end);
  const dir = direction(start, end);
  return Array.from({ length: dist }, (_, index) => [start[0] + dir[0] * (index + 1), start[1] + dir[1] * (index + 1)]);
}

export function adjacentDefendersForKing(board: BoardState, kingPos: Vec2, kingPlayer: string): Vec2[] {
  const defenders: Vec2[] = [];
  for (const [dr, dc] of ADJACENT_8) {
    const pos: Vec2 = [kingPos[0] + dr, kingPos[1] + dc];
    if (!inBounds(board, pos)) {
      continue;
    }
    const piece = getPiece(board, pos);
    if (piece?.player === kingPlayer && piece.type === "DefensePawn") {
      defenders.push(pos);
    }
  }
  return defenders.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export function intermediateClear(board: BoardState, start: Vec2, end: Vec2): boolean {
  if (cheb(start, end) !== 2) {
    return true;
  }
  const mid: Vec2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  return getPiece(board, mid) === null;
}

export function getDefendedKingPreviewFromPositions(
  board: BoardState,
  attackerOrigin: Vec2,
  kingPosition: Vec2,
  movesThisTurn = 0,
): DefendedKingPreview | null {
  if (!inBounds(board, attackerOrigin) || !inBounds(board, kingPosition)) {
    return null;
  }
  const attacker = getPiece(board, attackerOrigin);
  const king = getPiece(board, kingPosition);
  if (!attacker || !king) {
    return null;
  }
  if (attacker.type !== "AttackPawn" || king.type !== "King" || attacker.player === king.player) {
    return null;
  }
  const dist = cheb(attackerOrigin, kingPosition);
  const dir = direction(attackerOrigin, kingPosition);
  if (!ORTHOGONAL_4.some((orthogonal) => samePos(orthogonal, dir)) || ![1, 2].includes(dist)) {
    return null;
  }
  if (dist === 2 && movesThisTurn !== 0) {
    return null;
  }
  if (dist === 2 && !intermediateClear(board, attackerOrigin, kingPosition)) {
    return null;
  }

  const defenders = adjacentDefendersForKing(board, kingPosition, king.player);
  if (defenders.length === 0) {
    return null;
  }

  const bounceDirection: Vec2 = [dir[0] === 0 ? 0 : -dir[0], dir[1] === 0 ? 0 : -dir[1]];
  const bouncePath: Vec2[] = [];
  let landing: Vec2 | null = null;
  for (let step = 1; step < 6; step += 1) {
    const candidate: Vec2 = [kingPosition[0] + bounceDirection[0] * step, kingPosition[1] + bounceDirection[1] * step];
    if (!inBounds(board, candidate)) {
      break;
    }
    const occupant = getPiece(board, candidate);
    if (occupant && !samePos(candidate, attackerOrigin)) {
      break;
    }
    bouncePath.push(candidate);
    landing = candidate;
  }

  if (!landing) {
    return null;
  }

  return {
    attackerId: pieceIdAt(board, attackerOrigin),
    kingId: pieceIdAt(board, kingPosition),
    attackerOrigin,
    kingPosition,
    attackDirection: dir,
    bounceDirection,
    attackPath: attackPath(attackerOrigin, kingPosition),
    bouncePath,
    landingPosition: landing,
    eligibleDefenderIds: defenders.map((pos) => pieceIdAt(board, pos)),
    triggersTransform: hasPos(board.transformSquares, landing),
    actionCost: dist,
    endsTurn: true,
  };
}
