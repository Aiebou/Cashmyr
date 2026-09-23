import {
  addMonths,
  applyChanges,
  createRecord,
  indexOf,
  materializeRecurrences,
  monthOf,
  newId,
  nextStamp,
  type Cents,
  type Month,
  type OpType,
  type Recurrence,
} from "@cashmyr/core";
import { useId, useMemo, useState, type FormEvent } from "react";
import { AmountInput, Button, Field, FieldRow, Segmented, Select, submitOnEnter, TextInput } from "../components/controls";
import { Modal } from "../components/Modal";
import { expenseGroups, liveAccounts, liveCategories, liveDebts, liveGoals } from "../lib/data";
import { count, dayLong, monthLong, ofMonth } from "../lib/format";
import { useActions, useApp } from "../store/context";
import s from "./OperationModal.module.css";

const TYPE_OPTIONS: { value: OpType; label: string }[] = [
  { value: "out", label: "Dépense" },
  { value: "in", label: "Revenu" },
  { value: "tx", label: "Transfert" },
];

/** Mois proposés : deux ans en arrière, trois ans en avant, et ceux déjà enregistrés. */
function monthChoices(current: Month, keep: (Month | null | undefined)[]): Month[] {
  const set = new Set<Month>();
  for (let i = -24; i <= 36; i++) set.add(addMonths(current, i));
  for (const m of keep) if (m) set.add(m);
  return [...set].sort();
}

/**
 * Création et modification d'une récurrence, depuis les paramètres. Les opérations déjà
 * créées ne changent pas ; un mois de début passé crée tout de suite les mois manqués, et
 * la fenêtre le dit avant d'enregistrer.
 */
export function RecurrenceModal({ editId }: { editId?: string }) {
  const data = useApp((st) => st.data);
  const today = useApp((st) => st.today);
  const { apply, closeModal } = useActions();
  const id = useId();
  const existing = editId ? indexOf(data).recurrences.get(editId) : undefined;
  const accounts = liveAccounts(data);
  const defaultAccount = accounts.find((a) => a.role === "courant")?.id ?? accounts[0]?.id ?? "";
  const current = monthOf(today);

  const [label, setLabel] = useState(existing?.label ?? "");
  const [type, setType] = useState<OpType>(existing?.type ?? "out");
  const [amount, setAmount] = useState<Cents | null>(existing?.amount ?? null);
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [accountId, setAccountId] = useState(existing?.accountId ?? defaultAccount);
  const [fromId, setFromId] = useState(existing?.fromAccountId ?? defaultAccount);
  const [toId, setToId] = useState(existing?.toAccountId ?? "");
  const [goalId, setGoalId] = useState(existing?.goalId ?? "");
  const [debtId, setDebtId] = useState(existing?.debtId ?? "");
  const [day, setDay] = useState(existing?.dayOfMonth ?? 1);
  const [startMonth, setStartMonth] = useState<Month>(existing?.startMonth ?? addMonths(current, 1));
  const [endMonth, setEndMonth] = useState<Month | "">(existing?.endMonth ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isTransfer = type === "tx";
  const category = indexOf(data).categories.get(categoryId);
  const categoryOk = category !== undefined && category.deletedAt === null && category.kind === type;
  const months = useMemo(() => monthChoices(current, [existing?.startMonth, existing?.endMonth]), [current, existing]);
  const goals = liveGoals(data);
  const debts = liveDebts(data);

  const build = (): Recurrence | null => {
    if (amount === null || amount <= 0 || !label.trim()) return null;
    if (isTransfer ? !fromId || !toId || fromId === toId : !categoryOk || !accountId) return null;
    if (endMonth !== "" && endMonth < startMonth) return null;
    const fields: Omit<Recurrence, "id" | "updatedAt" | "deletedAt"> = {
      label: label.trim(),
      amount,
      type,
      ...(isTransfer ? { fromAccountId: fromId, toAccountId: toId } : { categoryId, accountId }),
      ...(goalId ? { goalId } : {}),
      ...(debtId ? { debtId } : {}),
      dayOfMonth: day,
      startMonth,
      endMonth: endMonth === "" ? null : endMonth,
      active: existing?.active ?? true,
    };
    const now = Date.now();
    return existing
      ? { id: existing.id, updatedAt: nextStamp(now, existing), deletedAt: null, ...fields }
      : createRecord<Recurrence>(newId(), fields, now);
  };

  // Ce que l'enregistrement créerait tout de suite : les mois dont le jour est déjà passé.
  const candidate = build();
  const created =
    candidate && candidate.active
      ? materializeRecurrences(applyChanges(data, { recurrences: [candidate] }), today, 0).filter((op) => op.recurrenceId === candidate.id)
      : [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!label.trim()) found.label = "Donne un libellé à la récurrence.";
    if (amount === null || amount <= 0) found.amount = "Indique un montant supérieur à zéro.";
    if (isTransfer) {
      if (!fromId) found.from = "Choisis le compte de départ.";
      if (!toId) found.to = "Choisis le compte d'arrivée.";
      else if (fromId === toId) found.to = "Le compte d'arrivée doit être différent.";
    } else {
      if (!categoryOk) found.category = "Choisis une catégorie.";
      if (!accountId) found.account = "Choisis un compte.";
    }
    if (endMonth !== "" && endMonth < startMonth) found.end = "Le dernier mois précède le premier.";
    setErrors(found);
    const rec = build();
    if (Object.keys(found).length > 0 || !rec) return;
    if (await apply({ recurrences: [rec] }, undefined, existing ? "Récurrence modifiée" : "Récurrence créée")) closeModal();
  };

  const first = created[0];
  const last = created[created.length - 1];

  return (
    <Modal
      title={existing ? "Modifier la récurrence" : "Nouvelle récurrence"}
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            Fermer
          </Button>
          <Button variant="primary" type="submit" form={`${id}-form`} disabled={accounts.length === 0}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} className={s.form} onSubmit={submit} onKeyDown={submitOnEnter} noValidate>
        <Field label="Libellé" htmlFor={`${id}-label`} error={errors.label}>
          <TextInput id={`${id}-label`} data-autofocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Loyer, salaire, abonnement…" autoComplete="off" />
        </Field>
        <Segmented<OpType>
          label="Type d'opération"
          value={type}
          options={TYPE_OPTIONS}
          onChange={(t) => {
            setType(t);
            if (category && category.kind !== t) setCategoryId("");
          }}
        />
        <Field label="Montant" htmlFor={`${id}-amount`} error={errors.amount} hint={debtId ? "Plafond : chaque prélèvement suit l'échéancier de la dette." : undefined}>
          <AmountInput id={`${id}-amount`} initial={existing?.amount ?? null} placeholder="0,00" onAmount={(c) => setAmount(c)} />
        </Field>

        <FieldRow>
          <Field label="Catégorie" htmlFor={`${id}-category`} error={errors.category} hidden={isTransfer}>
            <Select id={`${id}-category`} value={categoryOk ? categoryId : ""} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="" disabled>
                Choisir une catégorie
              </option>
              {type === "in"
                ? liveCategories(data, "in").map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))
                : expenseGroups(data).map((g) => (
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
          <Field label="Compte" htmlFor={`${id}-account`} error={errors.account} hidden={isTransfer}>
            <Select id={`${id}-account`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Depuis" htmlFor={`${id}-from`} error={errors.from} hidden={!isTransfer}>
            <Select id={`${id}-from`} value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vers" htmlFor={`${id}-to`} error={errors.to} hidden={!isTransfer}>
            <Select id={`${id}-to`} value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="" disabled>
                Choisir un compte
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Jour du mois" htmlFor={`${id}-day`} hint="Rabattu sur le dernier jour des mois courts">
            <Select id={`${id}-day`} value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  le {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Premier mois" htmlFor={`${id}-start`}>
            <Select id={`${id}-start`} value={startMonth} onChange={(e) => setStartMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLong(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dernier mois" htmlFor={`${id}-end`} error={errors.end}>
            <Select id={`${id}-end`} value={endMonth} onChange={(e) => setEndMonth(e.target.value)}>
              <option value="">Sans fin</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLong(m)}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>

        {(goals.length > 0 || debts.length > 0) && (
          <FieldRow>
            <Field label="Objectif" htmlFor={`${id}-goal`} hint="Facultatif" hidden={goals.length === 0}>
              <Select id={`${id}-goal`} value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">Aucun</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Dette" htmlFor={`${id}-debt`} hint="Facultatif" hidden={debts.length === 0}>
              <Select id={`${id}-debt`} value={debtId} onChange={(e) => setDebtId(e.target.value)}>
                <option value="">Aucune</option>
                {debts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
        )}

        {existing && <p className={s.notice}>Les opérations déjà créées ne changent pas : seules les prochaines suivent ces réglages.</p>}
        {first && last && (
          <p className={s.notice} role="status">
            L'enregistrement crée tout de suite {count(created.length, "opération", "opérations")}
            {first === last ? `, le ${dayLong(first.date)}` : `, ${ofMonth(monthOf(first.date))} à ${monthLong(monthOf(last.date))}`} : les
            mois dont le jour est déjà passé.
          </p>
        )}
      </form>
    </Modal>
  );
}
