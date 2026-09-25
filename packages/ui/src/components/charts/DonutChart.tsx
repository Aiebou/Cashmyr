import type { Cents } from "@cashmyr/core";
import { useId, useState } from "react";
import { money, ratio } from "../../lib/format";
import type { Slice } from "../../lib/month-charts";
import s from "./charts.module.css";

type Props = {
  /** Nom du graphique, lu par les lecteurs d'écran. */
  label: string;
  slices: readonly Slice[];
  /** Texte quand il n'y a rien à montrer. */
  empty: string;
};

const SIZE = 132;
const OUTER = 64;
const INNER = 43;
const C = SIZE / 2;

/** Point du cercle de rayon `r` à l'angle `a` (0 = midi, sens des aiguilles d'une montre). */
const at = (r: number, a: number) => `${C + r * Math.sin(a)} ${C - r * Math.cos(a)}`;

/** Secteur d'anneau entre deux angles. Un secteur plein (une seule part) est tracé en deux moitiés. */
function arc(from: number, to: number): string {
  if (to - from >= 2 * Math.PI - 1e-6) return `${arc(0, Math.PI)} ${arc(Math.PI, 2 * Math.PI)}`;
  const large = to - from > Math.PI ? 1 : 0;
  return [
    `M ${at(OUTER, from)}`,
    `A ${OUTER} ${OUTER} 0 ${large} 1 ${at(OUTER, to)}`,
    `L ${at(INNER, to)}`,
    `A ${INNER} ${INNER} 0 ${large} 0 ${at(INNER, from)}`,
    "Z",
  ].join(" ");
}

/**
 * Camembert en anneau : chaque part garde un liseré de 2 px couleur du fond, « Autres » est hachuré.
 * Le centre donne le total ; au survol ou au focus d'une part (ou de sa ligne de légende), sa valeur
 * et sa part. La légende est aussi le tableau : chaque poste y a son montant et son pourcentage.
 */
export function DonutChart({ label, slices, empty }: Props) {
  const [active, setActive] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const hatch = `hatch-${useId().replace(/:/g, "")}`;
  const total = slices.reduce((sum, sl) => sum + sl.value, 0);
  if (total <= 0) return <p className={s.donutEmpty}>{empty}</p>;

  const share = (value: Cents) => ratio(value / total);
  let angle = 0;
  const arcs = slices.map((sl) => {
    const from = angle;
    angle += (sl.value / total) * 2 * Math.PI;
    return { slice: sl, d: arc(from, angle) };
  });
  const current = slices.find((sl) => sl.key === active) ?? null;
  const fill = (sl: Slice) => sl.color ?? `url(#${hatch})`;
  const on = (key: string) => ({
    onPointerEnter: () => setActive(key),
    onPointerLeave: () => setActive((k) => (k === key ? null : k)),
    onFocus: () => setActive(key),
    onBlur: () => setActive((k) => (k === key ? null : k)),
  });

  return (
    <div className={s.donut}>
      <div className={s.ring}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={`${label} : ${slices.map((sl) => `${sl.label} ${money(sl.value)}, ${share(sl.value)}`).join(" ; ")}`}
        >
          <defs>
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--panel)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink-3)" strokeWidth="2.4" />
            </pattern>
          </defs>
          {arcs.map(({ slice, d }) => (
            <path
              key={slice.key}
              d={d}
              fill={fill(slice)}
              stroke="var(--panel)"
              strokeWidth={2}
              strokeLinejoin="round"
              className={s.donutPart}
              data-dim={active !== null && active !== slice.key ? "" : undefined}
              {...on(slice.key)}
            />
          ))}
        </svg>
        <div className={s.donutCenter} aria-hidden="true">
          <strong>{money(current ? current.value : total)}</strong>
          <span>{current ? `${current.label} · ${share(current.value)}` : "Total"}</span>
        </div>
      </div>
      <ul className={s.donutLegend}>
        {slices.map((sl) => (
          <li key={sl.key} tabIndex={0} data-active={active === sl.key ? "" : undefined} {...on(sl.key)}>
            <span className={sl.color ? s.swatch : `${s.swatch} ${s.swatchHatch}`} style={sl.color ? { background: sl.color } : undefined} aria-hidden="true" />
            <span className={s.donutLabel}>{sl.label}</span>
            <span className={s.donutValue}>{money(sl.value)}</span>
            <span className={s.donutShare}>{share(sl.value)}</span>
            {sl.details && (
              <button
                type="button"
                className={s.donutMore}
                aria-expanded={details}
                onClick={() => setDetails((v) => !v)}
              >
                {details ? "Masquer le détail" : "Voir le détail"}
              </button>
            )}
            {sl.details && details && (
              <ul className={s.donutDetails}>
                {sl.details.map((d) => (
                  <li key={d.key}>
                    <span>{d.label}</span>
                    <span>{money(d.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
