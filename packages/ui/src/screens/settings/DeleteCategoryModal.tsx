import { categoryUsage, createRecord, deleteCategory, indexOf, newId, type Bucket, type Category } from "@cashmyr/core";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Button, Field, Segmented, Select, submitOnEnter, TextInput } from "../../components/controls";
import { Modal } from "../../components/Modal";
import { BUCKET_LABELS, expenseGroups, liveCategories, nextColor } from "../../lib/data";
import { moneyExact } from "../../lib/format";
import { useActions, useApp } from "../../store/context";
import { usageText } from "./AccountsSection";
import { categoryWeight } from "./CategoriesSection";
import s from "./Settings.module.css";

const BUCKETS: Bucket[] = ["besoin", "envie", "invest"];

/**
 * Décision 31 : une catégorie utilisée ne disparaît qu'en passant ses opérations,
 * récurrences et dettes à une autre de même nature, existante ou créée ici.
 */
export function DeleteCategoryModal({ categoryId }: { categoryId: string }) {
  const data = useApp((st) => st.data);
  const { apply, closeModal } = useActions();
  const id = useId();
  const category = indexOf(data).categories.get(categoryId);
  const others = category ? liveCategories(data, category.kind).filter((c) => c.id !== categoryId) : [];
  const sameBucket = others.find((c) => c.bucket === category?.bucket);

  const [mode, setMode] = useState<"existing" | "new">(others.length > 0 ? "existing" : "new");
  const [targetId, setTargetId] = useState(sameBucket?.id ?? others[0]?.id ?? "");
  const [name, setName] = useState("");
  const [bucket, setBucket] = useState<Bucket>(category?.bucket ?? "besoin");
  const [error, setError] = useState<string | null>(null);

  // Supprimée entre-temps (autre appareil) : la fenêtre n'a plus d'objet.
  useEffect(() => {
    if (!category || category.deletedAt !== null) closeModal();
  }, [category, closeModal]);
  if (!category || category.deletedAt !== null) return null;

  const usage = categoryUsage(data, category.id);
  const weight = categoryWeight(data, category.id);
  const target = mode === "existing" ? others.find((c) => c.id === targetId) : undefined;
  const targetBucket = mode === "existing" ? target?.bucket : bucket;
  const shifts = category.kind === "out" && targetBucket !== undefined && targetBucket !== category.bucket && weight.count > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const now = Date.now();
    let replacement: string | Category;
    if (mode === "existing") {
      if (!target) return setError("Choisis la catégorie qui la remplace.");
      replacement = target.id;
    } else {
      const trimmed = name.trim();
      if (!trimmed) return setError("Donne un nom à la nouvelle catégorie.");
      if (liveCategories(data, category.kind).some((c) => c.name.localeCompare(trimmed, "fr", { sensitivity: "base" }) === 0)) {
        return setError("Une catégorie porte déjà ce nom : choisis-la parmi les existantes.");
      }
      replacement = createRecord<Category>(
        newId(),
        {
          name: trimmed,
          kind: category.kind,
          ...(category.kind === "out" ? { bucket } : {}),
          color: category.kind === "in" ? nextColor(data.collections.categories.filter((c) => c.kind === "in")) : 0,
        },
        now,
      );
    }
    try {
      const changes = deleteCategory(data, category.id, now, replacement);
      const into = typeof replacement === "string" ? (target?.name ?? "") : replacement.name;
      if (await apply(changes, undefined, `« ${category.name} » supprimée : tout passe dans « ${into} »`)) closeModal();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      title={`Supprimer « ${category.name} »`}
      width="narrow"
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            Annuler
          </Button>
          <Button variant="danger" type="submit" form={`${id}-form`}>
            Réaffecter et supprimer
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} className={s.modalForm} onSubmit={submit} onKeyDown={submitOnEnter} noValidate>
        <p>Utilisée par {usageText(usage)}. Elles passeront dans :</p>
        {others.length > 0 && (
          <Segmented<"existing" | "new">
            label="Catégorie de remplacement"
            value={mode}
            options={[
              { value: "existing", label: "Une catégorie existante" },
              { value: "new", label: "Une nouvelle catégorie" },
            ]}
            onChange={setMode}
          />
        )}
        <Field label="Catégorie" htmlFor={`${id}-target`} hidden={mode !== "existing"}>
          <Select id={`${id}-target`} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {category.kind === "in"
              ? others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))
              : expenseGroups(data).map((g) => (
                  <optgroup key={g.bucket} label={g.label}>
                    {g.categories
                      .filter((c) => c.id !== category.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
          </Select>
        </Field>
        <Field label="Nom de la nouvelle catégorie" htmlFor={`${id}-name`} hidden={mode !== "new"}>
          <TextInput id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Usage" htmlFor={`${id}-bucket`} hidden={mode !== "new" || category.kind !== "out"}>
          <Select id={`${id}-bucket`} value={bucket} onChange={(e) => setBucket(e.target.value as Bucket)}>
            {BUCKETS.map((b) => (
              <option key={b} value={b}>
                {BUCKET_LABELS[b]}
              </option>
            ))}
          </Select>
        </Field>
        {shifts && (
          <p className={s.warning} role="status">
            Les mois passés changent : {moneyExact(weight.amount)} de dépenses passent de {BUCKET_LABELS[category.bucket!]} à{" "}
            {BUCKET_LABELS[targetBucket]}.
          </p>
        )}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
