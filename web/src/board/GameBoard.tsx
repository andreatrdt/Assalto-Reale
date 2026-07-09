import type { BoardState, Piece, Vec2 } from "../game/engine";
import { adjacentDefendersForKing, hasPos } from "../game/engine";
import "./GameBoard.css";

export interface DefendedKingBoardPreview {
  attackerOrigin: Vec2;
  kingPosition: Vec2;
  defenders: Vec2[];
  attackPath: Vec2[];
  bouncePath: Vec2[];
  landingPosition: Vec2;
  triggersTransform: boolean;
}

interface GameBoardProps {
  board: BoardState;
  selected?: Vec2 | null;
  legalTargets?: Vec2[];
  placementValid?: Vec2[];
  defendedKingPreview?: DefendedKingBoardPreview | null;
  onSquareActivate?: (pos: Vec2) => void;
}

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

export function GameBoard({
  board,
  selected = null,
  legalTargets = [],
  placementValid = [],
  defendedKingPreview = null,
  onSquareActivate,
}: GameBoardProps) {
  const size = 1200;
  const cell = size / board.config.rows;
  const attackPreviewPath = defendedKingPreview
    ? previewPath(defendedKingPreview.attackerOrigin, defendedKingPreview.attackPath, defendedKingPreview.kingPosition)
    : [];
  const bouncePreviewPath = defendedKingPreview
    ? previewPath(defendedKingPreview.kingPosition, defendedKingPreview.bouncePath, defendedKingPreview.landingPosition)
    : [];

  return (
    <div className="boardFrame">
      <svg className="assaltoBoard" viewBox={`0 0 ${size} ${size}`} role="grid" aria-label="Assalto Reale board">
        <defs>
          <marker id="attackPreviewArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L6,3 Z" className="attackPreviewArrow" />
          </marker>
          <marker id="bouncePreviewArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L6,3 Z" className="bouncePreviewArrow" />
          </marker>
        </defs>

        <rect width={size} height={size} className="boardBed" rx="20" />

        {board.grid.map((row, rowIndex) =>
          row.map((piece, colIndex) => {
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

            return (
              <g
                key={`${rowIndex}-${colIndex}`}
                role="gridcell"
                aria-label={`${label}${isSelected ? ", selected" : ""}${isLegalTarget ? ", legal action" : ""}`}
                tabIndex={0}
                className="boardCell"
                onClick={() => onSquareActivate?.(pos)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSquareActivate?.(pos);
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
                {piece && (
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
          }),
        )}

        {defendedKingPreview && (
          <g className="defendedKingPreview" aria-hidden="true">
            <polyline
              className="previewPath previewAttackPath"
              points={pathPoints(attackPreviewPath, cell)}
              markerEnd="url(#attackPreviewArrow)"
            />
            <polyline
              className="previewPath previewBouncePath"
              points={pathPoints(bouncePreviewPath, cell)}
              markerEnd="url(#bouncePreviewArrow)"
            />

            <rect
              x={defendedKingPreview.attackerOrigin[1] * cell + cell * 0.12}
              y={defendedKingPreview.attackerOrigin[0] * cell + cell * 0.12}
              width={cell * 0.76}
              height={cell * 0.76}
              rx={cell * 0.12}
              className="previewSquare previewAttacker"
            />
            <rect
              x={defendedKingPreview.kingPosition[1] * cell + cell * 0.09}
              y={defendedKingPreview.kingPosition[0] * cell + cell * 0.09}
              width={cell * 0.82}
              height={cell * 0.82}
              rx={cell * 0.14}
              className="previewSquare previewKing"
            />

            {defendedKingPreview.defenders.map(([row, col]) => (
              <g key={`preview-defender-${row}-${col}`} className="previewDefender">
                <rect
                  x={col * cell + cell * 0.14}
                  y={row * cell + cell * 0.14}
                  width={cell * 0.72}
                  height={cell * 0.72}
                  rx={cell * 0.12}
                />
                <circle cx={col * cell + cell / 2} cy={row * cell + cell / 2} r={cell * 0.08} />
              </g>
            ))}

            <g className={`previewLanding${defendedKingPreview.triggersTransform ? " triggersTransform" : ""}`}>
              <rect
                x={defendedKingPreview.landingPosition[1] * cell + cell * 0.08}
                y={defendedKingPreview.landingPosition[0] * cell + cell * 0.08}
                width={cell * 0.84}
                height={cell * 0.84}
                rx={cell * 0.14}
              />
              <circle
                cx={defendedKingPreview.landingPosition[1] * cell + cell / 2}
                cy={defendedKingPreview.landingPosition[0] * cell + cell / 2}
                r={cell * 0.1}
              />
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}
