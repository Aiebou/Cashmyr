import { categoryUsage, createRecord, deleteCategory, indexOf, newId, reclassCategory, retiredCategories, type Category } from "@cashmyr/core";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Button, Field, Segmented, Select, submitOnEnter, TextInput } from "../../components/controls";
import { Modal } from "../../components/Modal";
import { budgetName, expenseGroups, liveBudgets, liveCategories, nextColor, retiredName } from "../../lib/data";
import { money } from "../../lib/format";
import { useActions, useApp } from "../../store/context";
import { usageText } from "./AccountsSection";
import { categoryWeight } from "./CategoriesSection";
import s from "./Settings.module.css";

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
  const sameBudget = others.find((c) => c.budgetId === category?.budgetId);

  const [mode, setMode] = useState<"existing" | "new">(others.length > 0 ? "existing" : "new");
  const [targetId, setTargetId] = useState(sameBudget?.id ?? others[0]?.id ?? "");
  const [name, setName] = useState("");
  const [budgetId, setBudgetId] = useState(category?.budgetId ?? liveBudgets(data)[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  // Supprimée entre-temps (autre appareil) : la fenêtre n'a plus d'objet.
  useEffect(() => {
    if (!category || category.deletedAt !== null) closeModal();
  }, [category, closeModal]);
  if (!category || category.deletedAt !== null) return null;

  const usage = categoryUsage(data, category.id);
  const weight = categoryWeight(data, category.id);
  const target = mode === "existing" ? others.find((c) => c.id === targetId) : undefined;
  const targetBudget = mode === "existing" ? target?.budgetId : budgetId;
  const shifts = category.kind === "out" && targetBudget !== undefined && targetBudget !== category.budgetId && weight.count > 0;

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
          ...(category.kind === "out" ? { budgetId } : {}),
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
                  <optgroup key={g.budget.id} label={g.label}>
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
        <Field label="Budget" htmlFor={`${id}-budget`} hidden={mode !== "new" || category.kind !== "out"}>
          <Select id={`${id}-budget`} value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
            {liveBudgets(data).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        {shifts && (
          <p className={s.warning} role="status">
            Les mois passés changent : {money(weight.amount)} de dépenses passent de {budgetName(data, category.budgetId)} à{" "}
            {budgetName(data, targetBudget)}.
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

/**
 * Décision 89 : reclasser d'un coup ce que porte une ancienne catégorie, vers une catégorie actuelle
 * de même nature. Comme la décision 31, le changement de budget des mois passés est annoncé.
 */
export function ReclassCategoryModal({ categoryId }: { categoryId: string }) {
  const data = useApp((st) => st.data);
  const { apply, closeModal } = useActions();
  const id = useId();
  const retired = retiredCategories(data).find((r) => r.category.id === categoryId);
  const category = retired?.category;
  const others = category ? liveCategories(data, category.kind) : [];
  const [targetId, setTargetId] = useState(others.find((c) => c.budgetId === category?.budgetId)?.id ?? others[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  // Plus rien à reclasser (fait sur un autre appareil) : la fenêtre n'a plus d'objet.
  useEffect(() => {
    if (!retired) closeModal();
  }, [retired, closeModal]);
  if (!retired || !category) return null;

  const target = others.find((c) => c.id === targetId);
  const shifts = category.kind === "out" && target !== undefined && target.budgetId !== category.budgetId && retired.amount > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target) return setError("Choisis une catégorie actuelle.");
    try {
      const changes = reclassCategory(data, category.id, target.id, Date.now());
      if (await apply(changes, undefined, `« ${category.name} » reclassée dans « ${target.name} »`)) closeModal();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      title={`Reclasser « ${category.name} »`}
      width="narrow"
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form={`${id}-form`} disabled={others.length === 0}>
            Reclasser
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} className={s.modalForm} onSubmit={submit} onKeyDown={submitOnEnter} noValidate>
        <p>
          {retiredName(category.name)} : {usageText(retired.usage)}. Tout passera dans :
        </p>
        {others.length === 0 ? (
          <p className={s.muted}>Aucune catégorie actuelle de même nature : crée-en une d'abord.</p>
        ) : (
          <Field label="Catégorie" htmlFor={`${id}-target`}>
            <Select id={`${id}-target`} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              {category.kind === "in"
                ? others.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))
                : expenseGroups(data).map((g) => (
                    <optgroup key={g.budget.id} label={g.label}>
                      {g.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
            </Select>
          </Field>
        )}
        {shifts && (
          <p className={s.warning} role="status">
            Les mois passés changent : {money(retired.amount)} passent de {budgetName(data, category.budgetId)} à {budgetName(data, target.budgetId)}.
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
