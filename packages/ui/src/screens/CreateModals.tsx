import { createRecord, isValidDay, newId, type Account, type Cents, type Goal, type Role } from "@cashmyr/core";
import { useId, useState, type FormEvent } from "react";
import { AmountInput, Button, Checkbox, Field, Select, submitOnEnter, TextInput } from "../components/controls";
import { Modal } from "../components/Modal";
import { liveAccounts, nextColor, ROLE_LABELS } from "../lib/data";
import { useActions, useApp } from "../store/context";
import { useDebtForm } from "./DebtForm";
import s from "./OperationModal.module.css";

const nextPosition = (items: readonly { position: number; deletedAt: number | null }[]) =>
  items.filter((i) => i.deletedAt === null).reduce((max, i) => Math.max(max, i.position), 0) + 1;

function FormModal({ title, formId, onSubmit, children }: { title: string; formId: string; onSubmit(e: FormEvent): void; children: React.ReactNode }) {
  const { closeModal } = useActions();
  return (
    <Modal
      title={title}
      width="narrow"
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            Fermer
          </Button>
          <Button variant="primary" type="submit" form={formId}>
            Créer
          </Button>
        </>
      }
    >
      <form id={formId} className={s.form} onSubmit={onSubmit} onKeyDown={submitOnEnter} noValidate>
        {children}
      </form>
    </Modal>
  );
}

export function CreateGoalModal() {
  const data = useApp((st) => st.data);
  const { apply, closeModal, setTab } = useActions();
  const id = useId();
  const [name, setName] = useState("");
  const [target, setTarget] = useState<Cents | null>(null);
  const [due, setDue] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = "Donne un nom à l'objectif.";
    if (target === null || target <= 0) found.target = "Indique un montant cible.";
    if (due && !isValidDay(due)) found.due = "Date invalide.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const goal = createRecord<Goal>(
      newId(),
      {
        name: name.trim(),
        target: target!,
        targetMode: "manual",
        source: "tagged",
        accountIds: [],
        due: due || null,
        hidden: false,
        pinned: false,
        done: false,
        doneAt: null,
        archived: false,
        position: nextPosition(data.collections.goals),
        color: nextColor(data.collections.goals),
      },
      Date.now(),
    );
    if (await apply({ goals: [goal] }, undefined, "Objectif créé")) {
      closeModal();
      setTab("goals");
    }
  };

  return (
    <FormModal title="Nouvel objectif" formId={`${id}-f`} onSubmit={submit}>
      <Field label="Nom" htmlFor={`${id}-name`} error={errors.name}>
        <TextInput id={`${id}-name`} data-autofocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Montant cible" htmlFor={`${id}-target`} error={errors.target}>
        <AmountInput id={`${id}-target`} big onAmount={setTarget} placeholder="0,00" />
      </Field>
      <Field label="Échéance" htmlFor={`${id}-due`} hint="Facultative" error={errors.due}>
        <TextInput id={`${id}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </Field>
    </FormModal>
  );
}

/** `stay` : créé depuis les paramètres, on y reste au lieu de basculer sur Mes comptes. */
export function CreateAccountModal({ stay = false }: { stay?: boolean }) {
  const data = useApp((st) => st.data);
  const { apply, closeModal, setTab } = useActions();
  const id = useId();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>(liveAccounts(data).length === 0 ? "courant" : "epargne");
  const [opening, setOpening] = useState<Cents | null>(0);
  const [safety, setSafety] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = "Donne un nom au compte.";
    if (opening === null) found.opening = "Montant invalide.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const account = createRecord<Account>(
      newId(),
      { name: name.trim(), role, opening: opening!, safety, color: nextColor(data.collections.accounts) },
      Date.now(),
    );
    if (await apply({ accounts: [account] }, undefined, "Compte créé")) {
      closeModal();
      if (!stay) setTab("accounts");
    }
  };

  return (
    <FormModal title="Nouveau compte" formId={`${id}-f`} onSubmit={submit}>
      <Field label="Nom" htmlFor={`${id}-name`} error={errors.name}>
        <TextInput id={`${id}-name`} data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Compte courant, Livret A…" autoComplete="off" />
      </Field>
      <Field label="Type de compte" htmlFor={`${id}-role`}>
        <Select id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Solde de départ" htmlFor={`${id}-opening`} hint="Le point zéro du suivi ; peut être négatif." error={errors.opening}>
        <AmountInput id={`${id}-opening`} initial={0} allowNegative onAmount={setOpening} />
      </Field>
      <Checkbox label="Compte d'épargne de précaution" checked={safety} onChange={(e) => setSafety(e.target.checked)} />
    </FormModal>
  );
}

export function CreateDebtModal() {
  const { closeModal, setTab } = useActions();
  const id = useId();
  const form = useDebtForm({
    full: false,
    onCreated: () => {
      closeModal();
      setTab("debts");
    },
  });
  return (
    <FormModal title="Nouvelle dette" formId={`${id}-f`} onSubmit={form.submit}>
      {form.fields}
    </FormModal>
  );
}
