import {
  categoryUsage,
  colorFor,
  createRecord,
  deleteCategory,
  hasCustomColor,
  indexOf,
  isUsed,
  newId,
  nextStamp,
  setBudgetColor,
  setIncomeColor,
  touch,
  type Budget,
  type Category,
  type Dataset,
} from "@cashmyr/core";
import { useState, type FormEvent } from "react";
import { ColorField } from "../../components/ColorField";
import { Button, cx, IconButton, InlineText, Select, TextInput } from "../../components/controls";
import { TrashIcon } from "../../components/icons";
import { Card } from "../../components/layout";
import { budgetName, expenseGroups, liveBudgets, liveCategories, nextColor } from "../../lib/data";
import { count, money } from "../../lib/format";
import { useActions, useApp } from "../../store/context";
import s from "./Settings.module.css";

/** Montant et nombre des opérations vivantes d'une catégorie : ce qu'un changement d'usage déplacerait. */
export function categoryWeight(data: Dataset, categoryId: string) {
  const ops = indexOf(data).liveOps.filter((o) => o.categoryId === categoryId);
  return { count: ops.length, amount: ops.reduce((t, o) => t + o.amount, 0) };
}

function DeleteButton({ category }: { category: Category }) {
  const data = useApp((st) => st.data);
  const { apply, ask, openModal } = useActions();
  const remove = async () => {
    if (isUsed(categoryUsage(data, category.id))) {
      openModal({ kind: "delete-category", categoryId: category.id });
      return;
    }
    const ok = await ask({
      title: `Supprimer « ${category.name} » ?`,
      message: "Aucune opération, récurrence ni dette ne l'utilise.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (ok) await apply(deleteCategory(data, category.id, Date.now()), undefined, "Catégorie supprimée");
  };
  return (
    <IconButton label={`Supprimer « ${category.name} »`} onClick={remove}>
      <TrashIcon size={16} />
    </IconButton>
  );
}

function AddCategory({ kind, budget }: { kind: "in" | "out"; budget?: Budget }) {
  const data = useApp((st) => st.data);
  const { apply } = useActions();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const label = kind === "in" ? "Nouvelle source de revenu" : `Nouvelle catégorie · ${budget!.name}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (liveCategories(data, kind).some((c) => c.name.localeCompare(trimmed, "fr", { sensitivity: "base" }) === 0)) {
      setError("Cette catégorie existe déjà.");
      return;
    }
    setError(null);
    const category = createRecord<Category>(
      newId(),
      {
        name: trimmed,
        kind,
        ...(budget ? { budgetId: budget.id } : {}),
        color: kind === "in" ? nextColor(data.collections.categories.filter((c) => c.kind === "in")) : 0,
      },
      Date.now(),
    );
    if (await apply({ categories: [category] }, undefined, "Catégorie ajoutée")) setName("");
  };

  return (
    <form className={s.addRow} onSubmit={submit} noValidate>
      <TextInput aria-label={label} placeholder={kind === "in" ? "Nouvelle source" : "Nouvelle catégorie"} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      <Button type="submit" size="small" disabled={!name.trim()}>
        Ajouter
      </Button>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function IncomeSources() {
  const data = useApp((st) => st.data);
  const { apply } = useActions();
  const prefs = data.preferences;
  const sources = liveCategories(data, "in");
  return (
    <Card title="Sources de revenu" subtitle="La pastille colore la source dans les jauges, les barres et les listes.">
      <ul className={cx(s.list, s.categoryList)}>
        {sources.map((c) => {
          const target = { kind: "income" as const, category: c };
          return (
            <li key={c.id} className={s.categoryRow}>
              <InlineText label={`Nom de « ${c.name} »`} value={c.name} required onCommit={(name) => apply({ categories: [touch(c, { name }, Date.now())] })} />
              <ColorField
                label={c.name}
                value={colorFor(prefs, target)}
                custom={hasCustomColor(prefs, target)}
                onPick={(hex) => apply({}, setIncomeColor(prefs, c.id, hex, Date.now()))}
                onReset={() => apply({}, setIncomeColor(prefs, c.id, null, Date.now()))}
              />
              <DeleteButton category={c} />
            </li>
          );
        })}
      </ul>
      <AddCategory kind="in" />
    </Card>
  );
}

function ExpenseCategories() {
  const data = useApp((st) => st.data);
  const { apply, ask } = useActions();
  const prefs = data.preferences;

  const move = async (c: Category, budgetId: string) => {
    const weight = categoryWeight(data, c.id);
    if (weight.count > 0) {
      const ok = await ask({
        title: `Passer « ${c.name} » dans ${budgetName(data, budgetId)} ?`,
        message:
          `Les mois passés changent aussi : ${count(weight.count, "opération", "opérations")}, ${money(weight.amount)} en tout, ` +
          `passent de ${budgetName(data, c.budgetId)} à ${budgetName(data, budgetId)}.`,
        confirmLabel: "Changer de budget",
      });
      if (!ok) return;
    }
    // Un type appartient à son budget (décision 72) : changer de budget retire le type.
    const { typeId: _type, ...rest } = c;
    await apply({ categories: [{ ...rest, budgetId, updatedAt: nextStamp(Date.now(), c) }] }, undefined, "Budget modifié");
  };

  return (
    <Card title="Catégories de dépense" subtitle="Rangées par budget. La couleur d'un budget vaut pour toutes ses catégories.">
      {expenseGroups(data).map((g) => {
        const target = { kind: "budget" as const, budget: g.budget };
        return (
          <div key={g.budget.id} className={s.group}>
            <div className={s.groupHead}>
              <h4 className={s.groupTitle}>{g.label}</h4>
              <ColorField
                label={g.label}
                value={colorFor(prefs, target)}
                custom={hasCustomColor(prefs, target)}
                onPick={(hex) => apply({}, setBudgetColor(prefs, g.budget.id, hex, Date.now()))}
                onReset={() => apply({}, setBudgetColor(prefs, g.budget.id, null, Date.now()))}
              />
            </div>
            <ul className={cx(s.list, s.categoryList)}>
              {g.categories.map((c) => (
                <li key={c.id} className={cx(s.categoryRow, s.withBucket)}>
                  <InlineText label={`Nom de « ${c.name} »`} value={c.name} required onCommit={(name) => apply({ categories: [touch(c, { name }, Date.now())] })} />
                  <Select aria-label={`Budget de « ${c.name} »`} value={c.budgetId} onChange={(e) => void move(c, e.target.value)}>
                    {liveBudgets(data).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                  <DeleteButton category={c} />
                </li>
              ))}
            </ul>
            <AddCategory kind="out" budget={g.budget} />
          </div>
        );
      })}
    </Card>
  );
}

export function CategoriesSection() {
  return (
    <>
      <IncomeSources />
      <ExpenseCategories />
    </>
  );
}
