import { budgetWeight, createBudget, deleteBudget, indexOf, type BudgetNature } from "@cashmyr/core";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Button, Field, Segmented, Select, submitOnEnter, TextInput } from "../../components/controls";
import { Modal } from "../../components/Modal";
import { budgetName, liveBudgets } from "../../lib/data";
import { money } from "../../lib/format";
import { useActions, useApp } from "../../store/context";
import { percentText } from "./BudgetSection";
import s from "./Settings.module.css";

/** Nouveau budget : un nom et une nature ; il arrive à 0 % de la répartition (point 9). */
export function CreateBudgetModal() {
  const data = useApp((st) => st.data);
  const { apply, closeModal } = useActions();
  const id = useId();
  const [name, setName] = useState("");
  const [nature, setNature] = useState<BudgetNature>("spend");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Donne un nom au budget.");
    if (await apply({ budgets: [createBudget(data, name, nature, Date.now())] }, undefined, "Budget créé")) closeModal();
  };

  return (
    <Modal
      title="Nouveau budget"
      width="narrow"
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            Fermer
          </Button>
          <Button variant="primary" type="submit" form={`${id}-f`}>
            Créer
          </Button>
        </>
      }
    >
      <form id={`${id}-f`} className={s.modalForm} onSubmit={submit} onKeyDown={submitOnEnter} noValidate>
        <Field label="Nom" htmlFor={`${id}-name`} error={error ?? undefined}>
          <TextInput id={`${id}-name`} data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Formation, Vacances…" autoComplete="off" />
        </Field>
        <Field
          label="Nature"
          htmlFor={`${id}-nature`}
          hint={
            nature === "spend"
              ? "Ses dépenses comptent dans « dépensé », et sa jauge rougit au-delà de sa cible."
              : "Ses dépenses comptent dans « mis de côté » et le taux d'épargne ; sa jauge dit ce qu'il reste à mettre de côté."
          }
        >
          <Segmented
            label="Nature"
            value={nature}
            options={[
              { value: "spend", label: "Dépense" },
              { value: "save", label: "Épargne" },
            ]}
            onChange={(v) => setNature(v as BudgetNature)}
          />
        </Field>
        <p className={s.muted}>Il arrive à 0 % de la répartition : ajuste ensuite les pourcentages.</p>
      </form>
    </Modal>
  );
}

/**
 * Supprimer un budget (point 13, décision 87) : ses catégories passent dans le budget choisi, sans
 * type ; ses types disparaissent ; sa part s'ajoute à celle du budget choisi.
 */
export function DeleteBudgetModal({ budgetId }: { budgetId: string }) {
  const data = useApp((st) => st.data);
  const { apply, closeModal } = useActions();
  const id = useId();
  const budget = indexOf(data).budgets.get(budgetId);
  const others = liveBudgets(data).filter((b) => b.id !== budgetId);
  const [targetId, setTargetId] = useState(others.find((b) => b.nature === budget?.nature)?.id ?? others[0]?.id ?? "");

  // Supprimé entre-temps (autre appareil) : la fenêtre n'a plus d'objet.
  useEffect(() => {
    if (!budget || budget.deletedAt !== null) closeModal();
  }, [budget, closeModal]);
  if (!budget || budget.deletedAt !== null) return null;

  const weight = budgetWeight(data, budget.id);
  const share = data.preferences.splits[budget.id] ?? 0;
  const target = others.find((b) => b.id === targetId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target) return;
    const { changes, preferences } = deleteBudget(data, budget.id, target.id, Date.now());
    if (await apply(changes, preferences, `« ${budget.name} » supprimé : tout passe dans « ${target.name} »`)) closeModal();
  };

  return (
    <Modal
      title={`Supprimer « ${budget.name} »`}
      width="narrow"
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            Annuler
          </Button>
          <Button variant="danger" type="submit" form={`${id}-f`} disabled={!target}>
            Supprimer le budget
          </Button>
        </>
      }
    >
      <form id={`${id}-f`} className={s.modalForm} onSubmit={submit} noValidate>
        <Field label="Ses catégories passent dans" htmlFor={`${id}-target`}>
          <Select id={`${id}-target`} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {others.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <p className={s.muted}>Ses types disparaissent : ses catégories arrivent sans type, et les comptes qui les portaient les perdent.</p>
        {target && share > 0 && (
          <p role="status">
            Sa part de la répartition, {percentText(share)} %, s'ajoute à celle de « {target.name} ».
          </p>
        )}
        {target && weight.count > 0 && (
          <p className={s.warning} role="status">
            Les mois passés changent : {money(weight.amount)} de dépenses passent de {budgetName(data, budget.id)} à {target.name}.
          </p>
        )}
      </form>
    </Modal>
  );
}
