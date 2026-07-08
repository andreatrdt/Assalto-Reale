import { useMemo, useState } from "react";
import type { AppRoute } from "../app/routes";
import { useGameStore } from "../game/state/gameStore";
import { ConfirmDialog, EmptyState, GameButton, PageHeader, PageShell, Panel, SectionHeader, StatusBadge } from "../ui/components";

interface LoadPageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

interface SaveSummary {
  valid: boolean;
  savedAt: string | null;
  phase: string | null;
  currentPlayer: string | null;
  turnCounter: number | null;
  mode: string;
  issue?: string;
}

const SAVE_KEY = "assalto-reale-save";

export function LoadPage({ route, navigate }: LoadPageProps) {
  const loadGame = useGameStore((state) => state.loadGame);
  const hasActiveMatch = useGameStore((state) => state.hasActiveMatch);
  const message = useGameStore((state) => state.message);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const saveSummary = useMemo(() => readSaveSummary(), [refreshKey]);

  function loadAndContinue() {
    loadGame();
    if (useGameStore.getState().hasActiveMatch) {
      navigate("/game");
    }
    setRefreshKey((value) => value + 1);
  }

  function deleteLocalSave() {
    window.localStorage.removeItem(SAVE_KEY);
    setDeleteOpen(false);
    setRefreshKey((value) => value + 1);
  }

  return (
    <PageShell activeRoute={route} navigate={navigate} className="loadShell">
      <PageHeader
        eyebrow="Saved games"
        title="Continue A Match"
        description="Local saves are available in this browser. The current web save schema is still a parity work item, so incomplete fields are called out plainly."
        actions={
          <GameButton variant="primary" icon="play" onClick={() => navigate(hasActiveMatch ? "/game" : "/setup")}>
            {hasActiveMatch ? "Resume Current" : "New Match"}
          </GameButton>
        }
      />

      <Panel tone="strong" className="loadPanel">
        <SectionHeader eyebrow="Local storage" title="Saved Match" />
        {saveSummary ? (
          <article className={saveSummary.valid ? "saveCard" : "saveCard saveCardInvalid"}>
            <div>
              <StatusBadge tone={saveSummary.valid ? "success" : "danger"} icon={saveSummary.valid ? "save" : "warning"}>
                {saveSummary.valid ? "Local save found" : "Needs attention"}
              </StatusBadge>
              <h2>{saveSummary.mode}</h2>
              <dl className="summaryList">
                <div>
                  <dt>Saved</dt>
                  <dd>{saveSummary.savedAt ?? "Date not stored by current schema"}</dd>
                </div>
                <div>
                  <dt>Phase</dt>
                  <dd>{saveSummary.phase ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt>Turn</dt>
                  <dd>{saveSummary.turnCounter ?? "Not stored"}</dd>
                </div>
                <div>
                  <dt>Current player</dt>
                  <dd>{saveSummary.currentPlayer ?? "Unknown"}</dd>
                </div>
              </dl>
              {saveSummary.issue && (
                <StatusBadge tone="info" icon="warning">
                  {saveSummary.issue}
                </StatusBadge>
              )}
            </div>
            <div className="saveActions">
              <GameButton variant="primary" icon="load" onClick={loadAndContinue} disabled={!saveSummary.valid}>
                Load
              </GameButton>
              <GameButton variant="danger" icon="trash" onClick={() => setDeleteOpen(true)}>
                Delete
              </GameButton>
            </div>
          </article>
        ) : (
          <EmptyState
            icon="load"
            title="No local save yet"
            actions={
              <>
                <GameButton variant="primary" icon="play" onClick={() => navigate("/setup")}>
                  Start New Match
                </GameButton>
                <GameButton variant="secondary" icon="board" onClick={() => navigate(hasActiveMatch ? "/game" : "/")}>
                  {hasActiveMatch ? "Current Match" : "Home"}
                </GameButton>
              </>
            }
          >
            <p>Save from the game screen to create a local match card here.</p>
          </EmptyState>
        )}
        <p className="statusLine">{message}</p>
      </Panel>

      {deleteOpen && (
        <ConfirmDialog title="Delete local save?" confirmLabel="Delete Save" danger onConfirm={deleteLocalSave} onCancel={() => setDeleteOpen(false)}>
          <p>This removes the saved match from this browser only. Any active match currently in memory is not changed.</p>
        </ConfirmDialog>
      )}
    </PageShell>
  );
}

function readSaveSummary(): SaveSummary | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const config = parsed.matchConfig;
    const opponent = config?.opponent === "Computer" ? `${config.aiDifficulty ?? "Unknown"} AI` : "Human vs Human";
    const placement = config?.placementMode === "QuickBalanced" ? "Quick Balanced" : config?.placementMode === "Manual" ? "Manual" : "Unknown placement";
    return {
      valid: parsed.schema === 1 && Boolean(parsed.board),
      savedAt: parsed.savedAt ?? null,
      phase: parsed.phase?.phase ?? parsed.phase ?? null,
      currentPlayer: parsed.currentPlayer ?? null,
      turnCounter: typeof parsed.turnCounter === "number" ? parsed.turnCounter : null,
      mode: `${opponent}, ${placement}`,
      issue: parsed.savedAt ? undefined : "The current save schema does not yet include saved-at metadata.",
    };
  } catch {
    return {
      valid: false,
      savedAt: null,
      phase: null,
      currentPlayer: null,
      turnCounter: null,
      mode: "Unreadable local save",
      issue: "The saved data could not be parsed as JSON.",
    };
  }
}
