import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { motion } from "motion/react";
import type { AppRoute } from "../app/routes";
import type { Player } from "../game/engine";

export type IconName =
  | "board"
  | "book"
  | "check"
  | "chevron"
  | "clock"
  | "crown"
  | "gear"
  | "home"
  | "load"
  | "play"
  | "save"
  | "shield"
  | "spark"
  | "sword"
  | "trash"
  | "warning";

interface IconProps {
  name: IconName;
  className?: string;
}

export function Icon({ name, className }: IconProps) {
  return (
    <svg className={className ?? "icon"} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {iconPaths[name]}
    </svg>
  );
}

const iconPaths: Record<IconName, ReactNode> = {
  board: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 9h16M4 15h16M9 4v16M15 4v16" />
    </>
  ),
  book: (
    <>
      <path d="M5 4h8a4 4 0 0 1 4 4v12H9a4 4 0 0 0-4 0V4Z" />
      <path d="M9 7h5M9 11h5M9 15h4" />
    </>
  ),
  check: <path d="M5 12.5 10 17l9-10" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  crown: <path d="M4 18h16l-2-10-4 4-2-6-2 6-4-4-2 10Z" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5 6.8 15M17.2 9l2.6-1.5" />
    </>
  ),
  home: <path d="M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z" />,
  load: (
    <>
      <path d="M5 20h14M12 4v10" />
      <path d="m8 11 4 4 4-4" />
    </>
  ),
  play: <path d="M7 5v14l12-7L7 5Z" />,
  save: (
    <>
      <path d="M5 4h12l2 2v14H5V4Z" />
      <path d="M8 4v6h7V4M8 20v-6h8v6" />
    </>
  ),
  shield: <path d="M12 3 19 6v5c0 4.5-2.7 7.9-7 10-4.3-2.1-7-5.5-7-10V6l7-3Z" />,
  spark: <path d="M12 3 14 9l6 3-6 3-2 6-2-6-6-3 6-3 2-6Z" />,
  sword: (
    <>
      <path d="M14 4h6v6L9 21l-6-6L14 4Z" />
      <path d="m7 13 4 4M4 20l4-4" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14M9 7V5h6v2M8 7l1 13h6l1-13" />
      <path d="M10.5 11v5M13.5 11v5" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4 21 20H3L12 4Z" />
      <path d="M12 9v5M12 17h.01" />
    </>
  ),
};

interface GameButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  selected?: boolean;
  loading?: boolean;
}

export function GameButton({ variant = "secondary", size = "md", icon, selected, loading, className = "", children, ...props }: GameButtonProps) {
  return (
    <button
      {...props}
      className={`gameButton gameButton-${variant} gameButton-${size}${selected ? " isSelected" : ""}${loading ? " isLoading" : ""} ${className}`.trim()}
      aria-pressed={selected ?? props["aria-pressed"]}
    >
      {icon && <Icon name={icon} />}
      <span>{loading ? "Working..." : children}</span>
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  variant?: "secondary" | "ghost" | "danger";
}

export function IconButton({ icon, label, variant = "ghost", className = "", ...props }: IconButtonProps) {
  return (
    <button {...props} className={`iconButton iconButton-${variant} ${className}`.trim()} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  );
}

interface PageShellProps {
  activeRoute: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
  children: ReactNode;
  className?: string;
}

export function PageShell({ activeRoute, navigate, children, className = "" }: PageShellProps) {
  const navItems: { route: AppRoute; label: string; icon: IconName }[] = [
    { route: "/", label: "Home", icon: "home" },
    { route: "/setup", label: "New Match", icon: "sword" },
    { route: "/load", label: "Load", icon: "load" },
    { route: "/rules", label: "Rules", icon: "book" },
    { route: "/settings", label: "Settings", icon: "gear" },
  ];

  return (
    <main className={`pageShell ${className}`.trim()}>
      <header className="shellBar">
        <button type="button" className="brandMark" onClick={() => navigate("/")} aria-label="Assalto Reale home">
          <span className="brandCrest" aria-hidden="true">
            <Icon name="crown" />
          </span>
          <span>
            <strong>Assalto Reale</strong>
            <small>Royal tactics</small>
          </span>
        </button>
        <nav className="shellNav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.route}
              type="button"
              className={activeRoute === item.route ? "isActive" : undefined}
              onClick={() => navigate(item.route)}
              aria-current={activeRoute === item.route ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </header>
      <motion.div
        className="pageShellContent"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </main>
  );
}

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="pageHeader">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="pageLead">{description}</p>}
      </div>
      {actions && <div className="pageHeaderActions">{actions}</div>}
    </header>
  );
}

interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
}

export function SectionHeader({ eyebrow, title, description }: SectionHeaderProps) {
  return (
    <header className="sectionHeader">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </header>
  );
}

interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: "section" | "aside" | "div";
  tone?: "default" | "strong" | "subtle";
  children: ReactNode;
}

export function Panel({ as: Tag = "section", tone = "default", className = "", children, ...props }: PanelProps) {
  return (
    <Tag {...props} className={`panel panel-${tone} ${className}`.trim()}>
      {children}
    </Tag>
  );
}

export function GameCard({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={`gameCard ${className}`.trim()}>
      {children}
    </div>
  );
}

interface FormFieldProps {
  label: string;
  helper?: string;
  children: ReactNode;
}

export function FormField({ label, helper, children }: FormFieldProps) {
  return (
    <fieldset className="formField">
      <legend>{label}</legend>
      {helper && <p>{helper}</p>}
      {children}
    </fieldset>
  );
}

interface SegmentedControlProps<T extends string | number | boolean> {
  label: string;
  options: { label: string; value: T; description?: string; icon?: IconName }[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string | number | boolean>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div className="segmentedControl" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={Object.is(option.value, value) ? "isSelected" : undefined}
          onClick={() => onChange(option.value)}
          aria-pressed={Object.is(option.value, value)}
        >
          {option.icon && <Icon name={option.icon} />}
          <span>{option.label}</span>
          {option.description && <small>{option.description}</small>}
        </button>
      ))}
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}

export function Toggle({ label, checked, onChange, description }: ToggleProps) {
  return (
    <label className="toggleControl">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

interface StatusBadgeProps {
  children: ReactNode;
  tone?: "neutral" | "gold" | "success" | "danger" | "info";
  icon?: IconName;
}

export function StatusBadge({ children, tone = "neutral", icon }: StatusBadgeProps) {
  return (
    <span className={`statusBadge statusBadge-${tone}`}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </span>
  );
}

export function FactionBadge({ player, active = false }: { player: Player; active?: boolean }) {
  return (
    <span className={`factionBadge faction${player}${active ? " isActive" : ""}`}>
      <span aria-hidden="true" />
      {player}
    </span>
  );
}

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}

export function EmptyState({ icon = "warning", title, children, actions }: EmptyStateProps) {
  return (
    <div className="emptyState">
      <span className="emptyIcon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <h2>{title}</h2>
      {children}
      {actions && <div className="emptyActions">{actions}</div>}
    </div>
  );
}

interface ModalProps {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
}

export function Modal({ title, children, actions, onClose }: ModalProps) {
  return (
    <div className="modalBackdrop" role="presentation">
      <section className="modalPanel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header>
          <h2 id="modal-title">{title}</h2>
          {onClose && <IconButton icon="chevron" label="Close dialog" onClick={onClose} />}
        </header>
        <div className="modalBody">{children}</div>
        {actions && <footer>{actions}</footer>}
      </section>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = "Cancel", danger = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      actions={
        <>
          <GameButton variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </GameButton>
          <GameButton variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </GameButton>
        </>
      }
    >
      {children}
    </Modal>
  );
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="tooltip">
      {children}
      <span role="tooltip">{label}</span>
    </span>
  );
}
