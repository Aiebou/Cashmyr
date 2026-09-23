import type { Cents, Month } from "@cashmyr/core";
import { useState } from "react";
import { moneyExact, monthName } from "../../lib/format";
import { axisLabel, niceTicks, useWidth } from "./scale";
import s from "./charts.module.css";

export type MonthBar = {
  month: Month;
  income: Cents;
  needs: Cents;
  wants: Cents;
  saved: Cents;
  balance: Cents;
  future: boolean;
};

type Props = {
  months: MonthBar[];
  colors: { besoin: string; envie: string; invest: string };
};

const HEIGHT = 232;
const M = { top: 14, right: 8, bottom: 26, left: 58 };
const GAP = 2;

/** Rectangle aux coins supérieurs arrondis (extrémité de la donnée), carré sur la ligne de base. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

const shortMonth = (m: Month, narrow: boolean) => {
  const name = monthName(m);
  if (narrow) return name.charAt(0).toUpperCase();
  return name.length <= 4 ? name : `${name.slice(0, name === "juillet" ? 4 : 3)}.`;
};

/**
 * Douze mois : pour chaque mois, besoins, envies et mise de côté empilés, et un
 * trait horizontal au niveau des revenus. L'écart entre le haut de la pile et le
 * trait, c'est le reste.
 */
export function MonthsChart({ months, colors }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const plotW = Math.max(120, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const band = plotW / months.length;
  const barW = Math.min(24, band * 0.56);
  const narrow = band < 34;
  // Le trait des revenus déborde un peu de la barre, sans jamais toucher le mois voisin.
  const overhang = Math.max(0, Math.min(5, (band - barW) / 2 - 3));

  const stackTop = (m: MonthBar) => m.needs + m.wants + Math.max(0, m.saved);
  const max = Math.max(1, ...months.map((m) => Math.max(stackTop(m), m.income)));
  const ticks = niceTicks(0, max);
  const top = ticks[ticks.length - 1]!;
  const y = (v: number) => M.top + plotH - (v / top) * plotH;
  const seg = (v: number) => (v / top) * plotH;

  const current = active !== null ? months[active] : undefined;

  return (
    <div className={s.chart} ref={ref}>
      <ul className={s.legend}>
        <li>
          <span className={s.swatch} style={{ background: colors.besoin }} />
          Besoins
        </li>
        <li>
          <span className={s.swatch} style={{ background: colors.envie }} />
          Envies
        </li>
        <li>
          <span className={s.swatch} style={{ background: colors.invest }} />
          Mise de côté
        </li>
        <li>
          <span className={s.tickKey} />
          Revenus
        </li>
      </ul>
      <div className={s.plot}>
        <svg width={width} height={HEIGHT} role="img" aria-label="Revenus et usages, mois par mois">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? s.baseline : s.grid} />
              <text x={M.left - 8} y={y(t)} className={s.axis} textAnchor="end" dominantBaseline="middle">
                {axisLabel(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = M.left + band * i + band / 2;
            const x = cx - barW / 2;
            const parts = [
              { v: m.needs, c: colors.besoin },
              { v: m.wants, c: colors.envie },
              { v: Math.max(0, m.saved), c: colors.invest },
            ].filter((p) => p.v > 0);
            let base = M.top + plotH;
            return (
              <g key={m.month} className={active !== null && active !== i ? s.dim : undefined}>
                {parts.map((p, k) => {
                  const h = seg(p.v);
                  const drawn = Math.max(0, h - (k > 0 ? GAP : 0));
                  // Chaque segment au-dessus du premier laisse un filet de 2 px sous lui.
                  base -= h;
                  const yTop = base;
                  const isTop = k === parts.length - 1;
                  return isTop ? (
                    <path key={k} d={topRounded(x, yTop, barW, drawn, 4)} fill={p.c} />
                  ) : (
                    <rect key={k} x={x} y={yTop} width={barW} height={drawn} fill={p.c} />
                  );
                })}
                {m.income > 0 && (
                  <line x1={cx - barW / 2 - overhang} x2={cx + barW / 2 + overhang} y1={y(m.income)} y2={y(m.income)} className={s.incomeTick} />
                )}
                <text x={cx} y={HEIGHT - 8} textAnchor="middle" className={m.future ? s.axisMuted : s.axis}>
                  {shortMonth(m.month, narrow)}
                </text>
                <rect
                  x={M.left + band * i}
                  y={M.top}
                  width={band}
                  height={plotH}
                  className={s.hit}
                  tabIndex={0}
                  aria-label={`${monthName(m.month)} : revenus ${moneyExact(m.income)}, besoins ${moneyExact(m.needs)}, envies ${moneyExact(m.wants)}, mis de côté ${moneyExact(m.saved)}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
        {current && active !== null && (
          <div
            className={s.tooltip}
            style={{ left: Math.min(Math.max(M.left + band * active + band / 2, 90), width - 90) }}
            role="presentation"
          >
            <p className={s.tooltipTitle}>{monthName(current.month)}</p>
            <dl>
              <dt>Revenus</dt>
              <dd>{moneyExact(current.income)}</dd>
              <dt>Besoins</dt>
              <dd>{moneyExact(current.needs)}</dd>
              <dt>Envies</dt>
              <dd>{moneyExact(current.wants)}</dd>
              <dt>Mis de côté</dt>
              <dd>{moneyExact(current.saved)}</dd>
              <dt>Reste</dt>
              <dd>{moneyExact(current.balance)}</dd>
            </dl>
          </div>
        )}
      </div>
      <details className={s.table}>
        <summary>Voir les chiffres</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Mois</th>
              <th scope="col">Revenus</th>
              <th scope="col">Besoins</th>
              <th scope="col">Envies</th>
              <th scope="col">Mis de côté</th>
              <th scope="col">Reste</th>
            </tr>
          </thead>
          <tbody>
            {months
              .filter((m) => !m.future)
              .map((m) => (
                <tr key={m.month}>
                  <th scope="row">{monthName(m.month)}</th>
                  <td>{moneyExact(m.income)}</td>
                  <td>{moneyExact(m.needs)}</td>
                  <td>{moneyExact(m.wants)}</td>
                  <td>{moneyExact(m.saved)}</td>
                  <td>{moneyExact(m.balance)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
