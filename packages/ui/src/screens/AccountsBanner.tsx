import { colorFor, isFluctuatingRole, netWorth, totalOwed, worthOverview, type Dataset, type Day, type WorthMode } from "@cashmyr/core";
import { Select } from "../components/controls";
import { SegmentedBar } from "../components/figures";
import { count, money } from "../lib/format";
import { displayOf } from "../store/app-store";
import { useActions, useApp } from "../store/context";
import s from "./AccountsBanner.module.css";

type Props = { data: Dataset; asOf: Day; today: Day; year: number };

/** Les trois totaux proposés (décision 42) ; le choix reste propre à l'appareil. */
const MODES: { value: WorthMode; option: string; title: string }[] = [
  { value: "declared", option: "Valeurs déclarées", title: "Total de mes comptes" },
  { value: "injected", option: "Capital injecté", title: "Total de mes comptes en capital injecté" },
  { value: "injectedOutsideCurrent", option: "Injecté hors comptes courants", title: "Capital injecté hors comptes courants" },
];

/** Bandeau du total des comptes, commun au tableau de bord et à Mes comptes. */
export function AccountsBanner({ data, asOf, today, year }: Props) {
  const prefs = data.preferences;
  const mode = displayOf(useApp((st) => st.device)).bannerTotal;
  const { setDisplay } = useActions();
  const w = worthOverview(data, asOf, today, mode);
  const current = MODES.find((m) => m.value === mode)!;
  const hasDebt = data.collections.debts.some((d) => d.deletedAt === null);

  const segments = w.byAccount
    .filter((b) => b.value > 0)
    .map((b) => {
      // Comptes épargne, placement et autre : la valeur déclarée en avant, le capital injecté dessous.
      const detailed = mode === "declared" && isFluctuatingRole(b.account.role);
      return {
        key: b.account.id,
        label: b.account.name,
        value: b.value,
        color: colorFor(prefs, { kind: "series", color: b.account.color }),
        ...(detailed ? { note: b.declared !== null ? `injecté ${money(b.balance)}` : "valeur non déclarée", warn: b.declared === null } : {}),
      };
    });

  const others = Math.abs(w.others) > 100 ? w.others : 0;
  return (
    <section className={s.banner} aria-labelledby="banner-title">
      <div className={s.head}>
        <p className={s.eyebrow} id="banner-title">
          {current.title} {asOf === today ? "aujourd'hui" : `au 31 décembre ${year}`}
        </p>
        <label className="visually-hidden" htmlFor="banner-mode">
          Total affiché
        </label>
        <Select
          id="banner-mode"
          className={s.mode}
          value={mode}
          onChange={(e) => void setDisplay({ bannerTotal: e.target.value as WorthMode })}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.option}
            </option>
          ))}
        </Select>
      </div>
      <p className={s.big}>{money(w.total)}</p>
      <SegmentedBar label="Répartition par compte" segments={segments} />
      <div className={s.lines}>
        {mode === "injectedOutsideCurrent" ? (
          <p>
            Dont {money(w.savings)} d'épargne et de placements{others ? ` et ${money(others)} sur d'autres comptes` : ""}.
          </p>
        ) : (
          <p>
            Dont {money(w.current)} disponibles au quotidien et {money(w.savings)} d'épargne et de placements
            {others ? `, et ${money(others)} sur d'autres comptes` : ""}.
          </p>
        )}
        {mode !== "injectedOutsideCurrent" && <p>Valeur injectée (hors comptes courants) : {money(w.injectedOutsideCurrent)}.</p>}
        {mode === "declared" && w.undeclared > 0 && (
          <p>
            {w.undeclared > 1
              ? `${count(w.undeclared, "compte", "comptes")} sans valeur déclarée comptent pour leur capital injecté.`
              : "Un compte sans valeur déclarée compte pour son capital injecté."}
          </p>
        )}
        {hasDebt && (
          <p>
            Dettes restantes : {money(totalOwed(data, asOf))}. Patrimoine net : <strong>{money(netWorth(data, asOf, today))}</strong>.
          </p>
        )}
      </div>
    </section>
  );
}
