import type { ReactNode } from "react";
import type { AppRoute } from "../app/routes";
import { GameButton, PageHeader, PageShell, SectionHeader } from "../ui/components";
import "../styles/secondary-pages.css";

interface RulesPageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

const sections = [
  { id: "objective", label: "Objective" },
  { id: "setup", label: "Setup" },
  { id: "turns", label: "Turns" },
  { id: "combat", label: "Movement & capture" },
  { id: "kings", label: "Defended Kings" },
  { id: "territory", label: "Special Squares" },
  { id: "transform", label: "Transform" },
  { id: "victory", label: "Victory" },
];

export function RulesPage({ route, navigate }: RulesPageProps) {
  return (
    <PageShell activeRoute={route} navigate={navigate} className="rulesShell">
      <PageHeader
        title="How to Play"
        description="The complete rules for a standard Assalto Reale match."
        actions={
          <GameButton variant="primary" icon="play" onClick={() => navigate("/setup")}>
            Start a Match
          </GameButton>
        }
      />

      <div className="rulebookLayout">
        <nav className="ruleToc" aria-label="Rule sections">
          <p className="eyebrow">On this page</p>
          {sections.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.label}
            </a>
          ))}
        </nav>

        <article className="rulebook">
          <RuleSection id="objective" title="Objective">
            <p>Assalto Reale is a two-player abstract strategy game for Black and White on a 12×12 board.</p>
            <p>
              Win by capturing the enemy King, or by keeping strict majority control of the Special Squares through the opponent&apos;s full
              response turn.
            </p>
          </RuleSection>

          <RuleSection id="setup" title="Setup">
            <p>Each player begins with one King, four Attack Pawns, four Defense Pawns and four Conquest Pawns.</p>
            <p>
              All new public matches use manual placement. Black places one piece, White places two, the players continue in two-piece
              groups, and White places the final piece.
            </p>
            <p>
              Kings and Attack Pawns have starting-area restrictions. Conquest Pawns must also begin at least three squares away from every
              Special Square.
            </p>
          </RuleSection>

          <RuleSection id="turns" title="Turns and action points">
            <p>Each turn begins with two action points. A one-square move or one-square capture costs one point. Passing ends the turn.</p>
            <p>The King may act only once per turn. A non-King piece may use both action points when legal actions remain.</p>
          </RuleSection>

          <RuleSection id="combat" title="Movement and capture">
            <p>Every piece may move one square to any adjacent empty square, including diagonally.</p>
            <div className="rulesTable" role="table" aria-label="Capture hierarchy">
              <div role="row">
                <strong role="columnheader">Attacker</strong>
                <strong role="columnheader">May capture</strong>
              </div>
              <div role="row">
                <span role="cell">Attack Pawn</span>
                <span role="cell">Defense Pawn or King</span>
              </div>
              <div role="row">
                <span role="cell">Defense Pawn</span>
                <span role="cell">Conquest Pawn</span>
              </div>
              <div role="row">
                <span role="cell">Conquest Pawn</span>
                <span role="cell">Attack Pawn</span>
              </div>
              <div role="row">
                <span role="cell">King</span>
                <span role="cell">Any pawn</span>
              </div>
            </div>
            <p>
              Attack Pawns capture orthogonally at range one or two. Defense Pawns capture diagonally at range one or two. A two-square
              capture costs both action points, requires a clear intermediate square and must be the first action of the turn.
            </p>
            <p>Conquest Pawns and Kings capture adjacent targets only. A King cannot capture another King.</p>
          </RuleSection>

          <RuleSection id="kings" title="Defended Kings">
            <p>A King is defended while at least one friendly Defense Pawn occupies an adjacent square.</p>
            <p>
              When an Attack Pawn attacks a defended King, one eligible Defense Pawn is sacrificed, the King survives and the attacking pawn
              bounces directly backward along the attack line. The bounce travels up to five squares and stops before the board edge or an
              occupied square.
            </p>
            <p>If several defenders are eligible, the defending player chooses which one is sacrificed. The attack then ends the turn.</p>
          </RuleSection>

          <RuleSection id="territory" title="Special Squares and territory">
            <p>
              Only Conquest Pawns standing on Special Squares control them. Holding a strict majority creates a territory claim at the end
              of the turn.
            </p>
            <p>
              The opponent receives one complete response turn. The claim becomes a victory only if the claimant still holds the majority
              when their next turn begins.
            </p>
          </RuleSection>

          <RuleSection id="transform" title="Transform">
            <p>
              Transform is enabled in every newly started public match. After the configured movement-round threshold, a Transform Square
              can appear on the board.
            </p>
            <p>A pawn that lands on it may change into a different pawn type. Kings cannot transform.</p>
          </RuleSection>

          <RuleSection id="victory" title="Victory">
            <p>A match can end by King capture, a matured territory claim or a player running out of time.</p>
            <p>King capture takes precedence when more than one victory condition is reached by the same action.</p>
          </RuleSection>
        </article>
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
