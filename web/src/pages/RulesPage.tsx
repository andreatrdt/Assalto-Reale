import type { AppRoute } from "../app/routes";

interface RulesPageProps {
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function RulesPage({ navigate }: RulesPageProps) {
  return (
    <main className="menuPage textPage">
      <header className="pageHeader">
        <button type="button" onClick={() => navigate("/")}>
          Home
        </button>
        <div>
          <p className="eyebrow">Reference</p>
          <h1>Rules</h1>
        </div>
      </header>
      <section className="textPanel">
        <h2>Objective</h2>
        <p>Win by capturing the enemy King, or by keeping strict majority control of Special Squares through the opponent response turn.</p>
        <h2>Turns</h2>
        <p>Each turn starts with two action points. One-square movement and one-square captures cost one. Two-square captures cost two. Passing ends the turn.</p>
        <h2>King Restriction</h2>
        <p>A King may act at most once per turn. Other pieces may spend both action points when legal.</p>
        <h2>Special Systems</h2>
        <p>Defended Kings, territory claims, and optional Transform Squares follow the Python engine. This guide will be expanded as the remaining Pygbag help text is ported.</p>
      </section>
    </main>
  );
}
