import type { AppRoute } from "../app/routes";

interface SettingsPageProps {
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function SettingsPage({ navigate }: SettingsPageProps) {
  return (
    <main className="menuPage textPage">
      <header className="pageHeader">
        <button type="button" onClick={() => navigate("/")}>
          Home
        </button>
        <div>
          <p className="eyebrow">Preferences</p>
          <h1>Settings</h1>
        </div>
      </header>
      <section className="textPanel">
        <h2>Audio</h2>
        <p>Movement, capture, shield, Transform, and victory feedback are tracked in the parity checklist for the next implementation slices.</p>
        <h2>Display</h2>
        <p>The responsive SVG board and dark royal theme remain the approved visual direction.</p>
      </section>
    </main>
  );
}
