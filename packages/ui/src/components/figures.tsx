import type { Cents } from "@cashmyr/core";
import type { ReactNode } from "react";
import { money } from "../lib/format";
import s from "./figures.module.css";

type GaugeProps = {
  label: string;
  /** Couleur de la marque (accesseur de couleur) ; le texte reste à l'encre. */
  color: string;
  value: Cents;
  target: Cents | null;
  /** Texte sous la jauge ; par défaut « cible … » ; false pour ne rien afficher. */
  caption?: ReactNode | false;
};

/**
 * Jauge : le remplissage porte le réalisé, un trait vertical marque la cible.
 * La piste est un éclaircissement de la même teinte.
 */
export function Gauge({ label, color, value, target, caption }: GaugeProps) {
  const scale = Math.max(value, target ?? 0, 1);
  const fill = Math.max(0, Math.min(1, value / scale));
  const mark = target !== null && target > 0 ? target / scale : null;
  const summary =
    target !== null
      ? `${label} : ${money(value)} sur une cible de ${money(target)}`
      : `${label} : ${money(value)}, pas de cible`;
  return (
    <div className={s.gauge}>
      <div className={s.gaugeHead}>
        <span className={s.gaugeLabel}>
          <span className={s.swatch} style={{ background: color }} aria-hidden="true" />
          {label}
        </span>
        <span className={s.gaugeValue}>{money(value)}</span>
      </div>
      {/* Sans cible, une barre pleine laisserait croire à un objectif atteint : pas de barre. */}
      {target !== null && (
        <div className={s.track} style={{ ["--c" as string]: color }} role="img" aria-label={summary}>
          <div className={s.fill} style={{ width: `${fill * 100}%` }} />
          {mark !== null && <div className={s.mark} style={{ left: `${mark * 100}%` }} />}
        </div>
      )}
      {caption !== false && (
        <p className={s.caption}>{caption ?? (target !== null ? <>cible {money(target)}</> : "pas encore de cible")}</p>
      )}
    </div>
  );
}

export type Segment = { key: string; label: string; value: Cents; color: string };

type SegmentedBarProps = {
  label: string;
  segments: Segment[];
  /** Montrer la légende (toujours au-delà d'un segment). */
  legend?: boolean;
};

/** Barre segmentée : parts d'un total, séparées par un filet de la couleur du fond. Valeurs positives seulement. */
export function SegmentedBar({ label, segments, legend = true }: SegmentedBarProps) {
  const shown = segments.filter((seg) => seg.value > 0);
  const total = shown.reduce((sum, seg) => sum + seg.value, 0);
  if (total === 0) return null;
  return (
    <div className={s.segmentedWrap}>
      <div className={s.segmented} role="img" aria-label={`${label} : ${shown.map((seg) => `${seg.label} ${money(seg.value)}`).join(", ")}`}>
        {shown.map((seg) => (
          <div
            key={seg.key}
            className={s.segment}
            style={{ flexGrow: seg.value, background: seg.color }}
            title={`${seg.label} : ${money(seg.value)}`}
          />
        ))}
      </div>
      {legend && (
        <ul className={s.legend}>
          {shown.map((seg) => (
            <li key={seg.key}>
              <span className={s.swatch} style={{ background: seg.color }} aria-hidden="true" />
              <span className={s.legendLabel}>{seg.label}</span>
              <span className={s.legendValue}>{money(seg.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type StatProps = { label: string; value: ReactNode; note?: ReactNode; tone?: "default" | "negative" };

/** Indicateur chiffré : libellé, valeur, précision facultative. */
export function Stat({ label, value, note, tone = "default" }: StatProps) {
  return (
    <div className={s.stat}>
      <p className={s.statLabel}>{label}</p>
      <p className={`${s.statValue} ${tone === "negative" ? s.negative : ""}`}>{value}</p>
      {note && <p className={s.statNote}>{note}</p>}
    </div>
  );
}

/** Pastille de couleur devant un libellé. */
export function Dot({ color }: { color: string }) {
  return <span className={s.dot} style={{ background: color }} aria-hidden="true" />;
}
