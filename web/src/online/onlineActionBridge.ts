import {
  getPiece,
  hasPos,
  type PawnType,
  type Vec2,
} from "../game/engine";
import { useGameStore } from "../game/state/gameStore";
import type { GameActions } from "../game/state/storeTypes";
import { actionTargets, describePiece } from "../game/turn/turnHelpers";
import { useOnlineMatchStore } from "./onlineStore";

type BridgedActions = Pick<
  GameActions,
  | "activateSquare"
  | "cancelDefenderSelection"
  | "chooseTransform"
  | "passTurn"
  | "undo"
  | "saveGame"
  | "loadGame"
  | "exportSaveJson"
  | "importSaveJson"
  | "startConfiguredMatch"
>;

let localActions: BridgedActions | null = null;
let installed = false;

function rememberLocalActions(): BridgedActions {
  if (localActions) return localActions;
  const state = useGameStore.getState();
  localActions = {
    activateSquare: state.activateSquare,
    cancelDefenderSelection: state.cancelDefenderSelection,
    chooseTransform: state.chooseTransform,
    passTurn: state.passTurn,
    undo: state.undo,
    saveGame: state.saveGame,
    loadGame: state.loadGame,
    exportSaveJson: state.exportSaveJson,
    importSaveJson: state.importSaveJson,
    startConfiguredMatch: state.startConfiguredMatch,
  };
  return localActions;
}

function blockReason(): string | null {
  const online = useOnlineMatchStore.getState();
  const game = useGameStore.getState();
  if (online.connectionStatus !== "connected") {
    return "Reconnecting to the online match…";
  }
  if (online.waitingForOpponent) return "Waiting for your opponent to join.";
  if (online.pendingCommandId) {
    return "Waiting for the server to confirm your action.";
  }
  if (!online.side) return "Your online side has not been assigned yet.";
  if (online.completed || game.phase.phase === "gameOver") {
    return "This online match is complete.";
  }

  if (
    game.phase.phase === "placement" &&
    game.currentPlacement?.player !== online.side
  ) {
    return "It is your opponent's placement.";
  }
  if (
    game.phase.phase === "defenderSelection" &&
    game.pendingDefendedKing?.owner !== online.side
  ) {
    return "Your opponent must choose the defender.";
  }
  if (
    game.phase.phase === "transformSelection" &&
    game.pendingTransform?.owner !== online.side
  ) {
    return "Your opponent must choose the Transform.";
  }
  if (
    game.phase.phase === "playing" &&
    game.currentPlayer !== online.side
  ) {
    return "It is your opponent's turn.";
  }
  return null;
}

function requireAction(): boolean {
  const reason = blockReason();
  if (!reason) return true;
  useGameStore.setState({ message: reason });
  return false;
}

function activateSquare(pos: Vec2): void {
  if (!requireAction()) return;
  const online = useOnlineMatchStore.getState();
  const game = useGameStore.getState();

  if (game.phase.phase === "placement") {
    if (online.sendPlacement(pos)) {
      useGameStore.setState({
        message: "Confirming placement with the server…",
      });
    }
    return;
  }
  if (game.phase.phase === "defenderSelection") {
    if (online.chooseDefender(pos)) {
      useGameStore.setState({
        message: "Confirming defender with the server…",
      });
    }
    return;
  }
  if (game.phase.phase !== "playing" || !online.side) return;

  const piece = getPiece(game.board, pos);
  if (!game.selected) {
    if (piece?.player === online.side) {
      useGameStore.setState({
        selected: pos,
        legalTargets: actionTargets(
          game.board,
          pos,
          game.movesThisTurn,
          game.kingMoved,
        ),
        message: `${piece.player} ${describePiece(piece.type)} selected.`,
      });
    }
    return;
  }

  if (piece?.player === online.side) {
    useGameStore.setState({
      selected: pos,
      legalTargets: actionTargets(
        game.board,
        pos,
        game.movesThisTurn,
        game.kingMoved,
      ),
      message: `${piece.player} ${describePiece(piece.type)} selected.`,
    });
    return;
  }

  if (!hasPos(game.legalTargets, pos)) {
    useGameStore.setState({
      selected: null,
      legalTargets: [],
      message: "Selection cancelled.",
    });
    return;
  }

  const start = game.selected;
  useGameStore.setState({
    selected: null,
    legalTargets: [],
    message: "Confirming move with the server…",
  });
  online.sendAction(start, pos);
}

function cancelDefenderSelection(): void {
  if (!requireAction()) return;
  if (useOnlineMatchStore.getState().cancelDefendedKing()) {
    useGameStore.setState({
      message: "Cancelling the attack with the server…",
    });
  }
}

function chooseTransform(newType: PawnType): void {
  if (!requireAction()) return;
  if (useOnlineMatchStore.getState().chooseTransform(newType)) {
    useGameStore.setState({
      message: "Confirming Transform with the server…",
    });
  }
}

function passTurn(): void {
  if (!requireAction()) return;
  if (useOnlineMatchStore.getState().passTurn()) {
    useGameStore.setState({ message: "Passing turn with the server…" });
  }
}

function onlineOnlyMessage(): void {
  useGameStore.setState({
    message: "This action is unavailable during an online match.",
  });
}

export function installOnlineGameActionBridge(): void {
  if (installed) return;
  rememberLocalActions();
  installed = true;
  useGameStore.setState({
    activateSquare,
    cancelDefenderSelection,
    chooseTransform,
    passTurn,
    undo: onlineOnlyMessage,
    saveGame: onlineOnlyMessage,
    loadGame: onlineOnlyMessage,
    exportSaveJson: () => null,
    importSaveJson: () => false,
    startConfiguredMatch: onlineOnlyMessage,
  });
}

export function restoreLocalGameActions(): void {
  if (!installed || !localActions) return;
  useGameStore.setState(localActions);
  installed = false;
}

export function onlineActionBlockReason(): string | null {
  return blockReason();
}
