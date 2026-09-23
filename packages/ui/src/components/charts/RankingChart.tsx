import type { Cents } from "@cashmyr/core";
import { moneyExact, money } from "../../lib/format";
import s from "./charts.module.css";

export type RankItem = { key: string; label: string; amount: Cents; bucket: "besoin" | "envie" };

type Props = { items: RankItem[]; colors: { besoin: string; envie: string }; limit?: number };

/** Classement des postes de dépense : barres horizontales, valeur au bout, les petits regroupés. */
export function RankingChart({ items, colors, limit = 8 }: Props) {
  const head = items.slice(0, limit);
  const rest = items.slice(limit);
  const restTotal = rest.reduce((sum, i) => sum + i.amount, 0);
  const max = Math.max(1, ...head.map((i) => i.amount), restTotal);
  return (
    <div className={s.chart}>
      <ul className={s.legend}>
        <li>
          <span className={s.swatch} style={{ background: colors.besoin }} />
          Besoins
        </li>
        <li>
          <span className={s.swatch} style={{ background: colors.envie }} />
          Envies
        </li>
      </ul>
      <ol className={s.ranking}>
        {head.map((item) => (
          <li key={item.key} title={`${item.label} : ${moneyExact(item.amount)}`}>
            <span className={s.rankLabel}>{item.label}</span>
            <span className={s.rankTrack}>
              <span className={s.rankBar} style={{ width: `${(item.amount / max) * 100}%`, background: colors[item.bucket] }} />
              <span className={s.rankValue}>{money(item.amount)}</span>
            </span>
          </li>
        ))}
        {rest.length > 0 && (
          <li title={`${rest.length} autres postes : ${moneyExact(restTotal)}`}>
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
