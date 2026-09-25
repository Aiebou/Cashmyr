import {
  allAccountsOverview,
  colorFor,
  currentAccountsOverview,
  netWorth,
  savingsOverview,
  totalOwed,
  type Dataset,
  type Day,
} from "@cashmyr/core";
import { SegmentedBar } from "../components/figures";
import { money, moneySigned } from "../lib/format";
import s from "./AccountsBanner.module.css";

type Props = { data: Dataset; asOf: Day; today: Day; year: number };

/** Bandeau du total de tous les comptes, commun au tableau de bord et à Mes comptes. */
export function AccountsBanner({ data, asOf, today, year }: Props) {
  const prefs = data.preferences;
  const all = allAccountsOverview(data, asOf);
  const daily = currentAccountsOverview(data, asOf).total;
  const savings = savingsOverview(data, asOf).total;
  const others = all.total - daily - savings;
  const hasDebt = data.collections.debts.some((d) => d.deletedAt === null);
  const segments = all.byAccount
    .filter((b) => b.balance > 0)
    .map((b) => ({
      key: b.account.id,
      label: b.account.name,
      value: b.balance,
      color: colorFor(prefs, { kind: "series", color: b.account.color }),
    }));

  return (
    <section className={s.banner} aria-labelledby="banner-title">
      <p className={s.eyebrow} id="banner-title">
        {asOf === today ? "Total de mes comptes aujourd'hui" : `Total de mes comptes au 31 décembre ${year}`}
      </p>
      <p className={s.big}>{money(all.total)}</p>
      <SegmentedBar label="Répartition par compte" segments={segments} />
      <div className={s.lines}>
        <p>
          Dont {money(daily)} disponibles au quotidien et {money(savings)} d'épargne et de placements
          {Math.abs(others) > 100 ? `, et ${money(others)} sur d'autres comptes` : ""}.
        </p>
        {all.declaredGap !== null && (
          <p>
            Valeur déclarée : {moneySigned(all.declaredGap)} par rapport au capital injecté.
          </p>
        )}
        {hasDebt && (
          <p>
            Dettes restantes : {money(totalOwed(data, asOf))}. Patrimoine net : <strong>{money(netWorth(data, asOf))}</strong>.
          </p>
        )}
      </div>
    </section>
  );
}
