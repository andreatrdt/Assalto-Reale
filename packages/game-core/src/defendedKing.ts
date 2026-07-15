import { ADJACENT_8, ORTHOGONAL_4 } from "./config.js";
import { cheb, direction, getPiece, hasPos, inBounds, pieceIdAt, samePos } from "./board.js";
import type { BoardState, DefendedKingPreview, DeflectionRoute, DeflectionRouteId, Vec2 } from "./types.js";
import { CURRENT_GAME_RULES_VERSION } from "./versions.js";

function attackPath(start: Vec2, end: Vec2): Vec2[] {
  const dist = cheb(start, end);
  const dir = direction(start, end);
  return Array.from({ length: dist }, (_, index) => [start[0] + dir[0] * (index + 1), start[1] + dir[1] * (index + 1)]);
}

function add(pos: Vec2, dir: Vec2): Vec2 {
  return [pos[0] + dir[0], pos[1] + dir[1]];
}

function rotate(dir: Vec2, clockwise: boolean): Vec2 {
  return clockwise ? [dir[1], -dir[0]] : [-dir[1], dir[0]];
}

function contains(positions: Vec2[], pos: Vec2): boolean {
  return positions.some((candidate) => samePos(candidate, pos));
}

function route(
  board: BoardState,
  king: Vec2,
  primary: Vec2,
  emptyDuringResolution: Vec2[],
  id: DeflectionRouteId,
  bypassClockwise?: boolean,
  maxSteps = 5,
): DeflectionRoute | null {
  const path: Vec2[] = [];
  const jumpedSquares: Vec2[] = [];
  const turnSquares: Vec2[] = [];
  let current = king;
  const isEmpty = (pos: Vec2): boolean => inBounds(board, pos) && (contains(emptyDuringResolution, pos) || getPiece(board, pos) === null);

  while (path.length < maxSteps) {
    const next = add(current, primary);
    if (!inBounds(board, next)) break;
    if (isEmpty(next)) {
      path.push(next);
      current = next;
      continue;
    }

    const obstacleRun: Vec2[] = [];
    let beyond = next;
    while (inBounds(board, beyond) && !isEmpty(beyond)) {
      obstacleRun.push(beyond);
      beyond = add(beyond, primary);
    }
    const jumpLength = obstacleRun.length + 1;
    if (inBounds(board, beyond) && isEmpty(beyond) && path.length + jumpLength <= maxSteps) {
      path.push(...obstacleRun, beyond);
      jumpedSquares.push(...obstacleRun);
      current = beyond;
      continue;
    }

    if (bypassClockwise === undefined) break;
    const side = rotate(primary, bypassClockwise);
    const firstSide = add(current, side);
    if (!isEmpty(firstSide) || path.length >= maxSteps) break;
    path.push(firstSide);
    turnSquares.push(firstSide);
    current = firstSide;

    let cleared = false;
    while (path.length < maxSteps) {
      const forward = add(current, primary);
      if (!isEmpty(forward)) break;
      path.push(forward);
      current = forward;
      const towardLane = add(current, [-side[0], -side[1]]);
      if (isEmpty(towardLane)) {
        if (path.length < maxSteps) {
          path.push(towardLane);
          turnSquares.push(towardLane);
          current = towardLane;
        }
        cleared = true;
        break;
      }
    }
    if (!cleared) break;
  }

  if (path.length === 0) return null;
  const landingPosition = [...path].reverse().find((pos) => isEmpty(pos));
  if (!landingPosition) return null;
  return { id, path, jumpedSquares, turnSquares, landingPosition };
}

function generateRoutes(board: BoardState, king: Vec2, primary: Vec2, emptyDuringResolution: Vec2[]): DeflectionRoute[] {
  const primaryRoute = route(board, king, primary, emptyDuringResolution, "primary");
  if (primaryRoute?.path.length === 5 || (primaryRoute && primaryRoute.jumpedSquares.length > 0)) return [primaryRoute];

  const next = add(primaryRoute?.landingPosition ?? king, primary);
  if (!inBounds(board, next)) return primaryRoute ? [primaryRoute] : [];
  if (getPiece(board, next) === null || contains(emptyDuringResolution, next)) return primaryRoute ? [primaryRoute] : [];

  const prefix = primaryRoute?.path ?? [];
  const start = primaryRoute?.landingPosition ?? king;
  const remaining = 5 - prefix.length;
  const alternatives: DeflectionRoute[] = [];
  for (const [id, clockwise] of [
    ["clockwise", true],
    ["counterClockwise", false],
  ] as const) {
    const suffix = route(board, start, primary, emptyDuringResolution, id, clockwise, remaining);
    if (!suffix) continue;
    const combinedPath = [...prefix, ...suffix.path.slice(0, remaining)];
    const landingPosition = [...combinedPath]
      .reverse()
      .find((pos) => contains(emptyDuringResolution, pos) || getPiece(board, pos) === null);
    if (!landingPosition) continue;
    alternatives.push({
      id,
      path: combinedPath,
      jumpedSquares: suffix.jumpedSquares,
      turnSquares: suffix.turnSquares,
      landingPosition,
    });
  }
  return alternatives.length > 0 ? alternatives : primaryRoute ? [primaryRoute] : [];
}

export function adjacentDefendersForKing(board: BoardState, kingPos: Vec2, kingPlayer: string): Vec2[] {
  const defenders: Vec2[] = [];
  for (const [dr, dc] of ADJACENT_8) {
    const pos: Vec2 = [kingPos[0] + dr, kingPos[1] + dc];
    if (!inBounds(board, pos)) continue;
    const piece = getPiece(board, pos);
    if (piece?.player === kingPlayer && piece.type === "DefensePawn") defenders.push(pos);
  }
  return defenders.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export function intermediateClear(board: BoardState, start: Vec2, end: Vec2): boolean {
  if (cheb(start, end) !== 2) return true;
  const mid: Vec2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  return getPiece(board, mid) === null;
}

export function getDefendedKingPreviewFromPositions(
  board: BoardState,
  attackerOrigin: Vec2,
  kingPosition: Vec2,
  movesThisTurn = 0,
  rulesVersion: 1 | 2 = CURRENT_GAME_RULES_VERSION,
  selectedRouteId?: DeflectionRouteId | null,
): DefendedKingPreview | null {
  if (!inBounds(board, attackerOrigin) || !inBounds(board, kingPosition)) return null;
  const attacker = getPiece(board, attackerOrigin);
  const king = getPiece(board, kingPosition);
  if (!attacker || !king || attacker.type !== "AttackPawn" || king.type !== "King" || attacker.player === king.player) return null;
  const dist = cheb(attackerOrigin, kingPosition);
  const dir = direction(attackerOrigin, kingPosition);
  if (!ORTHOGONAL_4.some((orthogonal) => samePos(orthogonal, dir)) || ![1, 2].includes(dist)) return null;
  if (dist === 2 && movesThisTurn !== 0) return null;

  const midpoint: Vec2 | null = dist === 2 ? [(attackerOrigin[0] + kingPosition[0]) / 2, (attackerOrigin[1] + kingPosition[1]) / 2] : null;
  const midpointPiece = midpoint ? getPiece(board, midpoint) : null;
  const pathDefender = rulesVersion >= 2 && midpointPiece?.player === king.player && midpointPiece.type === "DefensePawn" ? midpoint : null;
  if (dist === 2 && !intermediateClear(board, attackerOrigin, kingPosition) && !pathDefender) return null;

  const defenders = adjacentDefendersForKing(board, kingPosition, king.player);
  if (defenders.length === 0) return null;
  const bounceDirection: Vec2 = [dir[0] === 0 ? 0 : -dir[0], dir[1] === 0 ? 0 : -dir[1]];
  let routes: DeflectionRoute[];
  if (rulesVersion === 1) {
    const legacyPath: Vec2[] = [];
    for (let step = 1; step < 6; step += 1) {
      const candidate: Vec2 = [kingPosition[0] + bounceDirection[0] * step, kingPosition[1] + bounceDirection[1] * step];
      if (!inBounds(board, candidate)) break;
      const occupant = getPiece(board, candidate);
      if (occupant && !samePos(candidate, attackerOrigin)) break;
      legacyPath.push(candidate);
    }
    if (legacyPath.length === 0) return null;
    routes = [{ id: "primary", path: legacyPath, jumpedSquares: [], turnSquares: [], landingPosition: legacyPath.at(-1)! }];
  } else {
    routes = generateRoutes(board, kingPosition, bounceDirection, [attackerOrigin, ...(pathDefender ? [pathDefender] : [])]);
    if (routes.length === 0) {
      routes = [{ id: "primary", path: [], jumpedSquares: [], turnSquares: [], landingPosition: attackerOrigin }];
    }
  }
  const selected = routes.find((candidate) => candidate.id === selectedRouteId) ?? routes[0]!;
  return {
    attackerId: pieceIdAt(board, attackerOrigin),
    kingId: pieceIdAt(board, kingPosition),
    attackerOrigin,
    kingPosition,
    attackDirection: dir,
    bounceDirection,
    attackPath: attackPath(attackerOrigin, kingPosition),
    bouncePath: selected.path,
    landingPosition: selected.landingPosition,
    routes,
    selectedRouteId: selected.id,
    pathDefenderId: pathDefender ? pieceIdAt(board, pathDefender) : null,
    eligibleDefenderIds: (pathDefender ? [pathDefender] : defenders).map((pos) => pieceIdAt(board, pos)),
    triggersTransform: hasPos(board.transformSquares, selected.landingPosition),
    actionCost: dist,
    endsTurn: true,
  };
}
