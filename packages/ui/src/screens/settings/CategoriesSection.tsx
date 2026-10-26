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
  retiredCategories,
  setIncomeColor,
  touch,
  typesOf,
  type Budget,
  type Category,
  type Dataset,
} from "@cashmyr/core";
import { useState, type FormEvent } from "react";
import { ColorField } from "../../components/ColorField";
import { Button, cx, IconButton, InlineText, Select, TextInput } from "../../components/controls";
import { TrashIcon } from "../../components/icons";
import { Card } from "../../components/layout";
import { budgetName, expenseGroups, liveBudgets, liveCategories, nextColor, retiredName } from "../../lib/data";
import { count, money } from "../../lib/format";
import { useActions, useApp } from "../../store/context";
import { usageText } from "./AccountsSection";
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

  // Point 12 : le type est facultatif ; il appartient toujours au budget de la catégorie (décision 72).
  const setType = (c: Category, typeId: string) => {
    const { typeId: _old, ...rest } = c;
    return apply({ categories: [{ ...rest, ...(typeId ? { typeId } : {}), updatedAt: nextStamp(Date.now(), c) }] }, undefined, "Type modifié");
  };

  return (
    <Card title="Catégories de dépense" subtitle="Rangées par budget, avec un type si tu veux. Budgets, types et couleurs se règlent dans Budgets.">
      {expenseGroups(data).map((g) => {
        const types = typesOf(data, g.budget.id);
        return (
          <div key={g.budget.id} className={s.group}>
            <div className={s.groupHead}>
              <h4 className={s.groupTitle}>{g.label}</h4>
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
                  <Select
                    aria-label={`Type de « ${c.name} »`}
                    value={c.typeId ?? ""}
                    onChange={(e) => void setType(c, e.target.value)}
                  >
                    <option value="">Sans type</option>
                    {types.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                    {c.typeId && !types.some((type) => type.id === c.typeId) && <option value={c.typeId}>Type supprimé</option>}
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

/**
 * Décision 89 (points 17a et 17c) : les anciennes catégories encore utilisées, à reclasser d'un
 * coup. La carte disparaît quand il n'en reste aucune.
 */
function RetiredCategories() {
  const data = useApp((st) => st.data);
  const { openModal } = useActions();
  const list = retiredCategories(data);
  if (list.length === 0) return null;
  return (
    <Card title="Anciennes catégories" subtitle="Elles ne sont plus proposées, mais des opérations, récurrences ou dettes les portent encore.">
      <ul className={s.list}>
        {list.map(({ category, usage, amount }) => (
          <li key={category.id} className={s.retiredRow}>
            <span>
              {retiredName(category.name)}
              <span className={s.muted}>
                {" "}
                · {usageText(usage)}
                {amount > 0 ? ` · ${money(amount)}` : ""}
              </span>
            </span>
            <Button size="small" onClick={() => openModal({ kind: "reclass-category", categoryId: category.id })} aria-label={`Reclasser « ${category.name} »`}>
              Reclasser
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function CategoriesSection() {
  return (
    <>
      <RetiredCategories />
      <IncomeSources />
      <ExpenseCategories />
    </>
  );
}
