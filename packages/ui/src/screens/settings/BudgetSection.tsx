import {
  budgetWeight,
  canHoldObjective,
  colorFor,
  createType,
  deleteType,
  hasCustomColor,
  moveBudget,
  PRECAUTION_TYPE_ID,
  SAVINGS_BUDGET_ID,
  setBudgetColor,
  touch,
  typeHolding,
  typesOf,
  type AverageWindow,
  type Budget,
  type BudgetNature,
  type BudgetType,
  type Dataset,
} from "@cashmyr/core";
import { useId, useState, type FormEvent } from "react";
import { ColorField } from "../../components/ColorField";
import { Button, Field, IconButton, InlineText, Segmented, Select, submitOnEnter, TextInput } from "../../components/controls";
import { Dot } from "../../components/figures";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from "../../components/icons";
import { Card } from "../../components/layout";
import { budgetColor, budgetName, splitBudgets } from "../../lib/data";
import { count, money } from "../../lib/format";
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

/** Un type d'un budget : renommer sur place, fixer son objectif (décision 88), supprimer après confirmation (décisions 84 et 85). */
function TypeRow({ type }: { type: BudgetType }) {
  const data = useApp((st) => st.data);
  const today = useApp((st) => st.today);
  const { apply, ask, openModal } = useActions();
  const remove = async () => {
    const held = typeHolding(data, type.id, today);
    const ok = await ask({
      title: `Supprimer le type « ${type.name} » ?`,
      message:
        "Ses catégories restent dans leur budget, sans type. Les comptes qui le portent le perdent ; s'il était leur type principal, le suivant le devient." +
        (held !== 0 ? `\n\n${money(held)} qui lui revenaient aujourd'hui passent aux autres types de ces comptes.` : ""),
      confirmLabel: "Supprimer le type",
      danger: true,
    });
    if (ok) await apply(deleteType(data, type.id, Date.now()), undefined, "Type supprimé");
  };
  return (
    <li className={s.typeRow}>
      <InlineText label={`Nom du type « ${type.name} »`} value={type.name} required onCommit={(name) => apply({ types: [touch(type, { name }, Date.now())] })} />
      {canHoldObjective(data, type) && (
        <Button size="small" variant="ghost" className={s.typeGoal} aria-label={`Objectif de « ${type.name} »`} onClick={() => openModal({ kind: "type-objective", typeId: type.id })}>
          {type.objective !== null ? `Objectif : ${money(type.objective.amount)}` : "Objectif"}
        </Button>
      )}
      {type.id === PRECAUTION_TYPE_ID ? (
        <span className={`${s.muted} ${s.typeNote}`}>Objectif dans Objectifs</span>
      ) : (
        <IconButton className={s.typeEnd} label={`Supprimer le type « ${type.name} »`} onClick={() => void remove()}>
          <TrashIcon size={16} />
        </IconButton>
      )}
    </li>
  );
}

/** Ajouter un type à un budget, sans formulaire imbriqué : Entrée ou le bouton. */
function AddType({ budget }: { budget: Budget }) {
  const data = useApp((st) => st.data);
  const { apply } = useActions();
  const [name, setName] = useState("");
  const add = async () => {
    if (!name.trim()) return;
    if (await apply({ types: [createType(data, budget.id, name, Date.now())] }, undefined, "Type ajouté")) setName("");
  };
  return (
    <div className={s.addRow}>
      <TextInput
        aria-label={`Nouveau type · ${budget.name}`}
        placeholder="Nouveau type"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void add();
          }
        }}
        autoComplete="off"
      />
      <Button size="small" onClick={() => void add()} disabled={!name.trim()}>
        Ajouter
      </Button>
    </div>
  );
}

/**
 * Les budgets (décisions 71 à 76 et 83 à 87) : nom, nature, couleur, ordre, pourcentage, et leurs
 * types. Les pourcentages forment un brouillon, enregistré d'un bouton quand il fait 100 % ; un
 * budget supprimé ailleurs y garde sa part jusqu'à ce prochain enregistrement.
 */
function Budgets({ data }: { data: Dataset }) {
  const prefs = data.preferences;
  const { apply, ask, openModal, setPreference } = useActions();
  const id = useId();
  const budgets = splitBudgets(data);
  const ids = budgets.map((b) => b.id);
  const live = budgets.filter((b) => b.deletedAt === null);
  const initial = () => Object.fromEntries(ids.map((b) => [b, percentText(prefs.splits[b] ?? 0)])) as Record<string, string>;
  const [draft, setDraft] = useState(initial);
  const parsed = ids.map((b) => parsePercent(draft[b] ?? "0"));
  const valid = parsed.every((p) => p !== null);
  const sum = parsed.reduce<number>((t, p) => t + (p ?? 0), 0);
  const dirty = ids.some((b, i) => parsed[i] !== (prefs.splits[b] ?? 0));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || sum !== 10_000 || !dirty) return;
    const liveIds = new Set(live.map((b) => b.id));
    await setPreference("splits", Object.fromEntries(ids.map((b, i) => [b, parsed[i]!]).filter(([b]) => liveIds.has(b as string))));
  };

  // Décision 83 : changer de nature déplace les dépenses passées entre « dépensé » et « mis de côté ».
  const changeNature = async (budget: Budget, nature: BudgetNature) => {
    const weight = budgetWeight(data, budget.id);
    if (weight.count > 0) {
      const [from, to] = nature === "spend" ? ["mis de côté", "dépensé"] : ["dépensé", "mis de côté"];
      const ok = await ask({
        title: `${budget.name} : passer en ${nature === "spend" ? "dépense" : "épargne"} ?`,
        message: `Les mois passés changent aussi : ${count(weight.count, "opération", "opérations")}, ${money(weight.amount)} en tout, passent de « ${from} » à « ${to} ».`,
        confirmLabel: "Changer la nature",
      });
      if (!ok) return;
    }
    await apply({ budgets: [touch(budget, { nature }, Date.now())] }, undefined, "Nature modifiée");
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
    <Card
      title="Budgets"
      subtitle="Part des revenus visée pour chaque budget ; le total doit faire 100 %. Chaque budget peut avoir des types."
      actions={
        <Button size="small" onClick={() => openModal({ kind: "create-budget" })}>
          <PlusIcon size={16} />
          Nouveau budget
        </Button>
      }
    >
      <form className={s.splits} onSubmit={save} onKeyDown={submitOnEnter} noValidate>
        {budgets.map((budget, index) => {
          const gone = budget.deletedAt !== null;
          const target = { kind: "budget" as const, budget };
          return (
            <section key={budget.id} className={s.budget} aria-label={budgetName(data, budget.id)}>
              <div className={s.budgetRow}>
                {gone ? (
                  <span className={s.splitLabel}>
                    <Dot color={budgetColor(data, budget.id)} />
                    {budgetName(data, budget.id)}
                  </span>
                ) : (
                  <>
                    <ColorField
                      label={budget.name}
                      value={colorFor(prefs, target)}
                      custom={hasCustomColor(prefs, target)}
                      onPick={(hex) => apply({}, setBudgetColor(prefs, budget.id, hex, Date.now()))}
                      onReset={() => apply({}, setBudgetColor(prefs, budget.id, null, Date.now()))}
                    />
                    <InlineText
                      label={`Nom du budget « ${budget.name} »`}
                      value={budget.name}
                      required
                      onCommit={(name) => apply({ budgets: [touch(budget, { name }, Date.now())] })}
                    />
                    <Select
                      aria-label={`Nature de « ${budget.name} »`}
                      value={budget.nature}
                      disabled={budget.id === SAVINGS_BUDGET_ID}
                      title={budget.id === SAVINGS_BUDGET_ID ? "Le budget « Épargne » reste un budget d'épargne : il porte la précaution." : undefined}
                      onChange={(e) => void changeNature(budget, e.target.value as BudgetNature)}
                    >
                      <option value="spend">Dépense</option>
                      <option value="save">Épargne</option>
                    </Select>
                  </>
                )}
                <span className={s.percent}>
                  <TextInput
                    id={`${id}-${budget.id}`}
                    aria-label={`Part de « ${budgetName(data, budget.id)} »`}
                    inputMode="decimal"
                    value={draft[budget.id] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [budget.id]: e.target.value })}
                    autoComplete="off"
                  />
                </span>
                {!gone && (
                  <span className={s.budgetActions}>
                    <IconButton label={`Monter « ${budget.name} »`} disabled={index === 0} onClick={() => void apply(moveBudget(data, budget.id, -1, Date.now()))}>
                      <ArrowUpIcon size={16} />
                    </IconButton>
                    <IconButton
                      label={`Descendre « ${budget.name} »`}
                      disabled={index >= live.length - 1}
                      onClick={() => void apply(moveBudget(data, budget.id, 1, Date.now()))}
                    >
                      <ArrowDownIcon size={16} />
                    </IconButton>
                    {budget.id !== SAVINGS_BUDGET_ID && live.length > 1 && (
                      <IconButton label={`Supprimer le budget « ${budget.name} »`} onClick={() => openModal({ kind: "delete-budget", budgetId: budget.id })}>
                        <TrashIcon size={16} />
                      </IconButton>
                    )}
                  </span>
                )}
              </div>
              {!gone && (
                <div className={s.types}>
                  <ul className={s.typeList} aria-label={`Types de « ${budget.name} »`}>
                    {typesOf(data, budget.id).map((type) => (
                      <TypeRow key={type.id} type={type} />
                    ))}
                  </ul>
                  <AddType budget={budget} />
                </div>
              )}
            </section>
          );
        })}
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
      <Budgets key={`${JSON.stringify(prefs.splits)}:${splitBudgets(data).map((b) => b.id).join()}`} data={data} />
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
