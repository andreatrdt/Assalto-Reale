import { useEffect } from "react";
import { motion } from "motion/react";
import { GameBoard } from "../board/GameBoard";
import { useGameStore } from "../game/state/gameStore";
import { canPlacePiece, PAWN_TYPES, type Vec2 } from "../game/engine";

export function App() {
  const phase = useGameStore((state) => state.phase.phase);
  const startQuickMatch = useGameStore((state) => state.startQuickMatch);
  const startManualPlacement = useGameStore((state) => state.startManualPlacement);
  const startAiMatch = useGameStore((state) => state.startAiMatch);
  const startTransformMatch = useGameStore((state) => state.startTransformMatch);
  const openRules = useGameStore((state) => state.openRules);
  const returnHome = useGameStore((state) => state.returnHome);
  const board = useGameStore((state) => state.board);
  const currentPlayer = useGameStore((state) => state.currentPlayer);
  const movesThisTurn = useGameStore((state) => state.movesThisTurn);
  const kingMoved = useGameStore((state) => state.kingMoved);
  const turnCounter = useGameStore((state) => state.turnCounter);
  const selected = useGameStore((state) => state.selected);
  const legalTargets = useGameStore((state) => state.legalTargets);
  const currentPlacement = useGameStore((state) => state.currentPlacement);
  const pendingTransform = useGameStore((state) => state.pendingTransform);
  const pendingDefendedKing = useGameStore((state) => state.pendingDefendedKing);
  const aiEnabled = useGameStore((state) => state.aiEnabled);
  const aiPlayer = useGameStore((state) => state.aiPlayer);
  const lastAction = useGameStore((state) => state.lastAction);
  const message = useGameStore((state) => state.message);
  const activateSquare = useGameStore((state) => state.activateSquare);
  const cancelDefenderSelection = useGameStore((state) => state.cancelDefenderSelection);
  const chooseTransform = useGameStore((state) => state.chooseTransform);
  const skipTransform = useGameStore((state) => state.skipTransform);
  const passTurn = useGameStore((state) => state.passTurn);
  const undo = useGameStore((state) => state.undo);
  const saveGame = useGameStore((state) => state.saveGame);
  const loadGame = useGameStore((state) => state.loadGame);
  const runAiTurn = useGameStore((state) => state.runAiTurn);

  useEffect(() => {
    if (aiEnabled && currentPlayer === aiPlayer && (phase === "playing" || phase === "transformSelection" || phase === "defenderSelection")) {
      const id = window.setTimeout(runAiTurn, 360);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [aiEnabled, aiPlayer, currentPlayer, phase, runAiTurn]);

  const placementValid: Vec2[] =
    phase === "placement" && currentPlacement
      ? board.grid.flatMap((row, rowIndex) =>
          row.flatMap((_piece, colIndex) => {
            const pos: Vec2 = [rowIndex, colIndex];
            return canPlacePiece(board, pos, currentPlacement.player, currentPlacement.pieceType).ok ? [pos] : [];
          }),
        )
      : [];

  return (
    <main className="appShell">
      <section className="heroPanel" aria-labelledby="title">
        <motion.div
          className="wordmark"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="crest" aria-hidden="true" />
          <div className="titleBlock">
            <p className="eyebrow">Royal tactical war room</p>
            <h1 id="title">Assalto Reale</h1>
          </div>
        </motion.div>

        <div className="heroActions" aria-label="Main actions">
          <button type="button" className="primaryAction" onClick={() => startQuickMatch()}>
            New Quick Match
          </button>
          <button type="button" onClick={() => startManualPlacement()}>
            Manual Deployment
          </button>
          <button type="button" onClick={startAiMatch}>
            AI Match
          </button>
          <button type="button" onClick={startTransformMatch}>
            Transform Match
          </button>
          <button type="button" onClick={openRules}>
            Rules
          </button>
          {phase !== "home" && (
            <button type="button" onClick={returnHome}>
              Home
            </button>
          )}
        </div>

        <p className="buildInfo">Modern web migration branch. Python engine remains the parity reference.</p>
      </section>

      <section className="boardStage" aria-label="Board preview">
        <GameBoard
          board={board}
          selected={selected}
          legalTargets={legalTargets}
          placementValid={placementValid}
          onSquareActivate={activateSquare}
        />
      </section>

      <aside className="phasePanel" aria-live="polite">
        <p className="eyebrow">Phase</p>
        <h2>{phase}</h2>
        {phase === "rules" ? (
          <div className="rulesPreview">
            <h3>Core objective</h3>
            <p>Capture the King, or hold a strict majority of Special Squares through the opponent response turn.</p>
            <h3>Reference engine</h3>
            <p>The TypeScript engine is wired against deterministic fixtures generated from Python.</p>
          </div>
        ) : phase === "defenderSelection" && pendingDefendedKing ? (
          <div className="matchPanel">
            <p className="statusLine">{message}</p>
            <div className="statGrid">
              <span>Landing</span>
              <strong>{squareName(pendingDefendedKing.preview.landingPosition)}</strong>
              <span>Defenders</span>
              <strong>{pendingDefendedKing.defenders.length}</strong>
              <span>Cost</span>
              <strong>{pendingDefendedKing.preview.actionCost} AP</strong>
            </div>
            <button type="button" onClick={cancelDefenderSelection}>
              Cancel
            </button>
          </div>
        ) : phase === "transformSelection" && pendingTransform ? (
          <div className="matchPanel">
            <p className="statusLine">{message}</p>
            <div className="choiceGrid">
              {PAWN_TYPES.filter((pieceType) => pieceType !== pendingTransform.pieceType).map((pieceType) => (
                <button key={pieceType} type="button" onClick={() => chooseTransform(pieceType)}>
                  {pieceType.replace("Pawn", " Pawn")}
                </button>
              ))}
            </div>
            <button type="button" onClick={skipTransform}>
              Skip Transform
            </button>
          </div>
        ) : phase === "placement" && currentPlacement ? (
          <div className="matchPanel">
            <p className="statusLine">{message}</p>
            <div className="statGrid">
              <span>Deploying</span>
              <strong>{currentPlacement.player}</strong>
              <span>Piece</span>
              <strong>{currentPlacement.pieceType.replace("Pawn", " Pawn")}</strong>
              <span>Valid squares</span>
              <strong>{placementValid.length}</strong>
            </div>
            <button type="button" onClick={undo}>
              Undo Placement
            </button>
          </div>
        ) : phase === "playing" || phase === "gameOver" ? (
          <div className="matchPanel">
            <p className="statusLine">{message}</p>
            <div className="apTrack" aria-label={`${2 - movesThisTurn} action points remaining`}>
              {[0, 1].map((point) => (
                <span key={point} className={point >= movesThisTurn ? "apReady" : "apSpent"} />
              ))}
            </div>
            <div className="statGrid">
              <span>Current player</span>
              <strong>{currentPlayer}</strong>
              <span>Turn</span>
              <strong>{turnCounter}</strong>
              <span>Actions left</span>
              <strong>{Math.max(0, 2 - movesThisTurn)}/2</strong>
              <span>King</span>
              <strong>{kingMoved ? "Acted" : "Ready"}</strong>
              <span>Specials</span>
              <strong>
                {board.controlledSquares.Black.length}-{board.controlledSquares.White.length}
              </strong>
              <span>Claim</span>
              <strong>{board.territoryClaim ? `${board.territoryClaim.claimant} T${board.territoryClaim.matureTurn}` : "None"}</strong>
              <span>Captured</span>
              <strong>
                B {capturedTotal(board, "Black")} / W {capturedTotal(board, "White")}
              </strong>
              <span>Mode</span>
              <strong>{aiEnabled ? `vs ${aiPlayer} AI` : board.config.transformEnabled ? "Transform" : "Local"}</strong>
              <span>Last action</span>
              <strong>{lastAction}</strong>
            </div>
            <div className="panelActions">
              <button type="button" onClick={passTurn} disabled={phase === "gameOver"}>
                Pass
              </button>
              <button type="button" onClick={undo}>
                Undo
              </button>
            </div>
            <div className="panelActions">
              <button type="button" onClick={saveGame}>
                Save
              </button>
              <button type="button" onClick={loadGame}>
                Load
              </button>
            </div>
          </div>
        ) : (
          <p>{message}</p>
        )}
      </aside>
    </main>
  );
}

function squareName(pos: Vec2): string {
  return `${String.fromCharCode("A".charCodeAt(0) + pos[1])}${12 - pos[0]}`;
}

function capturedTotal(board: ReturnType<typeof useGameStore.getState>["board"], player: "Black" | "White"): number {
  return Object.values(board.capturedPieces[player]).reduce((total, count) => total + count, 0);
}
