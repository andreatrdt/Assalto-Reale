import type { CSSProperties } from "react";
import type { BoardState, DeflectionRoute, DeflectionRouteId, Piece, Vec2 } from "../game/engine";
import { adjacentDefendersForKing, getPiece, hasPos } from "../game/engine";
import { useGameStore } from "../game/state/gameStore";
import { useUiSettings } from "../ui/uiSettings";
import { squareDelta, type BoardMotionEvent } from "./boardMotion";
import { useBoardMotion } from "./useBoardMotion";
import "./GameBoard.css";
import "./BoardMotion.css";

export interface DefendedKingBoardPreview {
  attackerOrigin: Vec2;
  kingPosition: Vec2;
  defenders: Vec2[];
  attackPath: Vec2[];
  bouncePath: Vec2[];
  landingPosition: Vec2;
  triggersTransform: boolean;
  routes?: DeflectionRoute[];
  selectedRouteId?: DeflectionRouteId;
  pathDefenderId?: string | null;
}

interface GameBoardProps {
  board: BoardState;
  selected?: Vec2 | null;
  legalTargets?: Vec2[];
  placementValid?: Vec2[];
  defendedKingPreview?: DefendedKingBoardPreview | null;
  onSquareActivate?: (pos: Vec2) => void;
}

type MotionStyle = CSSProperties & Record<`--${string}`, string | number>;

function pieceLabel(piece: Piece): string {
  return piece.type.replace("Pawn", " Pawn");
}

export function PieceGlyph({ piece }: { piece: Piece }) {
  const factionClass = piece.player === "Black" ? "pieceBlack" : "pieceWhite";
  const motif = {
    King: "M30 13 39 26 50 15 61 26 70 13 65 73H35L30 13Z",
    AttackPawn: "M50 12 67 42 55 42 63 76H37L45 42 33 42 50 12Z",
    DefensePawn: "M50 14 72 24 68 50C65 65 57 75 50 80C43 75 35 65 32 50L28 24 50 14Z",
    ConquestPawn: "M35 20H59L55 40H70L58 55H40V80H31V20H35Z",
  }[piece.type];

  return (
    <g className={`piece ${factionClass}`} aria-label={`${piece.player} ${pieceLabel(piece)}`}>
      <ellipse className="pieceShadow" cx="50" cy="80" rx="26" ry="7" />
      <path className="pieceBody" d={motif} />
      <path className="pieceLine" d={motif} />
    </g>
  );
}

function squareLabel(pos: Vec2, rows: number): string {
  return `${String.fromCharCode("A".charCodeAt(0) + pos[1])}${rows - pos[0]}`;
}

function samePos(left: Vec2, right: Vec2): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function posKey(pos: Vec2): string {
  return `${pos[0]}-${pos[1]}`;
}

function previewPath(start: Vec2, path: Vec2[], end: Vec2): Vec2[] {
  return [start, ...path, end].filter((pos, index, points) => index === 0 || !samePos(pos, points[index - 1]));
}

function pathPoints(path: Vec2[], cell: number): string {
  return path.map(([row, col]) => `${col * cell + cell / 2},${row * cell + cell / 2}`).join(" ");
}

function cornerMarkPath(x: number, y: number, cell: number): string {
  const inset = cell * 0.18;
  const length = cell * 0.14;
  const left = x + inset;
  const right = x + cell - inset;
  const top = y + inset;
  const bottom = y + cell - inset;

  return [
    `M ${left + length} ${top} H ${left} V ${top + length}`,
    `M ${right - length} ${top} H ${right} V ${top + length}`,
    `M ${left} ${bottom - length} V ${bottom} H ${left + length}`,
    `M ${right} ${bottom - length} V ${bottom} H ${right - length}`,
  ].join(" ");
}

function squareOrigin(pos: Vec2, cell: number): { x: number; y: number } {
  return { x: pos[1] * cell, y: pos[0] * cell };
}

function MotionPiece({ piece, cell }: { piece: Piece; cell: number }) {
  return (
    <svg x={cell * 0.16} y={cell * 0.1} width={cell * 0.68} height={cell * 0.78} viewBox="0 0 100 100" aria-hidden="true">
      <PieceGlyph piece={piece} />
    </svg>
  );
}

function durationStyle(motion: BoardMotionEvent, extra: Record<`--${string}`, string | number> = {}): MotionStyle {
  return {
    "--motion-duration": `${motion.durationMs}ms`,
    ...extra,
  } as MotionStyle;
}

function MotionOverlay({ motion, board, cell }: { motion: BoardMotionEvent; board: BoardState; cell: number }) {
  const reducedClass = motion.reducedMotion ? " isReduced" : "";

  if (motion.kind === "move" || motion.kind === "capture") {
    const source = squareOrigin(motion.from, cell);
    const destination = squareOrigin(motion.to, cell);
    const delta = squareDelta(motion.from, motion.to, cell, board.config.rows, board.config.cols);
    const movingStyle = durationStyle(motion, {
      "--motion-dx": `${delta.x}px`,
      "--motion-dy": `${delta.y}px`,
    });

    return (
      <g className="boardMotionLayer" data-motion-layer={motion.kind} aria-hidden="true">
        {motion.kind === "capture" && (
          <g
            transform={`translate(${destination.x} ${destination.y})`}
            className={`motionCaptured${reducedClass}`}
            style={durationStyle(motion)}
          >
            <MotionPiece piece={motion.captured} cell={cell} />
          </g>
        )}
        <g transform={`translate(${source.x} ${source.y})`}>
          <g className={`motionSprite motionTravel motion-${motion.kind}${reducedClass}`} style={movingStyle}>
            <MotionPiece piece={motion.piece} cell={cell} />
          </g>
        </g>
      </g>
    );
  }

  if (motion.kind === "place") {
    const origin = squareOrigin(motion.at, cell);
    return (
      <g className="boardMotionLayer" data-motion-layer="place" aria-hidden="true">
        <g transform={`translate(${origin.x} ${origin.y})`}>
          <g className={`motionSprite motionPlace${reducedClass}`} style={durationStyle(motion)}>
            <MotionPiece piece={motion.piece} cell={cell} />
          </g>
        </g>
      </g>
    );
  }

  if (motion.kind === "transform") {
    const origin = squareOrigin(motion.at, cell);
    const oldSquare = motion.oldSquare ? squareOrigin(motion.oldSquare, cell) : null;
    const newSquare = motion.newSquare ? squareOrigin(motion.newSquare, cell) : null;
    return (
      <g className="boardMotionLayer" data-motion-layer="transform" aria-hidden="true">
        {oldSquare && (
          <rect
            x={oldSquare.x + cell * 0.08}
            y={oldSquare.y + cell * 0.08}
            width={cell * 0.84}
            height={cell * 0.84}
            rx={cell * 0.14}
            className={`motionTransformOld${reducedClass}`}
            style={durationStyle(motion)}
          />
        )}
        {oldSquare && newSquare && (
          <line
            x1={oldSquare.x + cell / 2}
            y1={oldSquare.y + cell / 2}
            x2={newSquare.x + cell / 2}
            y2={newSquare.y + cell / 2}
            className={`motionTransformTrail${reducedClass}`}
            style={durationStyle(motion)}
          />
        )}
        {newSquare && (
          <rect
            x={newSquare.x + cell * 0.08}
            y={newSquare.y + cell * 0.08}
            width={cell * 0.84}
            height={cell * 0.84}
            rx={cell * 0.14}
            className={`motionTransformNew${reducedClass}`}
            style={durationStyle(motion)}
          />
        )}
        <rect
          x={origin.x + cell * 0.1}
          y={origin.y + cell * 0.1}
          width={cell * 0.8}
          height={cell * 0.8}
          rx={cell * 0.12}
          className={`motionTransformSquare${reducedClass}`}
          style={durationStyle(motion)}
        />
        <g transform={`translate(${origin.x} ${origin.y})`}>
          <g className={`motionSprite motionTransformFrom${reducedClass}`} style={durationStyle(motion)}>
            <MotionPiece piece={motion.fromPiece} cell={cell} />
          </g>
          <g className={`motionSprite motionTransformTo${reducedClass}`} style={durationStyle(motion)}>
            <MotionPiece piece={motion.toPiece} cell={cell} />
          </g>
        </g>
      </g>
    );
  }

  const king = squareOrigin(motion.king, cell);
  const sacrifice = squareOrigin(motion.sacrifice, cell);
  const authoritativeRoute = [motion.from, motion.king, ...motion.route];
  const routePath = authoritativeRoute
    .map((pos, index) => {
      const origin = squareOrigin(pos, cell);
      return `${index === 0 ? "M" : "L"} ${origin.x} ${origin.y}`;
    })
    .join(" ");
  const landingOrigin = squareOrigin(motion.landing, cell);

  return (
    <g className="boardMotionLayer" data-motion-layer="defendedKing" aria-hidden="true">
      <rect
        x={king.x + cell * 0.08}
        y={king.y + cell * 0.08}
        width={cell * 0.84}
        height={cell * 0.84}
        rx={cell * 0.14}
        className={`motionDefendedKingTarget${reducedClass}`}
        style={durationStyle(motion)}
      />
      <g transform={`translate(${sacrifice.x} ${sacrifice.y})`}>
        <g className={`motionSprite motionSacrifice${reducedClass}`} style={durationStyle(motion)}>
          <MotionPiece piece={motion.sacrificedPiece} cell={cell} />
        </g>
      </g>
      <g
        transform={motion.reducedMotion ? `translate(${landingOrigin.x} ${landingOrigin.y})` : undefined}
        data-route={motion.route.map((pos) => pos.join(",")).join(" ")}
        data-jumps={motion.jumpedSquares.map((pos) => pos.join(",")).join(" ")}
        data-turns={motion.turnSquares.map((pos) => pos.join(",")).join(" ")}
      >
        {!motion.reducedMotion && <animateMotion dur={`${motion.durationMs}ms`} path={routePath} fill="freeze" />}
        <g className={`motionSprite motionDefendedRoute${reducedClass}`} style={durationStyle(motion)}>
          <MotionPiece piece={motion.piece} cell={cell} />
        </g>
      </g>
    </g>
  );
}

function hiddenPieceKeys(motion: BoardMotionEvent | null): Set<string> {
  const hidden = new Set<string>();
  if (!motion) return hidden;
  if (motion.kind === "move" || motion.kind === "capture") hidden.add(posKey(motion.to));
  if (motion.kind === "place") hidden.add(posKey(motion.at));
  if (motion.kind === "transform") hidden.add(posKey(motion.at));
  if (motion.kind === "defendedKing") hidden.add(posKey(motion.landing));
  return hidden;
}

export function GameBoard({
  board,
  selected = null,
  legalTargets = [],
  placementValid = [],
  defendedKingPreview = null,
  onSquareActivate,
}: GameBoardProps) {
  const pendingDefendedKing = useGameStore((state) => state.pendingDefendedKing);
  const projectedDefendedKing = useGameStore((state) => state.projectedDefendedKing);
  const reducedMotion = useUiSettings((state) => state.reducedMotion);
  const { motion, isAnimating } = useBoardMotion(reducedMotion);
  const hiddenPieces = hiddenPieceKeys(motion);
  const activeDefendedKingPreview =
    defendedKingPreview ??
    (projectedDefendedKing ? { ...projectedDefendedKing.preview, defenders: projectedDefendedKing.defenders } : null) ??
    (pendingDefendedKing
      ? {
          ...pendingDefendedKing.preview,
          defenders: pendingDefendedKing.defenders,
        }
      : null);
  const size = 1200;
  const cell = size / board.config.rows;
  const attackPreviewPath = activeDefendedKingPreview
    ? previewPath(activeDefendedKingPreview.attackerOrigin, activeDefendedKingPreview.attackPath, activeDefendedKingPreview.kingPosition)
    : [];
  const previewRoutes = activeDefendedKingPreview
    ? (activeDefendedKingPreview.routes ?? [
        {
          id: "primary" as const,
          path: activeDefendedKingPreview.bouncePath,
          jumpedSquares: [],
          turnSquares: [],
          landingPosition: activeDefendedKingPreview.landingPosition,
        },
      ])
    : [];
  const attackerPiece = activeDefendedKingPreview ? getPiece(board, activeDefendedKingPreview.attackerOrigin) : null;

  return (
    <div className={`boardFrame${isAnimating ? " isAnimating" : ""}`}>
      <svg
        className="assaltoBoard"
        viewBox={`0 0 ${size} ${size}`}
        role="grid"
        aria-label="Assalto Reale board"
        aria-busy={isAnimating}
        data-animation-state={isAnimating ? "running" : "idle"}
        data-animation-id={motion?.id ?? ""}
        data-animation-type={motion?.kind ?? ""}
      >
        {activeDefendedKingPreview && (
          <desc>
            Defended King projection. The selected route has {activeDefendedKingPreview.bouncePath.length} traversed squares and lands on
            row {activeDefendedKingPreview.landingPosition[0] + 1}, column {activeDefendedKingPreview.landingPosition[1] + 1}. Click the
            King again to commit.
          </desc>
        )}
        <defs>
          <marker id="attackPreviewArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L6,3 Z" className="attackPreviewArrow" />
          </marker>
          <marker id="bouncePreviewArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L6,3 Z" className="bouncePreviewArrow" />
          </marker>
        </defs>

        <rect width={size} height={size} className="boardBed" rx="20" />

        {board.grid.map((row, rowIndex) => (
          // ARIA grid structure: gridcells must be wrapped in a row. The group
          // carries no transform, so this is purely a semantic wrapper with no
          // visual effect on cell positioning (each cell is absolutely placed).
          <g role="row" key={`board-row-${rowIndex}`}>
            {row.map((piece, colIndex) => {
              const pos: Vec2 = [rowIndex, colIndex];
              const x = colIndex * cell;
              const y = rowIndex * cell;
              const isSpecial = hasPos(board.specialSquares, pos);
              const isTransform = hasPos(board.transformSquares, pos);
              const isSelected = selected ? selected[0] === rowIndex && selected[1] === colIndex : false;
              const isLegalTarget = hasPos(legalTargets, pos);
              const isPlacementValid = hasPos(placementValid, pos);
              const isCaptureTarget = isLegalTarget && piece !== null;
              const isDefendedKing = piece?.type === "King" && adjacentDefendersForKing(board, pos, piece.player).length > 0;
              const controlledBy = board.controlledSquares.Black.some((item) => item[0] === rowIndex && item[1] === colIndex)
                ? "Black"
                : board.controlledSquares.White.some((item) => item[0] === rowIndex && item[1] === colIndex)
                  ? "White"
                  : null;
              const label = `${squareLabel(pos, board.config.rows)}${piece ? `, ${piece.player} ${pieceLabel(piece)}` : ""}${isDefendedKing ? ", defended King" : ""}`;
              const activate = () => {
                if (!isAnimating) onSquareActivate?.(pos);
              };

              return (
                <g
                  key={`${rowIndex}-${colIndex}`}
                  role="gridcell"
                  aria-label={`${label}${isSelected ? ", selected" : ""}${isLegalTarget ? ", legal action" : ""}`}
                  aria-disabled={isAnimating || undefined}
                  tabIndex={0}
                  className={`boardCell${isAnimating ? " boardCellLocked" : ""}`}
                  onClick={activate}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      activate();
                    }
                  }}
                >
                  <rect
                    x={x + 2}
                    y={y + 2}
                    width={cell - 4}
                    height={cell - 4}
                    rx="8"
                    className={(rowIndex + colIndex) % 2 === 0 ? "tileDark" : "tileLight"}
                  />
                  {isPlacementValid && (
                    <rect x={x + 10} y={y + 10} width={cell - 20} height={cell - 20} rx="12" className="placementValid" />
                  )}
                  {isSpecial && (
                    <g className={`specialMark ${controlledBy ? `controlled${controlledBy}` : ""}`} aria-hidden="true">
                      <rect
                        x={x + cell * 0.13}
                        y={y + cell * 0.13}
                        width={cell * 0.74}
                        height={cell * 0.74}
                        rx={cell * 0.08}
                        className="specialSquareInset"
                      />
                      <path d={cornerMarkPath(x, y, cell)} className="specialCornerMarks" />
                    </g>
                  )}
                  {isTransform && (
                    <g className="transformMark" aria-hidden="true">
                      <rect
                        x={x + cell * 0.11}
                        y={y + cell * 0.11}
                        width={cell * 0.78}
                        height={cell * 0.78}
                        rx={cell * 0.1}
                        className="transformSquareOuter"
                      />
                      <rect
                        x={x + cell * 0.22}
                        y={y + cell * 0.22}
                        width={cell * 0.56}
                        height={cell * 0.56}
                        rx={cell * 0.08}
                        className="transformSquareInner"
                      />
                    </g>
                  )}
                  {piece && !hiddenPieces.has(posKey(pos)) && (
                    <svg x={x + cell * 0.16} y={y + cell * 0.1} width={cell * 0.68} height={cell * 0.78} viewBox="0 0 100 100">
                      <PieceGlyph piece={piece} />
                    </svg>
                  )}
                  {(rowIndex === 0 || colIndex === 0) && (
                    <text x={x + 12} y={y + 24} className="coordLabel">
                      {rowIndex === 0 ? String.fromCharCode("A".charCodeAt(0) + colIndex) : board.config.rows - rowIndex}
                    </text>
                  )}
                  {isSelected && <rect x={x + 8} y={y + 8} width={cell - 16} height={cell - 16} rx="12" className="selectedRing" />}
                  {isLegalTarget && (
                    <g className={isCaptureTarget ? "captureIndicator" : "moveIndicator"}>
                      <circle cx={x + cell / 2} cy={y + cell / 2} r={isCaptureTarget ? cell * 0.32 : cell * 0.13} />
                      {isCaptureTarget && <circle cx={x + cell / 2} cy={y + cell / 2} r={cell * 0.23} />}
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        ))}

        {activeDefendedKingPreview && (
          <g className="defendedKingPreview" aria-hidden="true">
            <polyline
              className="previewPath previewAttackPath"
              points={pathPoints(attackPreviewPath, cell)}
              markerEnd="url(#attackPreviewArrow)"
            />
            {previewRoutes.map((route) => {
              const selectedRoute = route.id === (activeDefendedKingPreview.selectedRouteId ?? previewRoutes[0]?.id);
              const routed = previewPath(activeDefendedKingPreview.kingPosition, route.path, route.landingPosition);
              return (
                <g key={`preview-route-${route.id}`} className={`previewRoute${selectedRoute ? " selected" : " unselected"}`}>
                  <polyline
                    className="previewPath previewBouncePath"
                    points={pathPoints(routed, cell)}
                    markerEnd="url(#bouncePreviewArrow)"
                  />
                  {route.path.map(([row, col], index) => (
                    <g key={`${route.id}-step-${row}-${col}-${index}`} className="previewRouteStep">
                      <circle cx={col * cell + cell / 2} cy={row * cell + cell / 2} r={cell * 0.105} />
                      <text x={col * cell + cell / 2} y={row * cell + cell * 0.555} textAnchor="middle">
                        {index + 1}
                      </text>
                    </g>
                  ))}
                  {route.jumpedSquares.map(([row, col], index) => (
                    <path
                      key={`${route.id}-jump-${row}-${col}-${index}`}
                      className="previewJumpArc"
                      d={`M ${col * cell + cell * 0.18} ${row * cell + cell * 0.56} Q ${col * cell + cell / 2} ${row * cell + cell * 0.06} ${col * cell + cell * 0.82} ${row * cell + cell * 0.56}`}
                    />
                  ))}
                  {route.turnSquares.map(([row, col], index) => (
                    <circle
                      key={`${route.id}-turn-${index}`}
                      className="previewTurn"
                      cx={col * cell + cell / 2}
                      cy={row * cell + cell / 2}
                      r={cell * 0.2}
                    />
                  ))}
                </g>
              );
            })}

            <rect
              x={activeDefendedKingPreview.attackerOrigin[1] * cell + cell * 0.12}
              y={activeDefendedKingPreview.attackerOrigin[0] * cell + cell * 0.12}
              width={cell * 0.76}
              height={cell * 0.76}
              rx={cell * 0.12}
              className="previewSquare previewAttacker"
            />
            <rect
              x={activeDefendedKingPreview.kingPosition[1] * cell + cell * 0.09}
              y={activeDefendedKingPreview.kingPosition[0] * cell + cell * 0.09}
              width={cell * 0.82}
              height={cell * 0.82}
              rx={cell * 0.14}
              className="previewSquare previewKing"
            />

            {activeDefendedKingPreview.defenders.map(([row, col]) => (
              <g key={`preview-defender-${row}-${col}`} className="previewDefender">
                <rect x={col * cell + cell * 0.14} y={row * cell + cell * 0.14} width={cell * 0.72} height={cell * 0.72} rx={cell * 0.12} />
                <circle cx={col * cell + cell / 2} cy={row * cell + cell / 2} r={cell * 0.08} />
              </g>
            ))}

            <g className={`previewLanding${activeDefendedKingPreview.triggersTransform ? " triggersTransform" : ""}`}>
              <rect
                x={activeDefendedKingPreview.landingPosition[1] * cell + cell * 0.08}
                y={activeDefendedKingPreview.landingPosition[0] * cell + cell * 0.08}
                width={cell * 0.84}
                height={cell * 0.84}
                rx={cell * 0.14}
              />
              <circle
                cx={activeDefendedKingPreview.landingPosition[1] * cell + cell / 2}
                cy={activeDefendedKingPreview.landingPosition[0] * cell + cell / 2}
                r={cell * 0.1}
              />
              {attackerPiece && (
                <svg
                  className="previewGhostAttacker"
                  x={activeDefendedKingPreview.landingPosition[1] * cell + cell * 0.16}
                  y={activeDefendedKingPreview.landingPosition[0] * cell + cell * 0.1}
                  width={cell * 0.68}
                  height={cell * 0.78}
                  viewBox="0 0 100 100"
                >
                  <PieceGlyph piece={attackerPiece} />
                </svg>
              )}
            </g>
          </g>
        )}

        {motion && <MotionOverlay key={motion.id} motion={motion} board={board} cell={cell} />}
      </svg>
    </div>
  );
}
