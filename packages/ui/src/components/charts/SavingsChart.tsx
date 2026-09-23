import { lastDayOf, type Cents, type Day, type Month } from "@cashmyr/core";
import { useState } from "react";
import { dayLong, money, moneyExact, monthName } from "../../lib/format";
import { axisLabel, niceTicks, useWidth } from "./scale";
import s from "./charts.module.css";

type Props = {
  /** Les douze mois de l'année, pour l'axe. */
  months: Month[];
  /** Total épargne et placements à la fin de chaque mois commencé. */
  points: { month: Month; total: Cents }[];
  color: string;
  today: Day;
};

const HEIGHT = 208;
const M = { top: 16, right: 64, bottom: 26, left: 58 };

/** Courbe de progression de l'épargne : une seule série, sans légende ; valeur à l'extrémité. */
export function SavingsChart({ months, points, color, today }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const plotW = Math.max(120, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const step = plotW / Math.max(1, months.length - 1);
  const values = points.map((p) => p.total);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(1, ...values));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const x = (i: number) => M.left + i * step;
  const y = (v: number) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const idx = (m: Month) => months.indexOf(m);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(idx(p.month))},${y(p.total)}`).join("");
  const area =
    points.length > 1
      ? `${line}L${x(idx(points[points.length - 1]!.month))},${y(Math.max(lo, 0))}L${x(idx(points[0]!.month))},${y(Math.max(lo, 0))}Z`
      : "";
  const last = points[points.length - 1];
  const current = active !== null ? points[active] : undefined;
  const dateOf = (m: Month) => {
    const end = lastDayOf(m);
    return end > today ? `Aujourd'hui (${dayLong(today)})` : `Fin ${monthName(m)}`;
  };

  return (
    <div className={s.chart} ref={ref}>
      <div className={s.plot}>
        <svg width={width} height={HEIGHT} role="img" aria-label={last ? `Épargne et placements : ${money(last.total)} à ce jour` : "Pas encore de données"}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? s.baseline : s.grid} />
              <text x={M.left - 8} y={y(t)} className={s.axis} textAnchor="end" dominantBaseline="middle">
                {axisLabel(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) => (
            <text key={m} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className={idx(m) > (last ? idx(last.month) : -1) ? s.axisMuted : s.axis}>
              {monthName(m).charAt(0).toUpperCase()}
            </text>
          ))}
          {area && <path d={area} fill={color} opacity={0.1} />}
          {points.length > 0 && <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {current && active !== null && (
            <>
              <line x1={x(idx(current.month))} x2={x(idx(current.month))} y1={M.top} y2={M.top + plotH} className={s.crosshair} />
              <circle cx={x(idx(current.month))} cy={y(current.total)} r={4} fill={color} className={s.ring} />
            </>
          )}
          {last && (
            <>
              <circle cx={x(idx(last.month))} cy={y(last.total)} r={4} fill={color} className={s.ring} />
              <text x={x(idx(last.month)) + 10} y={y(last.total)} dominantBaseline="middle" className={s.endLabel}>
                {axisLabel(last.total)}
              </text>
            </>
          )}
          {points.map((p, i) => (
            <rect
              key={p.month}
              x={x(idx(p.month)) - step / 2}
              y={M.top}
              width={step}
              height={plotH}
              className={s.hit}
              tabIndex={0}
              aria-label={`${dateOf(p.month)} : ${moneyExact(p.total)}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
        </svg>
        {current && active !== null && (
          <div className={s.tooltip} style={{ left: Math.min(Math.max(x(idx(current.month)), 90), width - 90) }} role="presentation">
            <p className={s.tooltipTitle}>{dateOf(current.month)}</p>
            <p>{moneyExact(current.total)}</p>
          </div>
        )}
      </div>
      <details className={s.table}>
        <summary>Voir les chiffres</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Épargne et placements</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.month}>
                <th scope="row">{dateOf(p.month)}</th>
                <td>{moneyExact(p.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
