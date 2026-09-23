import type { ReactNode } from "react";
import { useActions, useApp } from "../store/context";
import { Button, cx } from "./controls";
import s from "./layout.module.css";

type CardProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tone?: "default" | "muted";
  className?: string;
  children: ReactNode;
  as?: "section" | "article" | "div";
  labelledBy?: string;
};

export function Card({ title, subtitle, actions, tone = "default", className, children, as: Tag = "section" }: CardProps) {
  return (
    <Tag className={cx(s.card, tone === "muted" && s.muted, className)}>
      {(title || actions) && (
        <header className={s.cardHeader}>
          <div className={s.cardTitles}>
            {title && <h3 className={s.cardTitle}>{title}</h3>}
            {subtitle && <p className={s.cardSubtitle}>{subtitle}</p>}
          </div>
          {actions && <div className={s.cardActions}>{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}

export function ScreenTitle({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className={s.screenTitle}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className={s.sectionTitle}>{children}</h3>;
}

type EmptyProps = { message: ReactNode; action?: { label: string; onClick(): void } };

/** Écran ou section vide : un message et une action claire. */
export function Empty({ message, action }: EmptyProps) {
  return (
    <div className={s.empty}>
      <p>{message}</p>
      {action && (
        <Button variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function Stack({ gap = 18, children }: { gap?: number; children: ReactNode }) {
  return (
    <div className={s.stack} style={{ gap }}>
      {children}
    </div>
  );
}

export function Grid({ min = 180, children }: { min?: number; children: ReactNode }) {
  return (
    <div className={s.grid} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))` }}>
      {children}
    </div>
  );
}

/** Notifications de confirmation et d'erreur, annoncées aux lecteurs d'écran. */
export function Toasts() {
  const toasts = useApp((st) => st.toasts);
  const { dismissToast } = useActions();
  return (
    <div className={s.toasts} aria-live="polite" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={cx(s.toast, t.tone === "error" && s.toastError)}>
          <span>{t.message}</span>
          <button type="button" className={s.toastClose} onClick={() => dismissToast(t.id)} aria-label="Fermer la notification">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
