import { type AverageWindow, type Dataset } from "@cashmyr/core";
import { useId, useState, type FormEvent } from "react";
import { Button, Field, Segmented, submitOnEnter, TextInput } from "../../components/controls";
import { Dot } from "../../components/figures";
import { Card } from "../../components/layout";
import { budgetColor, budgetName, splitBudgets } from "../../lib/data";
import { useActions, useApp } from "../../store/context";
import s from "./Settings.module.css";

/** Points de base → « 50 » ou « 33,33 ». */
export const percentText = (bp: number): string =>
  bp % 100 === 0 ? String(bp / 100) : `${Math.floor(bp / 100)},${String(bp % 100).padStart(2, "0").replace(/0$/, "")}`;

/** « 33,33 » → 3 333 points de base ; deux décimales au plus, jamais de flottant. */
export function parsePercent(text: string): number | null {
  const m = /^\s*(\d{1,3})(?:[.,](\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bp <= 10_000 ? bp : null;
}

/**
 * Un pourcentage par budget (décision 75) : les budgets vivants, et un budget supprimé ailleurs qui
 * garde une part jusqu'au prochain enregistrement. Enregistrer retire ce dernier de la répartition.
 */
function Splits({ data }: { data: Dataset }) {
  const prefs = data.preferences;
  const { setPreference } = useActions();
  const id = useId();
  const budgets = splitBudgets(data);
  const ids = budgets.map((b) => b.id);
  const live = budgets.filter((b) => b.deletedAt === null).map((b) => b.id);
  const initial = () => Object.fromEntries(ids.map((b) => [b, percentText(prefs.splits[b] ?? 0)])) as Record<string, string>;
  const [draft, setDraft] = useState(initial);
  const parsed = ids.map((b) => parsePercent(draft[b] ?? "0"));
  const valid = parsed.every((p) => p !== null);
  const sum = parsed.reduce<number>((t, p) => t + (p ?? 0), 0);
  const dirty = ids.some((b, i) => parsed[i] !== (prefs.splits[b] ?? 0));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || sum !== 10_000 || !dirty) return;
    const next = Object.fromEntries(ids.map((b, i) => [b, parsed[i]!]).filter(([b]) => live.includes(b as string)));
    await setPreference("splits", next);
  };

  let status;
  if (!valid) status = <p className={s.error} role="alert">Un pourcentage est illisible : un nombre entre 0 et 100, deux décimales au plus.</p>;
  else if (sum !== 10_000) {
    const gap = 10_000 - sum;
    status = (
      <p className={s.error} role="alert">
        Total : {percentText(sum)} % · {gap > 0 ? `il manque ${percentText(gap)} %` : `${percentText(-gap)} % de trop`}
      </p>
    );
  } else status = <p className={s.total}>Total : 100 %</p>;

  return (
    <Card title="Répartition cible" subtitle="Part des revenus visée pour chaque budget ; le total doit faire 100 %.">
      <form className={s.splits} onSubmit={save} onKeyDown={submitOnEnter} noValidate>
        {ids.map((b) => (
          <div key={b} className={s.split}>
            <label className={s.splitLabel} htmlFor={`${id}-${b}`}>
              <Dot color={budgetColor(data, b)} />
              {budgetName(data, b)}
            </label>
            <span className={s.percent}>
              <TextInput id={`${id}-${b}`} inputMode="decimal" value={draft[b]} onChange={(e) => setDraft({ ...draft, [b]: e.target.value })} autoComplete="off" />
            </span>
          </div>
        ))}
        {status}
        <div className={s.actions}>
          <Button type="submit" variant="primary" disabled={!valid || sum !== 10_000 || !dirty}>
            Enregistrer la répartition
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft(initial())}>
              Annuler
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

export function BudgetSection() {
  const data = useApp((st) => st.data);
  const prefs = data.preferences;
  const { setPreference } = useActions();
  const id = useId();
  return (
    <>
      {/* La clé repart d'un brouillon propre quand la répartition change ailleurs (synchronisation). */}
      <Splits key={JSON.stringify(prefs.splits)} data={data} />
      <Card title="Calcul des cibles">
        <Field
          label="Base de calcul"
          htmlFor={`${id}-basis`}
          hint={
            prefs.basis === "avg"
              ? "Les cibles du mois s'appliquent au revenu moyen, plus stable d'un mois à l'autre."
              : "Les cibles du mois s'appliquent aux revenus de ce mois-là."
          }
        >
          <Segmented
            label="Base de calcul"
            value={prefs.basis}
            options={[
              { value: "month", label: "Revenus du mois" },
              { value: "avg", label: "Revenu moyen" },
            ]}
            onChange={(basis) => setPreference("basis", basis)}
          />
        </Field>
        <Field
          label="Fenêtre de moyenne"
          htmlFor={`${id}-window`}
          hint="Revenu moyen, dépenses moyennes et épargne de précaution : les mois civils qui précèdent, un mois vide comptant pour zéro."
        >
          <Segmented
            label="Fenêtre de moyenne"
            value={String(prefs.averageWindow)}
            options={[
              { value: "3", label: "3 mois" },
              { value: "6", label: "6 mois" },
              { value: "12", label: "12 mois" },
            ]}
            onChange={(w) => setPreference("averageWindow", Number(w) as AverageWindow)}
          />
        </Field>
      </Card>
    </>
  );
}
