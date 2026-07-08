import type { ReactNode } from "react";
import type { AppRoute } from "../app/routes";
import { GameButton, PageHeader, PageShell, Panel, SectionHeader, StatusBadge } from "../ui/components";

interface RulesPageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

const sections = [
  { id: "objective", label: "Objective" },
  { id: "setup", label: "Setup" },
  { id: "turns", label: "Turns" },
  { id: "combat", label: "Combat" },
  { id: "kings", label: "Defended Kings" },
  { id: "territory", label: "Territory" },
  { id: "transform", label: "Transform" },
  { id: "victory", label: "Victory" },
];

export function RulesPage({ route, navigate }: RulesPageProps) {
  return (
    <PageShell activeRoute={route} navigate={navigate} className="rulesShell">
      <PageHeader
        eyebrow="Field manual"
        title="Rules Of Assalto Reale"
        description="A readable guide aligned to the canonical Python rulebook. Engine parity gaps are recorded separately instead of hidden here."
        actions={
          <GameButton variant="primary" icon="play" onClick={() => navigate("/setup")}>
            Start a Match
          </GameButton>
        }
      />

      <div className="rulebookLayout">
        <Panel as="aside" tone="subtle" className="ruleToc" aria-label="Rule sections">
          <p className="eyebrow">Contents</p>
          {sections.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.label}
            </a>
          ))}
        </Panel>

        <Panel tone="strong" className="rulebook">
          <RuleSection id="objective" title="Objective">
            <p>Assalto Reale is a two-player abstract strategy game for Black and White on a 12x12 board.</p>
            <p>Win by capturing the enemy King, or by maintaining strict majority control of Special Squares through the opponent response turn.</p>
          </RuleSection>

          <RuleSection id="setup" title="Setup And Deployment">
            <p>Each player has one King, four Attack Pawns, four Defense Pawns and four Conquest Pawns.</p>
            <p>Manual placement follows the canonical snake schedule: Black places one piece, White places two, the players continue in two-piece groups, and White closes the sequence with one piece.</p>
            <p>Quick Balanced setup uses the same placement legality checks and remains tracked for exact Python scoring parity.</p>
          </RuleSection>

          <RuleSection id="turns" title="Turns And Action Points">
            <p>Every turn starts with two action points. One-square movement costs one point. Passing ends the turn.</p>
            <p>The King may act at most once per turn. Non-King pieces may use both action points if legal actions remain.</p>
          </RuleSection>

          <RuleSection id="combat" title="Movement And Combat">
            <div className="rulesTable" role="table" aria-label="Capture hierarchy">
              <div role="row">
                <strong role="columnheader">Attacker</strong>
                <strong role="columnheader">Captures</strong>
              </div>
              <div role="row">
                <span>Attack Pawn</span>
                <span>Defense Pawn, King</span>
              </div>
              <div role="row">
                <span>Defense Pawn</span>
                <span>Conquest Pawn</span>
              </div>
              <div role="row">
                <span>Conquest Pawn</span>
                <span>Attack Pawn</span>
              </div>
              <div role="row">
                <span>King</span>
                <span>Attack, Defense or Conquest Pawn</span>
              </div>
            </div>
            <p>Attack Pawns capture orthogonally at range one or two. Defense Pawns capture diagonally at range one or two. Two-square captures cost both points and require a clear intermediate square.</p>
          </RuleSection>

          <RuleSection id="kings" title="Defended Kings">
            <p>A King adjacent to at least one friendly Defense Pawn is defended. When an Attack Pawn attacks a defended King, one eligible Defense Pawn is sacrificed, the King survives, and the Attack Pawn bounces backward along the attack line.</p>
            <StatusBadge tone="gold" icon="shield">
              The current web UI now marks defended Kings visually; the complete preview/confirmation flow remains a parity item.
            </StatusBadge>
          </RuleSection>

          <RuleSection id="territory" title="Special Squares And Territory">
            <p>Only Conquest Pawns standing on Special Squares control them. A strict majority creates a territory claim at the end of a turn.</p>
            <p>The opponent receives a full response turn. The claim matures only if the claimant keeps majority control until their next turn.</p>
          </RuleSection>

          <RuleSection id="transform" title="Transform Variant">
            <p>Transform is optional and disabled by default. When enabled, the engine can generate a Transform Square after the configured movement-round threshold.</p>
            <p>A pawn landing on the Transform Square may transform into a different pawn type. Kings cannot transform.</p>
          </RuleSection>

          <RuleSection id="victory" title="Victory Precedence">
            <p>King capture takes precedence over territory and timeout results. Timeout victory is part of the canonical product scope, but the live web countdown controller remains unfinished.</p>
          </RuleSection>
        </Panel>
      </div>
    </PageShell>
  );
}

function RuleSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="ruleSection">
      <SectionHeader title={title} />
      {children}
    </section>
  );
}
