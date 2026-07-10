import { useMemo, useRef, useState } from "react";
import type { AppRoute } from "../app/routes";
import { useGameStore } from "../game/state/gameStore";
import { ConfirmDialog, EmptyState, GameButton, PageHeader, PageShell, Panel, SectionHeader, StatusBadge } from "../ui/components";
import "../styles/secondary-pages.css";

interface LoadPageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

interface SaveSummary {
  valid: boolean;
  schema: number | null;
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
  const exportSaveJson = useGameStore((state) => state.exportSaveJson);
  const importSaveJson = useGameStore((state) => state.importSaveJson);
  const hasActiveMatch = useGameStore((state) => state.hasActiveMatch);
  const message = useGameStore((state) => state.message);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // refreshKey is an intentional re-read trigger (bumped after import/delete), not a value used inside the memo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function downloadSaveJson(json: string, label: string) {
    if (!json) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `assalto-reale-${label}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportCurrentSave() {
    const json = exportSaveJson();
    if (json) {
      downloadSaveJson(json, "current-match");
    }
  }

  function exportLocalSave() {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw) {
      downloadSaveJson(raw, "saved-match");
    }
  }

  function importSave(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string" && importSaveJson(reader.result)) {
        setRefreshKey((value) => value + 1);
        navigate("/game");
      } else {
        setRefreshKey((value) => value + 1);
      }
    };
    reader.onerror = () => {
      useGameStore.setState({ message: "The save could not be read." });
      setRefreshKey((value) => value + 1);
    };
    reader.readAsText(file);
  }

  return (
    <PageShell activeRoute={route} navigate={navigate} className="loadShell">
      <PageHeader
        title="Saved Matches"
        description="Continue a match stored in this browser, or move a save between devices."
        actions={
          <GameButton variant="primary" icon="play" onClick={() => navigate(hasActiveMatch ? "/game" : "/setup")}>
            {hasActiveMatch ? "Resume Current Match" : "Start a Match"}
          </GameButton>
        }
      />

      <Panel tone="strong" className="loadPanel">
        <SectionHeader title="This browser" description="One local save is kept at a time." />
        {saveSummary ? (
          <article className={saveSummary.valid ? "saveCard" : "saveCard saveCardInvalid"}>
            <div className="saveDetails">
              <StatusBadge tone={saveSummary.valid ? "success" : "danger"} icon={saveSummary.valid ? "save" : "warning"}>
                {saveSummary.valid ? "Ready to continue" : "Save unavailable"}
              </StatusBadge>
              <h2>{saveSummary.mode}</h2>
              <dl className="summaryList">
                <div>
                  <dt>Saved</dt>
                  <dd>{saveSummary.savedAt ?? "Date unavailable"}</dd>
                </div>
                <div>
                  <dt>Phase</dt>
                  <dd>{formatPhase(saveSummary.phase)}</dd>
                </div>
                <div>
                  <dt>Turn</dt>
                  <dd>{saveSummary.turnCounter ?? "—"}</dd>
                </div>
                <div>
                  <dt>Current player</dt>
                  <dd>{saveSummary.currentPlayer ?? "—"}</dd>
                </div>
              </dl>
              {saveSummary.issue && <p className={saveSummary.valid ? "saveNotice" : "saveNotice saveNoticeError"}>{saveSummary.issue}</p>}
            </div>
            <div className="saveActions">
              <GameButton variant="primary" icon="load" onClick={loadAndContinue} disabled={!saveSummary.valid}>
                Continue
              </GameButton>
              <GameButton variant="secondary" icon="save" onClick={exportLocalSave} disabled={!saveSummary.valid}>
                Export
              </GameButton>
              <GameButton variant="danger" icon="trash" onClick={() => setDeleteOpen(true)}>
                Delete
              </GameButton>
            </div>
          </article>
        ) : (
          <EmptyState
            icon="load"
            title="No saved match"
            actions={
              <>
                <GameButton variant="primary" icon="play" onClick={() => navigate("/setup")}>
                  Start a Match
                </GameButton>
                {hasActiveMatch && (
                  <GameButton variant="secondary" icon="board" onClick={() => navigate("/game")}>
                    Return to Current Match
                  </GameButton>
                )}
              </>
            }
          >
            <p>Use Save during a match to keep it in this browser.</p>
          </EmptyState>
        )}

        <div className="saveTools">
          <div>
            <h3>Transfer a save</h3>
            <p>Import a saved match from a file, or export the match currently in progress.</p>
          </div>
          <div className="saveToolActions" aria-label="Save import and export">
            <GameButton variant="secondary" icon="load" onClick={() => fileInputRef.current?.click()}>
              Import Save
            </GameButton>
            <GameButton variant="secondary" icon="save" onClick={exportCurrentSave} disabled={!hasActiveMatch}>
              Export Current Match
            </GameButton>
            <input
              ref={fileInputRef}
              className="srOnly"
              type="file"
              aria-label="Import a saved match from a JSON file"
              accept="application/json,.json"
              onChange={(event) => {
                importSave(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </div>

        {message && (
          <p className="loadMessage" role="status">
            {message}
          </p>
        )}
      </Panel>

      {deleteOpen && (
        <ConfirmDialog
          title="Delete saved match?"
          confirmLabel="Delete Save"
          danger
          onConfirm={deleteLocalSave}
          onCancel={() => setDeleteOpen(false)}
        >
          <p>This removes the saved match from this browser. A match currently open in memory is not affected.</p>
        </ConfirmDialog>
      )}
    </PageShell>
  );
}

function formatPhase(phase: string | null): string {
  if (!phase) return "Unknown";
  const labels: Record<string, string> = {
    placement: "Placement",
    playing: "In progress",
    defenderSelection: "Defender choice",
    transformSelection: "Transform choice",
    gameOver: "Finished",
  };
  return labels[phase] ?? phase;
}

function readSaveSummary(): SaveSummary | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const schema = typeof parsed.schema === "number" ? parsed.schema : null;
    const config = parsed.matchConfig;
    const opponent = config?.opponent === "Computer" ? "Human vs Computer" : "Human vs Human";
    const placement =
      config?.placementMode === "QuickBalanced" ? "Quick setup" : config?.placementMode === "Manual" ? "Manual placement" : "Unknown setup";
    const transform = config?.transformEnabled === false ? "Transform off" : "Transform on";
    const valid = (schema === 1 || schema === 2) && Boolean(parsed.board);
    const issue =
      schema === 1
        ? "This save was created by an older version. It can still be loaded, but some in-progress choices or undo history may be unavailable."
        : parsed.savedAt
          ? undefined
          : "This save does not include a saved date.";
    return {
      valid,
      schema,
      savedAt: parsed.savedAt ?? null,
      phase: parsed.phase?.phase ?? parsed.phase ?? null,
      currentPlayer: parsed.currentPlayer ?? null,
      turnCounter: typeof parsed.turnCounter === "number" ? parsed.turnCounter : null,
      mode: `${opponent} · ${placement} · ${transform}`,
      issue: valid ? issue : "This save was created by an unsupported version or is missing required game data.",
    };
  } catch {
    return {
      valid: false,
      schema: null,
      savedAt: null,
      phase: null,
      currentPlayer: null,
      turnCounter: null,
      mode: "Unreadable saved match",
      issue: "The saved data is not a valid Assalto Reale save.",
    };
  }
}
