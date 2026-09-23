import {
  categoryUsage,
  colorFor,
  createRecord,
  deleteCategory,
  hasCustomColor,
  indexOf,
  isUsed,
  newId,
  setBucketColor,
  setIncomeColor,
  touch,
  type Bucket,
  type Category,
  type Dataset,
} from "@cashmyr/core";
import { useState, type FormEvent } from "react";
import { ColorField } from "../../components/ColorField";
import { Button, cx, IconButton, InlineText, Select, TextInput } from "../../components/controls";
import { TrashIcon } from "../../components/icons";
import { Card } from "../../components/layout";
import { BUCKET_LABELS, expenseGroups, liveCategories, nextColor } from "../../lib/data";
import { count, moneyExact } from "../../lib/format";
import { useActions, useApp } from "../../store/context";
import s from "./Settings.module.css";

const BUCKETS: Bucket[] = ["besoin", "envie", "invest"];

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

function AddCategory({ kind, bucket }: { kind: "in" | "out"; bucket?: Bucket }) {
  const data = useApp((st) => st.data);
  const { apply } = useActions();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const label = kind === "in" ? "Nouvelle source de revenu" : `Nouvelle catégorie · ${BUCKET_LABELS[bucket!]}`;

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
        ...(bucket ? { bucket } : {}),
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

  const move = async (c: Category, bucket: Bucket) => {
    const weight = categoryWeight(data, c.id);
    if (weight.count > 0) {
      const ok = await ask({
        title: `Passer « ${c.name} » en ${BUCKET_LABELS[bucket]} ?`,
        message:
          `Les mois passés changent aussi : ${count(weight.count, "opération", "opérations")}, ${moneyExact(weight.amount)} en tout, ` +
          `passent de ${BUCKET_LABELS[c.bucket!]} à ${BUCKET_LABELS[bucket]}.`,
        confirmLabel: "Changer l'usage",
      });
      if (!ok) return;
    }
    await apply({ categories: [touch(c, { bucket }, Date.now())] }, undefined, "Usage modifié");
  };

  return (
    <Card title="Catégories de dépense" subtitle="Rangées par usage. La couleur d'un usage vaut pour toutes ses catégories.">
      {expenseGroups(data).map((g) => {
        const target = { kind: "bucket" as const, bucket: g.bucket };
        return (
          <div key={g.bucket} className={s.group}>
            <div className={s.groupHead}>
              <h4 className={s.groupTitle}>{g.label}</h4>
              <ColorField
                label={g.label}
                value={colorFor(prefs, target)}
                custom={hasCustomColor(prefs, target)}
                onPick={(hex) => apply({}, setBucketColor(prefs, g.bucket, hex, Date.now()))}
                onReset={() => apply({}, setBucketColor(prefs, g.bucket, null, Date.now()))}
              />
            </div>
            <ul className={cx(s.list, s.categoryList)}>
              {g.categories.map((c) => (
                <li key={c.id} className={cx(s.categoryRow, s.withBucket)}>
                  <InlineText label={`Nom de « ${c.name} »`} value={c.name} required onCommit={(name) => apply({ categories: [touch(c, { name }, Date.now())] })} />
                  <Select aria-label={`Usage de « ${c.name} »`} value={c.bucket} onChange={(e) => void move(c, e.target.value as Bucket)}>
                    {BUCKETS.map((b) => (
                      <option key={b} value={b}>
                        {BUCKET_LABELS[b]}
                      </option>
                    ))}
                  </Select>
                  <DeleteButton category={c} />
                </li>
              ))}
            </ul>
            <AddCategory kind="out" bucket={g.bucket} />
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
