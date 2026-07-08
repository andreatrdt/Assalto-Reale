import { useMemo, useRef, useState } from "react";
import type { AppRoute } from "../app/routes";
import { useGameStore } from "../game/state/gameStore";
import { ConfirmDialog, EmptyState, GameButton, PageHeader, PageShell, Panel, SectionHeader, StatusBadge } from "../ui/components";

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
      downloadSaveJson(json, "current-save");
    }
  }

  function exportLocalSave() {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw) {
      downloadSaveJson(raw, "local-save");
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
      useGameStore.setState({ message: "Save import failed because the file could not be read." });
      setRefreshKey((value) => value + 1);
    };
    reader.readAsText(file);
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
                <div>
                  <dt>Schema</dt>
                  <dd>{saveSummary.schema ? `v${saveSummary.schema}` : "Unknown"}</dd>
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
        <div className="saveActions" aria-label="Save import and export">
          <GameButton variant="secondary" icon="load" onClick={() => fileInputRef.current?.click()}>
            Import JSON
          </GameButton>
          <GameButton variant="secondary" icon="save" onClick={exportCurrentSave} disabled={!hasActiveMatch}>
            Export Current
          </GameButton>
          <input
            ref={fileInputRef}
            className="srOnly"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              importSave(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </div>
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
    const schema = typeof parsed.schema === "number" ? parsed.schema : null;
    const config = parsed.matchConfig;
    const opponent = config?.opponent === "Computer" ? `${config.aiDifficulty ?? "Unknown"} AI` : "Human vs Human";
    const placement = config?.placementMode === "QuickBalanced" ? "Quick Balanced" : config?.placementMode === "Manual" ? "Manual" : "Unknown placement";
    const valid = (schema === 1 || schema === 2) && Boolean(parsed.board);
    const issue =
      schema === 1
        ? "This is an older schema-1 web save. It can be loaded, but modal decisions and undo history may be incomplete."
        : parsed.savedAt
          ? undefined
          : "The save is missing saved-at metadata.";
    return {
      valid,
      schema,
      savedAt: parsed.savedAt ?? null,
      phase: parsed.phase?.phase ?? parsed.phase ?? null,
      currentPlayer: parsed.currentPlayer ?? null,
      turnCounter: typeof parsed.turnCounter === "number" ? parsed.turnCounter : null,
      mode: `${opponent}, ${placement}`,
      issue: valid ? issue : "This local save uses an unsupported or incomplete schema.",
    };
  } catch {
    return {
      valid: false,
      schema: null,
      savedAt: null,
      phase: null,
      currentPlayer: null,
      turnCounter: null,
      mode: "Unreadable local save",
      issue: "The saved data could not be parsed as JSON.",
    };
  }
}
