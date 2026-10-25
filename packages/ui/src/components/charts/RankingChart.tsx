import type { Cents } from "@cashmyr/core";
import { money } from "../../lib/format";
import s from "./charts.module.css";

export type RankItem = { key: string; label: string; amount: Cents; color: string };

/** La légende : les budgets de dépense, chacun dans sa couleur. */
type Props = { items: RankItem[]; legend: { key: string; label: string; color: string }[]; limit?: number };

/** Classement des postes de dépense : barres horizontales, valeur au bout, les petits regroupés. */
export function RankingChart({ items, legend, limit = 8 }: Props) {
  const head = items.slice(0, limit);
  const rest = items.slice(limit);
  const restTotal = rest.reduce((sum, i) => sum + i.amount, 0);
  const max = Math.max(1, ...head.map((i) => i.amount), restTotal);
  return (
    <div className={s.chart}>
      <ul className={s.legend}>
        {legend.map((l) => (
          <li key={l.key}>
            <span className={s.swatch} style={{ background: l.color }} />
            {l.label}
          </li>
        ))}
      </ul>
      <ol className={s.ranking}>
        {head.map((item) => (
          <li key={item.key} title={`${item.label} : ${money(item.amount)}`}>
            <span className={s.rankLabel}>{item.label}</span>
            <span className={s.rankTrack}>
              <span className={s.rankBar} style={{ width: `${(item.amount / max) * 100}%`, background: item.color }} />
              <span className={s.rankValue}>{money(item.amount)}</span>
            </span>
          </li>
        ))}
        {rest.length > 0 && (
          <li title={`${rest.length} autres postes : ${money(restTotal)}`}>
            <span className={s.rankLabel}>
              {rest.length} autre{rest.length > 1 ? "s" : ""} poste{rest.length > 1 ? "s" : ""}
            </span>
            <span className={s.rankTrack}>
              <span className={s.rankBar} style={{ width: `${(restTotal / max) * 100}%`, background: "var(--ink-3)" }} />
              <span className={s.rankValue}>{money(restTotal)}</span>
            </span>
          </li>
        )}
      </ol>
    </div>
  );
}
