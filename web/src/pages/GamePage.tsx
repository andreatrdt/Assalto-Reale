import { useEffect, useMemo, useState } from "react";
import type { AppRoute } from "../app/routes";
import { GameBoard } from "../board/GameBoard";
import { canPlacePiece, PAWN_TYPES, type BoardState, type Player, type Vec2 } from "../game/engine";
import { TIMER_PRESETS } from "../game/setup/matchConfig";
import { useGameStore } from "../game/state/gameStore";
import { ConfirmDialog, FactionBadge, GameButton, Icon, IconButton, StatusBadge } from "../ui/components";

interface GamePageProps {
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function GamePage({ navigate }: GamePageProps) {
  const phase = useGameStore((state) => state.phase.phase);
  const board = useGameStore((state) => state.board);
  const currentPlayer = useGameStore((state) => state.currentPlayer);
  const movesThisTurn = useGameStore((state) => state.movesThisTurn);
  const kingMoved = useGameStore((state) => state.kingMoved);
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
  const startClock = useGameStore((state) => state.startClock);
  const stopClock = useGameStore((state) => state.stopClock);
  const tickClock = useGameStore((state) => state.tickClock);
  const returnHome = useGameStore((state) => state.returnHome);
  const startConfiguredMatch = useGameStore((state) => state.startConfiguredMatch);
  const runAiTurn = useGameStore((state) => state.runAiTurn);
  const [confirmHome, setConfirmHome] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  useEffect(() => {
    const aiOwnsPlacement = phase === "placement" && currentPlacement?.player === aiPlayer;
    const aiOwnsDecision =
      (phase === "transformSelection" && pendingTransform?.owner === aiPlayer) ||
      (phase === "defenderSelection" && pendingDefendedKing?.owner === aiPlayer);
    const aiOwnsTurn = (currentPlayer === aiPlayer && phase === "playing") || aiOwnsDecision;
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
        const latestDecision =
          (latest.phase.phase === "transformSelection" && latest.pendingTransform?.owner === latest.aiPlayer) ||
          (latest.phase.phase === "defenderSelection" && latest.pendingDefendedKing?.owner === latest.aiPlayer);
        const latestTurn =
          (latest.currentPlayer === latest.aiPlayer && latest.phase.phase === "playing") || latestDecision;
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
  const aiControlsTurn =
    aiEnabled &&
    ((currentPlayer === aiPlayer && phase === "playing") ||
      (phase === "transformSelection" && pendingTransform?.owner === aiPlayer) ||
      (phase === "defenderSelection" && pendingDefendedKing?.owner === aiPlayer));
  const clockShouldRun = phase === "playing" && (matchConfig?.timerSeconds ?? 0) > 0 && !aiControlsTurn;
  const activeMessage = aiControlsTurn ? "Computer is thinking." : message;
  const restartSummary = matchConfig ? describeMatchMode(matchConfig) : "No stored match setup";
  const canRestartMatch = Boolean(matchConfig);

  function confirmReturnHome() {
    returnHome();
    setConfirmHome(false);
    navigate("/");
  }

  function restartMatch() {
    if (!matchConfig) return;
    startConfiguredMatch({
      ...matchConfig,
      humanSide: matchConfig.resolvedHumanSide ?? matchConfig.humanSide,
    });
    setConfirmRestart(false);
    navigate("/game");
  }

  useEffect(() => {
    if (!clockShouldRun) {
      stopClock(performance.now());
      return undefined;
    }

    startClock(performance.now());
    const id = window.setInterval(() => tickClock(performance.now()), 250);
    return () => {
      window.clearInterval(id);
      stopClock(performance.now());
    };
  }, [clockShouldRun, currentPlayer, startClock, stopClock, tickClock]);

  return (
    <main className={`gamePage factionTurn${currentPlayer}`}>
      <header className="gameHeader">
        <button
          type="button"
          className="gameBrand"
          onClick={() => setConfirmHome(true)}
          aria-label="Leave match and return to the Assalto Reale home"
        >
          <Icon name="home" />
          <span>Assalto Reale</span>
        </button>
        <div className="gameHeaderActions" aria-label="Match actions">
          <IconButton icon="book" label="Rules" onClick={() => navigate("/rules")} />
          <IconButton icon="gear" label="Settings" onClick={() => navigate("/settings")} />
          <IconButton
            icon="warning"
            label={canRestartMatch ? "Restart match" : "Restart unavailable until a match setup is stored"}
            variant="danger"
            onClick={() => setConfirmRestart(true)}
            disabled={!canRestartMatch}
          />
        </div>
      </header>

      <div className="gameLayout">
        <GameStatus
          phase={phase}
          currentPlayer={currentPlayer}
          currentPlacement={currentPlacement}
          movesThisTurn={movesThisTurn}
          aiControlsTurn={Boolean(aiControlsTurn)}
          board={board}
          timerSeconds={matchConfig?.timerSeconds ?? 0}
          timeLeft={timeLeft}
          timerLabel={timerLabel}
          selectedWithoutTargets={Boolean(selected) && legalTargets.length === 0}
        />

        <div className="gameBoardArea" aria-label="Game board">
          <GameBoard
            board={board}
            selected={selected}
            legalTargets={legalTargets}
            placementValid={placementValid}
            onSquareActivate={activateSquare}
          />
        </div>

        <aside className="gamePanel" aria-label="Match controls" aria-live="polite">
          {phase === "placement" && currentPlacement ? (
            <PlacementPanel
              currentPlacement={currentPlacement}
              piecesLeft={piecesLeft}
              placementCursor={placementCursor}
              placementValidCount={placementValid.length}
              message={activeMessage}
              undo={undo}
              saveGame={saveGame}
              disabled={aiEnabled && currentPlacement.player === aiPlayer}
            />
          ) : phase === "defenderSelection" && pendingDefendedKing ? (
            <DefendedKingPanel pendingDefendedKing={pendingDefendedKing} message={activeMessage} cancel={cancelDefenderSelection} />
          ) : phase === "transformSelection" && pendingTransform ? (
            <TransformPanel pendingTransform={pendingTransform} message={activeMessage} chooseTransform={chooseTransform} />
          ) : phase === "gameOver" ? (
            <VictoryPanel message={activeMessage} saveGame={saveGame} rematch={() => setConfirmRestart(true)} newMatch={() => navigate("/setup")} home={() => setConfirmHome(true)} />
          ) : (
            <MatchPanel
              board={board}
              lastAction={lastAction}
              passTurn={passTurn}
              undo={undo}
              saveGame={saveGame}
              loadGame={loadGame}
              disabled={Boolean(aiControlsTurn)}
            />
          )}
        </aside>
      </div>

      {confirmHome && (
        <ConfirmDialog title="Return to menu?" confirmLabel="Return Home" onConfirm={confirmReturnHome} onCancel={() => setConfirmHome(false)}>
          <p>Your active match remains in memory and can be continued from Home. Save first if you want a local browser save.</p>
        </ConfirmDialog>
      )}

      {confirmRestart && (
        <ConfirmDialog title="Restart this match?" confirmLabel="Restart Match" danger onConfirm={restartMatch} onCancel={() => setConfirmRestart(false)}>
          <p>
            This rebuilds a fresh board from the stored setup: {restartSummary}. The current board, move history and unresolved selections will be cleared.
          </p>
        </ConfirmDialog>
      )}
    </main>
  );
}

export function GameStatus({
  phase,
  currentPlayer,
  currentPlacement,
  movesThisTurn,
  aiControlsTurn,
  board,
  timerSeconds,
  timeLeft,
  timerLabel,
  selectedWithoutTargets,
}: {
  phase: string;
  currentPlayer: Player;
  currentPlacement: { player: Player; pieceType: string } | null;
  movesThisTurn: number;
  aiControlsTurn: boolean;
  board: BoardState;
  timerSeconds: number;
  timeLeft: Record<Player, number>;
  timerLabel: string;
  selectedWithoutTargets: boolean;
}) {
  const timed = timerSeconds > 0;
  const showActionPoints = phase === "playing";
  const headline = statusHeadline(phase, currentPlayer, currentPlacement, aiControlsTurn);
  const totalSpecial = board.specialSquares.length;
  const blackControl = board.controlledSquares.Black.length;
  const whiteControl = board.controlledSquares.White.length;
  const territoryRelevant = blackControl > 0 || whiteControl > 0 || Boolean(board.territoryClaim);

  return (
    <section className="gameStatus" aria-label="Match status" aria-live="polite">
      <div className="statusPrimary">
        <FactionBadge player={currentPlayer} active />
        <p className="statusHeadline">{headline}</p>
      </div>

      {showActionPoints && (
        <div className="statusAp">
          <ActionPointTrack movesThisTurn={movesThisTurn} />
          <span className="statusApText">{Math.max(0, 2 - movesThisTurn)} actions remaining</span>
        </div>
      )}

      {timed && (
        <div className="clockStrip" aria-label="Player clocks">
          <PlayerClock player="Black" seconds={timeLeft.Black} timerLabel={timerLabel} active={currentPlayer === "Black"} />
          <PlayerClock player="White" seconds={timeLeft.White} timerLabel={timerLabel} active={currentPlayer === "White"} />
        </div>
      )}

      {territoryRelevant && (
        <div className="statusTerritory" aria-label="Territory control">
          {blackControl > 0 && (
            <p>
              Black controls {blackControl} of {totalSpecial} Special Squares
            </p>
          )}
          {whiteControl > 0 && (
            <p>
              White controls {whiteControl} of {totalSpecial} Special Squares
            </p>
          )}
          {board.territoryClaim && (
            <p>
              {board.territoryClaim.claimant}&apos;s claim matures on turn {board.territoryClaim.matureTurn}
            </p>
          )}
        </div>
      )}

      {selectedWithoutTargets && (
        <StatusBadge tone="danger" icon="warning">
          No legal targets
        </StatusBadge>
      )}
    </section>
  );
}

export function PlacementPanel({
  currentPlacement,
  piecesLeft,
  placementCursor,
  placementValidCount,
  message,
  undo,
  saveGame,
  disabled,
}: {
  currentPlacement: { player: Player; pieceType: string };
  piecesLeft: Record<Player, Record<string, number>>;
  placementCursor: number;
  placementValidCount: number;
  message: string;
  undo: () => void;
  saveGame: () => void;
  disabled: boolean;
}) {
  return (
    <div className="matchPanel">
      <p className="statusLine">{message}</p>
      <dl className="hudList">
        <div>
          <dt>Progress</dt>
          <dd>{placementCursor}/26</dd>
        </div>
        <div>
          <dt>Valid squares</dt>
          <dd>{placementValidCount}</dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd>{Object.values(piecesLeft[currentPlacement.player]).reduce((total, count) => total + count, 0)}</dd>
        </div>
      </dl>
      {disabled && (
        <StatusBadge tone="info" icon="gear">
          Computer is placing this piece.
        </StatusBadge>
      )}
      <div className="commandGrid">
        <GameButton variant="secondary" onClick={undo} disabled={disabled}>
          Undo
        </GameButton>
        <GameButton variant="secondary" icon="save" onClick={saveGame}>
          Save
        </GameButton>
      </div>
    </div>
  );
}

export function DefendedKingPanel({
  pendingDefendedKing,
  message,
  cancel,
}: {
  pendingDefendedKing: NonNullable<ReturnType<typeof useGameStore.getState>["pendingDefendedKing"]>;
  message: string;
  cancel: () => void;
}) {
  const attackingPlayer = pendingDefendedKing.action.player;
  const defendingPlayer = pendingDefendedKing.owner;
  const defenderText = formatPath(pendingDefendedKing.defenders);
  const needsChoice = pendingDefendedKing.defenders.length > 1;

  return (
    <div className="matchPanel">
      <StatusBadge tone="gold" icon="shield">
        Defended King
      </StatusBadge>
      <p className="statusLine">{message}</p>
      <dl className="hudList">
        <div>
          <dt>Attacking pawn</dt>
          <dd>
            {attackingPlayer} at {squareName(pendingDefendedKing.preview.attackerOrigin)}
          </dd>
        </div>
        <div>
          <dt>Attacked King</dt>
          <dd>
            {defendingPlayer} King at {squareName(pendingDefendedKing.preview.kingPosition)}
          </dd>
        </div>
        <div>
          <dt>Attack path</dt>
          <dd>{formatPath(pendingDefendedKing.preview.attackPath)}</dd>
        </div>
        <div>
          <dt>Bounce path</dt>
          <dd>{formatPath(pendingDefendedKing.preview.bouncePath)}</dd>
        </div>
        <div>
          <dt>Landing</dt>
          <dd>{squareName(pendingDefendedKing.preview.landingPosition)}</dd>
        </div>
        <div>
          <dt>Defenders</dt>
          <dd>{defenderText}</dd>
        </div>
        <div>
          <dt>Decision</dt>
          <dd>{needsChoice ? `${defendingPlayer} chooses one highlighted defender` : `Confirm highlighted defender ${defenderText}`}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>{pendingDefendedKing.preview.actionCost} AP</dd>
        </div>
        <div>
          <dt>Transform</dt>
          <dd>{pendingDefendedKing.preview.triggersTransform ? "Triggered on landing" : "Not triggered"}</dd>
        </div>
        <div>
          <dt>Turn result</dt>
          <dd>{pendingDefendedKing.preview.endsTurn ? "Ends turn" : "Continues turn"}</dd>
        </div>
      </dl>
      <StatusBadge tone="info" icon="warning">
        Choose the defender by selecting a highlighted square on the board.
      </StatusBadge>
      <GameButton variant="ghost" onClick={cancel}>
        Cancel Attack
      </GameButton>
    </div>
  );
}

export function TransformPanel({
  pendingTransform,
  message,
  chooseTransform,
}: {
  pendingTransform: NonNullable<ReturnType<typeof useGameStore.getState>["pendingTransform"]>;
  message: string;
  chooseTransform: (pieceType: (typeof PAWN_TYPES)[number]) => void;
}) {
  return (
    <div className="matchPanel">
      <StatusBadge tone="info" icon="spark">
        Transform
      </StatusBadge>
      <p className="statusLine">{message}</p>
      <div className="choiceGrid">
        {PAWN_TYPES.filter((pieceType) => pieceType !== pendingTransform.pieceType).map((pieceType) => (
          <GameButton key={pieceType} variant="secondary" onClick={() => chooseTransform(pieceType)}>
            {pieceType.replace("Pawn", " Pawn")}
          </GameButton>
        ))}
      </div>
    </div>
  );
}

export function MatchPanel({
  board,
  lastAction,
  passTurn,
  undo,
  saveGame,
  loadGame,
  disabled,
}: {
  board: BoardState;
  lastAction: string;
  passTurn: () => void;
  undo: () => void;
  saveGame: () => void;
  loadGame: () => void;
  disabled: boolean;
}) {
  return (
    <div className="matchPanel">
      <dl className="hudList">
        <div>
          <dt>Last move</dt>
          <dd>{lastAction}</dd>
        </div>
      </dl>
      <CapturedPieces board={board} />
      <div className="commandGrid">
        <GameButton variant="primary" onClick={passTurn} disabled={disabled}>
          Pass
        </GameButton>
        <GameButton variant="secondary" onClick={undo} disabled={disabled}>
          Undo
        </GameButton>
        <GameButton variant="secondary" icon="save" onClick={saveGame}>
          Save
        </GameButton>
        <GameButton variant="secondary" icon="load" onClick={loadGame}>
          Load
        </GameButton>
      </div>
    </div>
  );
}

export function VictoryPanel({
  message,
  saveGame,
  rematch,
  newMatch,
  home,
}: {
  message: string;
  saveGame: () => void;
  rematch: () => void;
  newMatch: () => void;
  home: () => void;
}) {
  return (
    <div className="matchPanel victoryPanel">
      <StatusBadge tone="success" icon="crown">
        Match complete
      </StatusBadge>
      <p className="statusLine">{message}</p>
      <div className="commandGrid">
        <GameButton variant="primary" onClick={rematch}>
          Rematch
        </GameButton>
        <GameButton variant="primary" icon="play" onClick={newMatch}>
          New Match
        </GameButton>
        <GameButton variant="secondary" icon="save" onClick={saveGame}>
          Save
        </GameButton>
        <GameButton variant="ghost" icon="home" onClick={home}>
          Home
        </GameButton>
      </div>
    </div>
  );
}

function CapturedPieces({ board }: { board: BoardState }) {
  return (
    <div className="capturedBox" aria-label="Captured pieces">
      <p className="eyebrow">Captured</p>
      <span>Black: {capturedByType(board, "Black")}</span>
      <span>White: {capturedByType(board, "White")}</span>
    </div>
  );
}

function PlayerClock({ player, seconds, timerLabel, active }: { player: Player; seconds: number; timerLabel: string; active: boolean }) {
  return (
    <div className={active ? "playerClock isActive" : "playerClock"}>
      <FactionBadge player={player} active={active} />
      <strong>{timerLabel === "Untimed" ? "Untimed" : formatClock(seconds)}</strong>
    </div>
  );
}

function ActionPointTrack({ movesThisTurn }: { movesThisTurn: number }) {
  return (
    <div className="apTrack" aria-label={`${2 - movesThisTurn} action points remaining`}>
      {[0, 1].map((point) => (
        <span key={point} className={point >= movesThisTurn ? "apReady" : "apSpent"}>
          {point >= movesThisTurn ? "Ready" : "Spent"}
        </span>
      ))}
    </div>
  );
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

function statusHeadline(phase: string, currentPlayer: Player, currentPlacement: { player: Player; pieceType: string } | null, aiControlsTurn: boolean): string {
  if (phase === "gameOver") return "Match complete";
  if (phase === "placement") {
    return currentPlacement ? `${currentPlacement.player} is placing ${withArticle(pieceLabel(currentPlacement.pieceType))}` : "Manual placement";
  }
  if (phase === "defenderSelection") return "Defended King decision";
  if (phase === "transformSelection") return "Transform decision";
  if (aiControlsTurn) return "Computer is thinking";
  return `${currentPlayer} to move`;
}

function pieceLabel(pieceType: string): string {
  return pieceType.replace("Pawn", " Pawn");
}

function withArticle(label: string): string {
  return `${/^[AEIOU]/i.test(label) ? "an" : "a"} ${label}`;
}

function squareName(pos: Vec2): string {
  return `${String.fromCharCode("A".charCodeAt(0) + pos[1])}${12 - pos[0]}`;
}

function formatPath(path: Vec2[]): string {
  return path.length > 0 ? path.map(squareName).join(" -> ") : "None";
}

function capturedByType(board: BoardState, player: Player): string {
  return Object.entries(board.capturedPieces[player])
    .map(([piece, count]) => `${piece.replace("Pawn", "")} ${count}`)
    .join(" / ");
}

function describeMatchMode(config: NonNullable<ReturnType<typeof useGameStore.getState>["matchConfig"]>): string {
  const opponent = config.opponent === "Computer" ? `vs ${config.aiDifficulty} AI` : "Human vs Human";
  const placement = config.placementMode === "Manual" ? "Manual" : "Quick";
  return `${opponent}, ${placement}${config.transformEnabled ? ", Transform" : ""}`;
}
