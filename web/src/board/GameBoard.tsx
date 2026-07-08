import type { BoardState, Piece, Vec2 } from "../game/engine";
import { adjacentDefendersForKing, hasPos } from "../game/engine";
import "./GameBoard.css";

interface GameBoardProps {
  board: BoardState;
  selected?: Vec2 | null;
  legalTargets?: Vec2[];
  placementValid?: Vec2[];
  onSquareActivate?: (pos: Vec2) => void;
}

function pieceLabel(piece: Piece): string {
  return piece.type.replace("Pawn", " Pawn");
}

function PieceGlyph({ piece }: { piece: Piece }) {
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

export function GameBoard({ board, selected = null, legalTargets = [], placementValid = [], onSquareActivate }: GameBoardProps) {
  const size = 1200;
  const cell = size / board.config.rows;

  return (
    <div className="boardFrame">
      <svg className="assaltoBoard" viewBox={`0 0 ${size} ${size}`} role="grid" aria-label="Assalto Reale board">
        <defs>
          <linearGradient id="tileDark" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#141a1d" />
            <stop offset="100%" stopColor="#0b0f11" />
          </linearGradient>
          <linearGradient id="tileLight" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#2a2f2c" />
            <stop offset="100%" stopColor="#1a211e" />
          </linearGradient>
          <radialGradient id="specialGlow">
            <stop offset="0%" stopColor="#d3b56f" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#b89753" stopOpacity="0.08" />
          </radialGradient>
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
                  <g className={`specialMark ${controlledBy ? `controlled${controlledBy}` : ""}`}>
                    <circle cx={x + cell / 2} cy={y + cell / 2} r={cell * 0.26} />
                    <path d={`M ${x + cell / 2} ${y + cell * 0.23} L ${x + cell * 0.69} ${y + cell / 2} L ${x + cell / 2} ${y + cell * 0.77} L ${x + cell * 0.31} ${y + cell / 2} Z`} />
                  </g>
                )}
                {isTransform && (
                  <g className="transformMark">
                    <circle cx={x + cell / 2} cy={y + cell / 2} r={cell * 0.18} />
                    <path d={`M ${x + cell * 0.39} ${y + cell * 0.5} C ${x + cell * 0.42} ${y + cell * 0.34}, ${x + cell * 0.64} ${y + cell * 0.34}, ${x + cell * 0.62} ${y + cell * 0.5}`} />
                    <path d={`M ${x + cell * 0.61} ${y + cell * 0.5} C ${x + cell * 0.58} ${y + cell * 0.66}, ${x + cell * 0.36} ${y + cell * 0.66}, ${x + cell * 0.38} ${y + cell * 0.5}`} />
                  </g>
                )}
                {piece && (
                  <svg x={x + cell * 0.16} y={y + cell * 0.1} width={cell * 0.68} height={cell * 0.78} viewBox="0 0 100 100">
                    <PieceGlyph piece={piece} />
                  </svg>
                )}
                {isDefendedKing && (
                  <g className="defendedKingMark" aria-hidden="true">
                    <path d={`M ${x + cell * 0.72} ${y + cell * 0.18} L ${x + cell * 0.86} ${y + cell * 0.24} L ${x + cell * 0.84} ${y + cell * 0.43} C ${x + cell * 0.82} ${y + cell * 0.55}, ${x + cell * 0.76} ${y + cell * 0.62}, ${x + cell * 0.72} ${y + cell * 0.66} C ${x + cell * 0.66} ${y + cell * 0.62}, ${x + cell * 0.61} ${y + cell * 0.55}, ${x + cell * 0.6} ${y + cell * 0.43} L ${x + cell * 0.58} ${y + cell * 0.24} Z`} />
                    <path d={`M ${x + cell * 0.66} ${y + cell * 0.4} L ${x + cell * 0.7} ${y + cell * 0.46} L ${x + cell * 0.8} ${y + cell * 0.34}`} />
                  </g>
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
      </svg>
    </div>
  );
}
