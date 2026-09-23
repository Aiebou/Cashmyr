import {
  applyChanges,
  createDebtRecurrence,
  createRecord,
  dayOfMonthOf,
  isValidDay,
  mergeChanges,
  newId,
  type Account,
  type Cents,
  type Changes,
  type Debt,
  type Goal,
  type Role,
} from "@cashmyr/core";
import { useId, useState, type FormEvent } from "react";
import { AmountInput, Button, Checkbox, Field, FieldRow, Select, submitOnEnter, TextInput } from "../components/controls";
import { Modal } from "../components/Modal";
import { expenseGroups, liveAccounts, nextColor, ROLE_LABELS } from "../lib/data";
import { useActions, useApp } from "../store/context";
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

export function CreateAccountModal() {
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
      setTab("accounts");
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
  const data = useApp((st) => st.data);
  const today = useApp((st) => st.today);
  const { apply, closeModal, setTab } = useActions();
  const id = useId();
  const accounts = liveAccounts(data);
  const needs = expenseGroups(data);
  const creditCategory = needs.flatMap((g) => g.categories).find((c) => c.name.toLowerCase().startsWith("crédit"));

  const [name, setName] = useState("");
  const [total, setTotal] = useState<Cents | null>(null);
  const [paid, setPaid] = useState<Cents | null>(0);
  const [installment, setInstallment] = useState<Cents | null>(null);
  const [count, setCount] = useState("");
  const [start, setStart] = useState(today);
  const [withRecurrence, setWithRecurrence] = useState(false);
  const [categoryId, setCategoryId] = useState(creditCategory?.id ?? "");
  const [accountId, setAccountId] = useState(accounts.find((a) => a.role === "courant")?.id ?? accounts[0]?.id ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = count.trim() === "" ? 0 : Number(count);
    const hasSchedule = (installment ?? 0) > 0 || n > 0;
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = "Donne un intitulé à la dette.";
    if (total === null) found.total = "Montant invalide.";
    if (paid === null) found.paid = "Montant invalide.";
    if (hasSchedule) {
      if (!installment || installment <= 0) found.installment = "Indique le montant d'une échéance.";
      if (!Number.isInteger(n) || n < 1) found.count = "Indique le nombre d'échéances.";
      if (!isValidDay(start)) found.start = "Date invalide.";
      if (!found.installment && !found.count && total && total > installment! * n) {
        found.total = "Le total dépasse ce que couvrent les échéances.";
      }
    } else if (!total || total <= 0) {
      found.total = "Indique le montant total, ou un échéancier.";
    }
    if (withRecurrence && !hasSchedule) found.recurrence = "Le prélèvement suppose un échéancier.";
    if (withRecurrence && (!categoryId || !accountId)) found.recurrence = "Choisis la catégorie et le compte du prélèvement.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const now = Date.now();
    const debt = createRecord<Debt>(
      newId(),
      {
        name: name.trim(),
        creditor: "",
        direction: "owe",
        principal: total ?? 0,
        paidManual: paid ?? 0,
        mode: hasSchedule ? "installments" : "free",
        installmentAmount: hasSchedule ? installment! : 0,
        installmentCount: hasSchedule ? n : 0,
        startDate: start,
        dayOfMonth: dayOfMonthOf(start),
        categoryId: categoryId || null,
        accountId: accountId || null,
        recurrenceId: null,
        hidden: false,
        pinned: false,
        settled: false,
        settledAt: null,
        archived: false,
        position: nextPosition(data.collections.debts),
        color: nextColor(data.collections.debts),
      },
      now,
    );
    let changes: Changes = { debts: [debt] };
    if (withRecurrence) {
      try {
        changes = mergeChanges(changes, createDebtRecurrence(applyChanges(data, changes), debt.id, today, now));
      } catch (err) {
        setErrors({ recurrence: (err as Error).message });
        return;
      }
    }
    if (await apply(changes, undefined, "Dette créée")) {
      closeModal();
      setTab("debts");
    }
  };

  return (
    <FormModal title="Nouvelle dette" formId={`${id}-f`} onSubmit={submit}>
      <Field label="Intitulé" htmlFor={`${id}-name`} error={errors.name}>
        <TextInput id={`${id}-name`} data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Prêt auto, avance d'un proche…" autoComplete="off" />
      </Field>
      <FieldRow>
        <Field label="Montant total" htmlFor={`${id}-total`} hint="Vide : calculé depuis les échéances" error={errors.total}>
          <AmountInput id={`${id}-total`} onAmount={(c, t) => setTotal(t.trim() === "" ? 0 : c)} />
        </Field>
        <Field label="Déjà réglé" htmlFor={`${id}-paid`} error={errors.paid}>
          <AmountInput id={`${id}-paid`} initial={0} onAmount={(c, t) => setPaid(t.trim() === "" ? 0 : c)} />
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="Montant par échéance" htmlFor={`${id}-inst`} error={errors.installment}>
          <AmountInput id={`${id}-inst`} onAmount={(c, t) => setInstallment(t.trim() === "" ? null : c)} />
        </Field>
        <Field label="Nombre d'échéances" htmlFor={`${id}-count`} error={errors.count}>
          <TextInput id={`${id}-count`} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
      </FieldRow>
      <Field label="Première échéance" htmlFor={`${id}-start`} error={errors.start}>
        <TextInput id={`${id}-start`} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </Field>
      <Checkbox label="Créer aussi le prélèvement mensuel" checked={withRecurrence} onChange={(e) => setWithRecurrence(e.target.checked)} />
      <FieldRow>
        <Field label="Catégorie du prélèvement" htmlFor={`${id}-cat`} hidden={!withRecurrence}>
          <Select id={`${id}-cat`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="" disabled>
              Choisir une catégorie
            </option>
            {needs.map((g) => (
              <optgroup key={g.bucket} label={g.label}>
                {g.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Compte débité" htmlFor={`${id}-acc`} hidden={!withRecurrence} error={errors.recurrence}>
          <Select id={`${id}-acc`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </FieldRow>
      {errors.recurrence && !withRecurrence && <p role="alert">{errors.recurrence}</p>}
    </FormModal>
  );
}
