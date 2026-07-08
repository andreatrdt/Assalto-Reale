import { useEffect, useMemo, useState } from "react";
import type { AppRoute } from "../app/routes";
import { GameBoard } from "../board/GameBoard";
import { adjacentDefendersForKing, canPlacePiece, PAWN_TYPES, type BoardState, type Player, type Vec2 } from "../game/engine";
import { TIMER_PRESETS } from "../game/setup/matchConfig";
import { useGameStore } from "../game/state/gameStore";
import { ConfirmDialog, FactionBadge, GameButton, IconButton, Panel, StatusBadge } from "../ui/components";

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
  const defendedKings = useMemo(() => getDefendedKingStatus(board), [board]);
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
      <header className="gameCommandBar">
        <div className="gameBrandBlock">
          <p className="eyebrow">Command table</p>
          <h1>Assalto Reale</h1>
        </div>
        <div className="turnBanner" aria-live="polite">
          <FactionBadge player={currentPlayer} active />
          <span>{phase === "placement" ? "Deployment phase" : phaseLabel(phase)}</span>
          {aiControlsTurn && (
            <StatusBadge tone="info" icon="gear">
              AI thinking
            </StatusBadge>
          )}
        </div>
        <div className="clockStrip" aria-label="Player clocks">
          <PlayerClock player="Black" seconds={timeLeft.Black} timerLabel={timerLabel} active={currentPlayer === "Black"} />
          <PlayerClock player="White" seconds={timeLeft.White} timerLabel={timerLabel} active={currentPlayer === "White"} />
        </div>
        <div className="gameTopActions" aria-label="Match navigation">
          <IconButton icon="book" label="Rules" onClick={() => navigate("/rules")} />
          <IconButton icon="gear" label="Settings" onClick={() => navigate("/settings")} />
          <IconButton
            icon="warning"
            label={canRestartMatch ? "Restart match" : "Restart unavailable until a match setup is stored"}
            variant="danger"
            onClick={() => setConfirmRestart(true)}
            disabled={!canRestartMatch}
          />
          <GameButton variant="ghost" icon="home" onClick={() => setConfirmHome(true)}>
            Menu
          </GameButton>
        </div>
      </header>

      <section className="gameTable">
        <Panel as="aside" tone="strong" className="gameRail leftRail" aria-label="Player status">
          <div className="railSection">
            <p className="eyebrow">Turn</p>
            <h2>{phase === "placement" ? "Deployment" : currentPlayer}</h2>
            <ActionPointTrack movesThisTurn={movesThisTurn} />
          </div>
          <dl className="hudList">
            <div>
              <dt>Half-turn</dt>
              <dd>{turnCounter}</dd>
            </div>
            <div>
              <dt>Actions left</dt>
              <dd>{Math.max(0, 2 - movesThisTurn)}/2</dd>
            </div>
            <div>
              <dt>King status</dt>
              <dd>{kingMoved ? "Acted" : "Ready"}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{matchConfig ? describeMatchMode(matchConfig) : "Local"}</dd>
            </div>
          </dl>
          <div className="defenseStatus" aria-label="Defended Kings">
            <StatusBadge tone={defendedKings.Black ? "gold" : "neutral"} icon="shield">
              Black King {defendedKings.Black ? "defended" : "exposed"}
            </StatusBadge>
            <StatusBadge tone={defendedKings.White ? "gold" : "neutral"} icon="shield">
              White King {defendedKings.White ? "defended" : "exposed"}
            </StatusBadge>
          </div>
        </Panel>

        <section className="boardCommandCenter" aria-label="Board and current status">
          <div className="statusRibbon">
            <StatusBadge tone={phase === "gameOver" ? "success" : aiControlsTurn ? "info" : "gold"} icon={phase === "gameOver" ? "crown" : "spark"}>
              {activeMessage}
            </StatusBadge>
            {selected && legalTargets.length === 0 && (
              <StatusBadge tone="danger" icon="warning">
                No legal targets
              </StatusBadge>
            )}
          </div>
          <section className="boardStage" aria-label="Game board">
            <GameBoard
              board={board}
              selected={selected}
              legalTargets={legalTargets}
              placementValid={placementValid}
              onSquareActivate={activateSquare}
            />
          </section>
        </section>

        <Panel as="aside" tone="strong" className="gameRail rightRail" aria-live="polite">
          <p className="eyebrow">Orders</p>
          <h2>{phaseLabel(phase)}</h2>
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
              message={activeMessage}
              board={board}
              currentPlayer={currentPlayer}
              lastAction={lastAction}
              passTurn={passTurn}
              undo={undo}
              saveGame={saveGame}
              loadGame={loadGame}
              disabled={aiControlsTurn}
            />
          )}
        </Panel>
      </section>

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
          <dt>Deploying</dt>
          <dd>{currentPlacement.player}</dd>
        </div>
        <div>
          <dt>Piece</dt>
          <dd>{currentPlacement.pieceType.replace("Pawn", " Pawn")}</dd>
        </div>
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
          Computer is deploying this piece.
        </StatusBadge>
      )}
      <StatusBadge tone="success" icon="save">
        Placement can be saved: board, progress, remaining pieces and match settings are included.
      </StatusBadge>
      <div className="commandGrid">
        <GameButton variant="secondary" icon="chevron" onClick={undo} disabled={disabled}>
          Undo Placement
        </GameButton>
        <GameButton variant="secondary" icon="save" onClick={saveGame}>
          Save Deployment
        </GameButton>
      </div>
      <p className="helperText">Saves during unresolved Defended-King or Transform decisions still need fuller modal-state serialization.</p>
    </div>
  );
}

function DefendedKingPanel({
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
        Defended King preview
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
        The board highlight is the source of truth for the defender choice.
      </StatusBadge>
      <p className="helperText">Explicit preview-owner state and engine-provided animation steps remain documented parity work; this panel shows only state currently exposed by the store.</p>
      <GameButton variant="ghost" onClick={cancel}>
        Cancel Attack
      </GameButton>
    </div>
  );
}

function TransformPanel({
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
        Transform Square
      </StatusBadge>
      <p className="statusLine">{message}</p>
      <div className="choiceGrid">
        {PAWN_TYPES.filter((pieceType) => pieceType !== pendingTransform.pieceType).map((pieceType) => (
          <GameButton key={pieceType} variant="secondary" icon="spark" onClick={() => chooseTransform(pieceType)}>
            {pieceType.replace("Pawn", " Pawn")}
          </GameButton>
        ))}
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
}: {
  message: string;
  board: BoardState;
  currentPlayer: Player;
  lastAction: string;
  passTurn: () => void;
  undo: () => void;
  saveGame: () => void;
  loadGame: () => void;
  disabled: boolean;
}) {
  return (
    <div className="matchPanel">
      <p className="statusLine">{message}</p>
      <dl className="hudList">
        <div>
          <dt>Current player</dt>
          <dd>{currentPlayer}</dd>
        </div>
        <div>
          <dt>Special control</dt>
          <dd>
            Black {board.controlledSquares.Black.length} / White {board.controlledSquares.White.length}
          </dd>
        </div>
        <div>
          <dt>Territory claim</dt>
          <dd>{board.territoryClaim ? `${board.territoryClaim.claimant} matures on turn ${board.territoryClaim.matureTurn}` : "None"}</dd>
        </div>
        <div>
          <dt>Last action</dt>
          <dd>{lastAction}</dd>
        </div>
      </dl>
      <CapturedPieces board={board} />
      <div className="commandGrid">
        <GameButton variant="primary" icon="chevron" onClick={passTurn} disabled={disabled}>
          Pass
        </GameButton>
        <GameButton variant="secondary" icon="chevron" onClick={undo} disabled={disabled}>
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

function VictoryPanel({
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
        <GameButton variant="primary" icon="crown" onClick={rematch}>
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

function getDefendedKingStatus(board: BoardState): Record<Player, boolean> {
  const status: Record<Player, boolean> = { Black: false, White: false };
  for (let row = 0; row < board.config.rows; row += 1) {
    for (let col = 0; col < board.config.cols; col += 1) {
      const piece = board.grid[row][col];
      if (piece?.type === "King") {
        status[piece.player] = adjacentDefendersForKing(board, [row, col], piece.player).length > 0;
      }
    }
  }
  return status;
}
