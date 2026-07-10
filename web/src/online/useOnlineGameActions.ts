import { useCallback } from "react";
import { getPiece, hasPos, type PawnType, type Vec2 } from "../game/engine";
import { useGameStore } from "../game/state/gameStore";
import { actionTargets, describePiece } from "../game/turn/turnHelpers";
import { useOnlineMatchStore } from "./onlineStore";

export function useOnlineGameActions() {
  const side = useOnlineMatchStore((state) => state.side);
  const connectionStatus = useOnlineMatchStore(
    (state) => state.connectionStatus,
  );
  const waitingForOpponent = useOnlineMatchStore(
    (state) => state.waitingForOpponent,
  );
  const pendingCommandId = useOnlineMatchStore(
    (state) => state.pendingCommandId,
  );
  const completed = useOnlineMatchStore((state) => state.completed);
  const sendPlacement = useOnlineMatchStore((state) => state.sendPlacement);
  const sendAction = useOnlineMatchStore((state) => state.sendAction);
  const chooseDefenderCommand = useOnlineMatchStore(
    (state) => state.chooseDefender,
  );
  const cancelDefendedKingCommand = useOnlineMatchStore(
    (state) => state.cancelDefendedKing,
  );
  const chooseTransformCommand = useOnlineMatchStore(
    (state) => state.chooseTransform,
  );
  const passTurnCommand = useOnlineMatchStore((state) => state.passTurn);

  const blocked =
    connectionStatus !== "connected" ||
    waitingForOpponent ||
    Boolean(pendingCommandId) ||
    completed;

  const canAct = useCallback((): boolean => {
    if (blocked || !side) return false;
    const state = useGameStore.getState();
    if (state.phase.phase === "placement") {
      return state.currentPlacement?.player === side;
    }
    if (state.phase.phase === "defenderSelection") {
      return state.pendingDefendedKing?.owner === side;
    }
    if (state.phase.phase === "transformSelection") {
      return state.pendingTransform?.owner === side;
    }
    return state.phase.phase === "playing" && state.currentPlayer === side;
  }, [blocked, side]);

  const explainBlocked = useCallback(() => {
    if (connectionStatus !== "connected") {
      useGameStore.setState({ message: "Reconnecting to the online match…" });
    } else if (waitingForOpponent) {
      useGameStore.setState({ message: "Waiting for your opponent to join." });
    } else if (pendingCommandId) {
      useGameStore.setState({ message: "Waiting for the server to confirm your action." });
    } else if (!side) {
      useGameStore.setState({ message: "Your online side has not been assigned yet." });
    } else {
      useGameStore.setState({ message: "It is your opponent's turn." });
    }
  }, [connectionStatus, pendingCommandId, side, waitingForOpponent]);

  const activateSquare = useCallback(
    (pos: Vec2) => {
      if (!canAct()) {
        explainBlocked();
        return;
      }
      const state = useGameStore.getState();
      if (state.phase.phase === "defenderSelection") {
        if (chooseDefenderCommand(pos)) {
          useGameStore.setState({ message: "Confirming defender with the server…" });
        }
        return;
      }
      if (state.phase.phase === "transformSelection") return;
      if (state.phase.phase === "placement") {
        if (sendPlacement(pos)) {
          useGameStore.setState({ message: "Confirming placement with the server…" });
        }
        return;
      }
      if (state.phase.phase !== "playing" || !side) return;

      const piece = getPiece(state.board, pos);
      if (!state.selected) {
        if (piece?.player === side) {
          useGameStore.setState({
            selected: pos,
            legalTargets: actionTargets(
              state.board,
              pos,
              state.movesThisTurn,
              state.kingMoved,
            ),
            message: `${piece.player} ${describePiece(piece.type)} selected.`,
          });
        }
        return;
      }
      if (piece?.player === side) {
        useGameStore.setState({
          selected: pos,
          legalTargets: actionTargets(
            state.board,
            pos,
            state.movesThisTurn,
            state.kingMoved,
          ),
          message: `${piece.player} ${describePiece(piece.type)} selected.`,
        });
        return;
      }
      if (!hasPos(state.legalTargets, pos)) {
        useGameStore.setState({
          selected: null,
          legalTargets: [],
          message: "Selection cancelled.",
        });
        return;
      }
      const start = state.selected;
      useGameStore.setState({
        selected: null,
        legalTargets: [],
        message: "Confirming move with the server…",
      });
      sendAction(start, pos);
    },
    [canAct, chooseDefenderCommand, explainBlocked, sendAction, sendPlacement, side],
  );

  const cancelDefenderSelection = useCallback(() => {
    if (!canAct()) {
      explainBlocked();
      return;
    }
    if (cancelDefendedKingCommand()) {
      useGameStore.setState({ message: "Cancelling attack with the server…" });
    }
  }, [canAct, cancelDefendedKingCommand, explainBlocked]);

  const chooseTransform = useCallback(
    (newType: PawnType) => {
      if (!canAct()) {
        explainBlocked();
        return;
      }
      if (chooseTransformCommand(newType)) {
        useGameStore.setState({ message: "Confirming Transform with the server…" });
      }
    },
    [canAct, chooseTransformCommand, explainBlocked],
  );

  const passTurn = useCallback(() => {
    if (!canAct()) {
      explainBlocked();
      return;
    }
    if (passTurnCommand()) {
      useGameStore.setState({ message: "Passing turn with the server…" });
    }
  }, [canAct, explainBlocked, passTurnCommand]);

  return {
    activateSquare,
    cancelDefenderSelection,
    chooseTransform,
    passTurn,
    interactionDisabled: blocked || !canAct(),
  };
}
