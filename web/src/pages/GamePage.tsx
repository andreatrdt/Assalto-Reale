import { useEffect, useMemo } from "react";
import type { AppRoute } from "../app/routes";
import { GameBoard } from "../board/GameBoard";
import { canPlacePiece, PAWN_TYPES, type Player, type Vec2 } from "../game/engine";
import { TIMER_PRESETS } from "../game/setup/matchConfig";
import { useGameStore } from "../game/state/gameStore";

interface GamePageProps {
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function GamePage({ navigate }: GamePageProps) {
  const phase = useGameStore((state) => state.phase.phase);
  const board = useGameStore((state) => state.board);
  const currentPlayer = useGameStore((state) => state.currentPlayer);
  const movesThisTurn = useGameStore((state) => state.movesThisTurn);
  const kingMoved = useGameStore((state) => state.kingMoved);
  const turnCounter = useGameStore((state) => state.turnCounter);
  const selected = useGameStore((state) => state.selected);
  const legalTargets = useGameStore((state) => state.legalTargets);
  const currentPlacement = useGameStore((state) => state.currentPlacement);
  const placementCursor = useGameStore((state) => state.placementCursor);
  const piecesLeft = useGameStore((state) => state.piecesLeft);
  const pendingTransform = useGameStore((state) => state.pendingTransform);
  const pendingDefendedKing = useGameStore((state) => state.pendingDefendedKing);
  const aiEnabled = useGameStore((state) => state.aiEnabled);
  const aiPlayer = useGameStore((state) => state.aiPlayer);
  const matchConfig = useGameStore((state) => state.matchConfig);
  const timeLeft = useGameStore((state) => state.timeLeft);
  const lastAction = useGameStore((state) => state.lastAction);
  const message = useGameStore((state) => state.message);
  const activateSquare = useGameStore((state) => state.activateSquare);
  const cancelDefenderSelection = useGameStore((state) => state.cancelDefenderSelection);
  const chooseTransform = useGameStore((state) => state.chooseTransform);
  const passTurn = useGameStore((state) => state.passTurn);
  const undo = useGameStore((state) => state.undo);
  const saveGame = useGameStore((state) => state.saveGame);
  const loadGame = useGameStore((state) => state.loadGame);
  const returnHome = useGameStore((state) => state.returnHome);
  const runAiTurn = useGameStore((state) => state.runAiTurn);

  useEffect(() => {
    const aiOwnsPlacement = phase === "placement" && currentPlacement?.player === aiPlayer;
    const aiOwnsTurn = currentPlayer === aiPlayer && (phase === "playing" || phase === "transformSelection" || phase === "defenderSelection");
    if (!aiEnabled || (!aiOwnsPlacement && !aiOwnsTurn)) {
      return undefined;
    }

    let cancelled = false;
    async function runPacedAi() {
      for (let step = 0; step < 4 && !cancelled; step += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 360));
        if (cancelled) return;
        const latest = useGameStore.getState();
        const latestPlacement = latest.phase.phase === "placement" && latest.currentPlacement?.player === latest.aiPlayer;
        const latestTurn =
          latest.currentPlayer === latest.aiPlayer &&
          (latest.phase.phase === "playing" || latest.phase.phase === "transformSelection" || latest.phase.phase === "defenderSelection");
        if (!latest.aiEnabled || (!latestPlacement && !latestTurn)) return;
        latest.runAiTurn();
      }
    }
    void runPacedAi();
    return () => {
      cancelled = true;
    };
  }, [
    aiEnabled,
    aiPlayer,
    currentPlayer,
    currentPlacement?.player,
    kingMoved,
    movesThisTurn,
    pendingDefendedKing,
    pendingTransform,
    phase,
    placementCursor,
    runAiTurn,
  ]);

  const placementValid = useMemo<Vec2[]>(() => {
    if (phase !== "placement" || !currentPlacement) return [];
    return board.grid.flatMap((row, rowIndex) =>
      row.flatMap((_piece, colIndex) => {
        const pos: Vec2 = [rowIndex, colIndex];
        return canPlacePiece(board, pos, currentPlacement.player, currentPlacement.pieceType).ok ? [pos] : [];
      }),
    );
  }, [board, currentPlacement, phase]);

  const timerLabel = TIMER_PRESETS.find((preset) => preset.seconds === matchConfig?.timerSeconds)?.label ?? "12 minutes";
  const aiControlsTurn = aiEnabled && currentPlayer === aiPlayer && phase === "playing";

  function goHome() {
    returnHome();
    navigate("/");
  }

  return (
    <main className="gamePage">
      <header className="gameTopbar">
        <div>
          <p className="eyebrow">Active match</p>
          <h1>Assalto Reale</h1>
        </div>
        <div className="clockStrip" aria-label="Player clocks">
          <PlayerClock player="Black" seconds={timeLeft.Black} timerLabel={timerLabel} active={currentPlayer === "Black"} />
          <PlayerClock player="White" seconds={timeLeft.White} timerLabel={timerLabel} active={currentPlayer === "White"} />
        </div>
        <button type="button" onClick={goHome}>
          Return to Menu
        </button>
      </header>

      <section className="gameLayout">
        <aside className="matchHud playerHud" aria-label="Player status">
          <p className="eyebrow">Turn</p>
          <h2>{phase === "placement" ? "Deployment" : currentPlayer}</h2>
          <div className="apTrack" aria-label={`${2 - movesThisTurn} action points remaining`}>
            {[0, 1].map((point) => (
              <span key={point} className={point >= movesThisTurn ? "apReady" : "apSpent"} />
            ))}
          </div>
          <div className="statGrid">
            <span>Turn</span>
            <strong>{turnCounter}</strong>
            <span>Actions left</span>
            <strong>{Math.max(0, 2 - movesThisTurn)}/2</strong>
            <span>King</span>
            <strong>{kingMoved ? "Acted" : "Ready"}</strong>
            <span>Mode</span>
            <strong>{matchConfig ? describeMatchMode(matchConfig) : "Local"}</strong>
          </div>
        </aside>

        <section className="boardStage" aria-label="Game board">
          <GameBoard
            board={board}
            selected={selected}
            legalTargets={legalTargets}
            placementValid={placementValid}
            onSquareActivate={activateSquare}
          />
        </section>

        <aside className="matchHud actionHud" aria-live="polite">
          <p className="eyebrow">Command</p>
          <h2>{phaseLabel(phase)}</h2>
          {phase === "placement" && currentPlacement ? (
            <PlacementPanel
              currentPlacement={currentPlacement}
              piecesLeft={piecesLeft}
              placementCursor={placementCursor}
              placementValidCount={placementValid.length}
              message={message}
              undo={undo}
            />
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
            </div>
          ) : (
            <MatchPanel
              message={aiControlsTurn ? "Computer is thinking." : message}
              board={board}
              currentPlayer={currentPlayer}
              lastAction={lastAction}
              passTurn={passTurn}
              undo={undo}
              saveGame={saveGame}
              loadGame={loadGame}
              disabled={phase === "gameOver" || aiControlsTurn}
              navigate={navigate}
            />
          )}
        </aside>
      </section>
    </main>
  );
}

function PlacementPanel({
  currentPlacement,
  piecesLeft,
  placementCursor,
  placementValidCount,
  message,
  undo,
}: {
  currentPlacement: { player: Player; pieceType: string };
  piecesLeft: Record<Player, Record<string, number>>;
  placementCursor: number;
  placementValidCount: number;
  message: string;
  undo: () => void;
}) {
  return (
    <div className="matchPanel">
      <p className="statusLine">{message}</p>
      <div className="statGrid">
        <span>Deploying</span>
        <strong>{currentPlacement.player}</strong>
        <span>Piece</span>
        <strong>{currentPlacement.pieceType.replace("Pawn", " Pawn")}</strong>
        <span>Progress</span>
        <strong>{placementCursor}/26</strong>
        <span>Valid squares</span>
        <strong>{placementValidCount}</strong>
        <span>Remaining</span>
        <strong>{Object.values(piecesLeft[currentPlacement.player]).reduce((total, count) => total + count, 0)}</strong>
      </div>
      <div className="panelActions">
        <button type="button" onClick={undo}>
          Undo Placement
        </button>
        <button type="button" disabled>
          Restart Placement
        </button>
      </div>
    </div>
  );
}

function MatchPanel({
  message,
  board,
  currentPlayer,
  lastAction,
  passTurn,
  undo,
  saveGame,
  loadGame,
  disabled,
  navigate,
}: {
  message: string;
  board: ReturnType<typeof useGameStore.getState>["board"];
  currentPlayer: Player;
  lastAction: string;
  passTurn: () => void;
  undo: () => void;
  saveGame: () => void;
  loadGame: () => void;
  disabled: boolean;
  navigate: (route: AppRoute, replace?: boolean) => void;
}) {
  return (
    <div className="matchPanel">
      <p className="statusLine">{message}</p>
      <div className="statGrid">
        <span>Current player</span>
        <strong>{currentPlayer}</strong>
        <span>Special control</span>
        <strong>
          {board.controlledSquares.Black.length}-{board.controlledSquares.White.length}
        </strong>
        <span>Territory claim</span>
        <strong>{board.territoryClaim ? `${board.territoryClaim.claimant} matures on turn ${board.territoryClaim.matureTurn}` : "None"}</strong>
        <span>Captured Black</span>
        <strong>{capturedByType(board, "Black")}</strong>
        <span>Captured White</span>
        <strong>{capturedByType(board, "White")}</strong>
        <span>Last action</span>
        <strong>{lastAction}</strong>
      </div>
      <div className="panelActions">
        <button type="button" onClick={passTurn} disabled={disabled}>
          Pass
        </button>
        <button type="button" onClick={undo} disabled={disabled}>
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
      <button type="button" onClick={() => navigate("/rules")}>
        Rules
      </button>
    </div>
  );
}

function PlayerClock({ player, seconds, timerLabel, active }: { player: Player; seconds: number; timerLabel: string; active: boolean }) {
  return (
    <div className={active ? "playerClock isActive" : "playerClock"}>
      <span>{player}</span>
      <strong>{timerLabel === "Untimed" ? "Untimed" : formatClock(seconds)}</strong>
    </div>
  );
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

function phaseLabel(phase: string): string {
  if (phase === "gameOver") return "Victory";
  if (phase === "placement") return "Manual Placement";
  if (phase === "defenderSelection") return "Defended King";
  if (phase === "transformSelection") return "Transform";
  return "Actions";
}

function squareName(pos: Vec2): string {
  return `${String.fromCharCode("A".charCodeAt(0) + pos[1])}${12 - pos[0]}`;
}

function capturedByType(board: ReturnType<typeof useGameStore.getState>["board"], player: Player): string {
  return Object.entries(board.capturedPieces[player])
    .map(([piece, count]) => `${piece.replace("Pawn", "")} ${count}`)
    .join(" / ");
}

function describeMatchMode(config: NonNullable<ReturnType<typeof useGameStore.getState>["matchConfig"]>): string {
  const opponent = config.opponent === "Computer" ? `vs ${config.aiDifficulty} AI` : "Human vs Human";
  const placement = config.placementMode === "Manual" ? "Manual" : "Quick";
  return `${opponent}, ${placement}${config.transformEnabled ? ", Transform" : ""}`;
}
