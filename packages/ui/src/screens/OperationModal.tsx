import {
  addMonths,
  createRecord,
  dayOfMonthOf,
  deleteOperation,
  firstDayOf,
  indexOf,
  isValidDay,
  monthOf,
  newId,
  nextStamp,
  type Cents,
  type Changes,
  type Day,
  type Operation,
  type OpType,
  type Recurrence,
} from "@cashmyr/core";
import { useId, useMemo, useState, type FormEvent } from "react";
import { AmountInput, Button, Checkbox, Field, FieldRow, Segmented, Select, submitOnEnter, TextInput } from "../components/controls";
import { Modal } from "../components/Modal";
import { TagField } from "../components/TagField";
import { accountName, expenseGroups, liveAccounts, liveCategories, liveDebts, liveGoals } from "../lib/data";
import { tagChoice, tagText } from "../lib/tags";
import { useActions, useApp } from "../store/context";
import s from "./OperationModal.module.css";

type Props = { type: OpType; editId?: string };

const TYPE_OPTIONS: { value: OpType; label: string }[] = [
  { value: "out", label: "Dépense" },
  { value: "in", label: "Revenu" },
  { value: "tx", label: "Transfert" },
];

const SAVED: Record<OpType, string> = { out: "Dépense enregistrée", in: "Revenu enregistré", tx: "Transfert enregistré" };

/**
 * Saisie d'une opération, le geste le plus fréquent. Le montant vient en premier ;
 * Entrée valide. Les champs sans objet pour le type choisi sont masqués.
 */
export function OperationModal({ type: initialType, editId }: Props) {
  const data = useApp((st) => st.data);
  const today = useApp((st) => st.today);
  const shownMonth = useApp((st) => st.month);
  const { apply, closeModal } = useActions();
  const id = useId();

  const existing = editId ? indexOf(data).operations.get(editId) : undefined;
  const accounts = liveAccounts(data);
  const defaultAccount = accounts.find((a) => a.role === "courant")?.id ?? accounts[0]?.id ?? "";
  const defaultSaving = accounts.find((a) => a.role === "epargne" || a.role === "invest")?.id ?? "";
  const defaultDate: Day = monthOf(today) === shownMonth ? today : firstDayOf(shownMonth);

  const [type, setType] = useState<OpType>(existing?.type ?? initialType);
  const [amount, setAmount] = useState<Cents | null>(existing?.amount ?? null);
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [accountId, setAccountId] = useState(existing?.accountId ?? defaultAccount);
  const [fromId, setFromId] = useState(existing?.fromAccountId ?? defaultAccount);
  const [toId, setToId] = useState(existing?.toAccountId ?? defaultSaving);
  const [goalId, setGoalId] = useState(existing?.goalId ?? "");
  const [debtId, setDebtId] = useState(existing?.debtId ?? "");
  const [date, setDate] = useState<Day>(existing?.date ?? defaultDate);
  const [note, setNote] = useState(existing?.note ?? "");
  const [tag, setTag] = useState(() => tagText(data, existing?.tagId));
  const [repeat, setRepeat] = useState(false);
  const [repeatDay, setRepeatDay] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const incomes = liveCategories(data, "in");
  const groups = expenseGroups(data);
  const goals = liveGoals(data);
  const debts = liveDebts(data);
  const recurrence = existing?.recurrenceId ? indexOf(data).recurrences.get(existing.recurrenceId) : undefined;
  const isTransfer = type === "tx";
  const day = repeatDay ?? (isValidDay(date) ? dayOfMonthOf(date) : 1);

  // Au changement de type, une catégorie de l'autre nature n'a plus de sens.
  const categoryOk = useMemo(() => {
    const c = indexOf(data).categories.get(categoryId);
    return c !== undefined && c.kind === type;
  }, [data, categoryId, type]);

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (amount === null || amount <= 0) e.amount = "Indique un montant supérieur à zéro.";
    if (!isValidDay(date)) e.date = "Date invalide.";
    if (isTransfer) {
      if (!fromId) e.from = "Choisis le compte de départ.";
      if (!toId) e.to = "Choisis le compte d'arrivée.";
      if (fromId && fromId === toId) e.to = "Le compte d'arrivée doit être différent.";
    } else {
      if (!categoryOk) e.category = "Choisis une catégorie.";
      if (!accountId) e.account = "Choisis un compte.";
    }
    return e;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const now = Date.now();
    const tagged = tagChoice(data, tag, existing?.tagId, now);
    const fields: Omit<Operation, "id" | "updatedAt" | "deletedAt"> = {
      date,
      amount: amount!,
      type,
      note: note.trim(),
      ...(isTransfer ? { fromAccountId: fromId, toAccountId: toId } : { categoryId, accountId }),
      ...(goalId ? { goalId } : {}),
      ...(debtId ? { debtId } : {}),
      ...(existing?.recurrenceId ? { recurrenceId: existing.recurrenceId } : {}),
      ...(tagged.tagId ? { tagId: tagged.tagId } : {}),
    };
    const op: Operation = existing
      ? { id: existing.id, updatedAt: nextStamp(now, existing), deletedAt: null, ...fields }
      : createRecord<Operation>(newId(), fields, now);
    const changes: Changes = { ...tagged.changes, operations: [op] };
    if (repeat && !existing) {
      const rec = createRecord<Recurrence>(
        newId(),
        {
          label: note.trim() || (isTransfer ? "Transfert" : indexOf(data).categories.get(categoryId)?.name ?? "Opération"),
          amount: amount!,
          type,
          ...(isTransfer ? { fromAccountId: fromId, toAccountId: toId } : { categoryId, accountId }),
          ...(goalId ? { goalId } : {}),
          ...(debtId ? { debtId } : {}),
          ...(tagged.tagId ? { tagId: tagged.tagId } : {}),
          dayOfMonth: day,
          startMonth: addMonths(monthOf(date), 1),
          endMonth: null,
          active: true,
        },
        now,
      );
      changes.recurrences = [rec];
    }
    if (await apply(changes, undefined, existing ? "Opération modifiée" : SAVED[type])) closeModal();
  };

  const remove = async () => {
    if (!existing) return;
    const message = recurrence ? "Occurrence annulée : elle ne sera pas régénérée" : "Opération supprimée";
    if (await apply(deleteOperation(data, existing.id, Date.now()), undefined, message)) closeModal();
  };

  const noAccount = accounts.length === 0;

  return (
    <Modal
      title={existing ? "Modifier l'opération" : "Nouvelle opération"}
      onClose={closeModal}
      footer={
        <>
          {existing && (
            <Button variant="danger" onClick={remove} className={s.delete}>
              {recurrence ? "Annuler cette occurrence" : "Supprimer"}
            </Button>
          )}
          <Button variant="ghost" onClick={closeModal}>
            Fermer
          </Button>
          <Button variant="primary" type="submit" form={`${id}-form`} disabled={noAccount}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} className={s.form} onSubmit={submit} onKeyDown={submitOnEnter} noValidate>
        <Segmented<OpType> label="Type d'opération" value={type} options={TYPE_OPTIONS} onChange={setType} />

        {noAccount && <p className={s.notice}>Crée d'abord un compte, depuis le bouton Ajouter.</p>}

        <Field label="Montant" htmlFor={`${id}-amount`} error={errors.amount}>
          <AmountInput
            id={`${id}-amount`}
            big
            data-autofocus
            initial={existing?.amount ?? null}
            placeholder="0,00"
            aria-invalid={errors.amount ? true : undefined}
            onAmount={(cents) => setAmount(cents)}
          />
        </Field>

        <FieldRow>
          <Field label="Catégorie" htmlFor={`${id}-category`} error={errors.category} hidden={isTransfer}>
            <Select id={`${id}-category`} value={categoryOk ? categoryId : ""} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="" disabled>
                Choisir une catégorie
              </option>
              {type === "in"
                ? incomes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))
                : groups.map((g) => (
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
          <Field label="Date" htmlFor={`${id}-date`} error={errors.date}>
            <TextInput id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Libellé" htmlFor={`${id}-note`} hint="Facultatif">
            <TextInput id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
          </Field>
        </FieldRow>

        <TagField id={`${id}-tag`} data={data} value={tag} onChange={setTag} />

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

        {recurrence ? (
          <p className={s.notice}>
            Générée par la récurrence « {recurrence.label} ». La modifier ici ne change pas la récurrence ; la supprimer
            annule cette occurrence seulement.
          </p>
        ) : existing ? null : (
          <div className={s.repeat}>
            <Checkbox
              label="Répéter chaque mois, à partir du mois suivant"
              checked={repeat}
              onChange={(e) => setRepeat(e.target.checked)}
            />
            <Field label="Jour du mois" htmlFor={`${id}-day`} hidden={!repeat} hint="Rabattu sur le dernier jour des mois courts">
              <Select id={`${id}-day`} value={day} onChange={(e) => setRepeatDay(Number(e.target.value))}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {isTransfer && fromId && toId && fromId !== toId && (
          <p className={s.summary}>
            {accountName(data, fromId)} → {accountName(data, toId)}
          </p>
        )}
      </form>
    </Modal>
  );
}
