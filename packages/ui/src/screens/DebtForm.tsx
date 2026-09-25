import {
  applyChanges,
  createDebtRecurrence,
  createRecord,
  dayOfMonthOf,
  isValidDay,
  mergeChanges,
  newId,
  parseAmount,
  type Cents,
  type Changes,
  type Dataset,
  type Debt,
} from "@cashmyr/core";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { AmountInput, Checkbox, Field, FieldRow, Segmented, Select, TextInput } from "../components/controls";
import { expenseGroups, liveAccounts, liveCategories, nextColor } from "../lib/data";
import { computedHint, editSchedule, initialSchedule, type ScheduleState } from "../lib/schedule-fields";
import { useActions, useApp } from "../store/context";

export type Direction = Debt["direction"];

export const DIRECTION_LABELS: Record<Direction, string> = { owe: "Je dois", lent: "On me doit" };

const nextPosition = (items: readonly { position: number; deletedAt: number | null }[]) =>
  items.filter((i) => i.deletedAt === null).reduce((max, i) => Math.max(max, i.position), 0) + 1;

/** Catégorie proposée par défaut : « Crédit » pour une dette, aucune pour une somme prêtée. */
const defaultCategory = (data: Dataset, direction: Direction) =>
  direction === "owe"
    ? (liveCategories(data, "out").find((c) => c.name.toLowerCase().startsWith("crédit"))?.id ?? "")
    : "";

/** Liste des catégories d'une dette : dépenses groupées par usage, ou sources de revenu. */
export function DebtCategoryOptions({ data, direction }: { data: Dataset; direction: Direction }) {
  if (direction === "lent") {
    return (
      <>
        {liveCategories(data, "in").map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </>
    );
  }
  return (
    <>
      {expenseGroups(data).map((g) => (
        <optgroup key={g.bucket} label={g.label}>
          {g.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

type Options = {
  /** Formulaire complet de l'onglet Dettes : sens, organisme, catégorie et compte toujours visibles. */
  full: boolean;
  onCreated(): void;
};

/**
 * Création d'une dette, partagée par la modale du menu Ajouter et le formulaire de l'onglet.
 * Renvoie les champs et la fonction de validation ; l'appelant fournit le <form> et le bouton.
 */
export function useDebtForm({ full, onCreated }: Options): { fields: ReactNode; submit(e: FormEvent): Promise<void> } {
  const data = useApp((st) => st.data);
  const today = useApp((st) => st.today);
  const { apply } = useActions();
  const id = useId();
  const accounts = liveAccounts(data);

  const [direction, setDirection] = useState<Direction>("owe");
  const [name, setName] = useState("");
  const [creditor, setCreditor] = useState("");
  const [schedule, setSchedule] = useState<ScheduleState>(() => initialSchedule({ total: "", installment: "", count: "" }));
  const [paid, setPaid] = useState<Cents | null>(0);
  const [start, setStart] = useState(today);
  const [withRecurrence, setWithRecurrence] = useState(false);
  const [categoryId, setCategoryId] = useState(() => defaultCategory(data, "owe"));
  const [accountId, setAccountId] = useState(accounts.find((a) => a.role === "courant")?.id ?? accounts[0]?.id ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const lent = direction === "lent";

  const { texts } = schedule;
  const onSchedule = (field: keyof typeof texts) => (text: string) => setSchedule((st) => editSchedule(st, field, text));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const total: Cents | null = texts.total.trim() === "" ? 0 : parseAmount(texts.total);
    const installment: Cents | null = texts.installment.trim() === "" ? null : parseAmount(texts.installment);
    const count = texts.count;
    const n = count.trim() === "" ? 0 : Number(count);
    const hasSchedule = (installment ?? 0) > 0 || count.trim() !== "";
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = "Donne un intitulé à la dette.";
    if (total === null) found.total = "Montant invalide.";
    if (paid === null) found.paid = "Montant invalide.";
    if (hasSchedule) {
      if (!installment || installment <= 0) found.installment = "Indique le montant d'une échéance.";
      if (!Number.isInteger(n) || n < 1 || n > 1200) found.count = "Indique un nombre d'échéances entre 1 et 1 200.";
      if (!isValidDay(start)) found.start = "Date invalide.";
      if (!found.installment && !found.count && total && total > installment! * n) {
        found.total = "Le total dépasse ce que couvrent les échéances.";
      }
    } else if (!total || total <= 0) {
      found.total = "Indique le montant total, ou un échéancier.";
    }
    if (withRecurrence && !hasSchedule) found.recurrence = "Le prélèvement suppose un échéancier.";
    else if (withRecurrence && (!categoryId || !accountId)) found.recurrence = "Choisis la catégorie et le compte du prélèvement.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const now = Date.now();
    const debt = createRecord<Debt>(
      newId(),
      {
        name: name.trim(),
        creditor: creditor.trim(),
        direction,
        principal: total ?? 0,
        paidManual: paid ?? 0,
        mode: hasSchedule ? "installments" : "free",
        installmentAmount: hasSchedule ? installment! : 0,
        installmentCount: hasSchedule ? n : 0,
        startDate: isValidDay(start) ? start : today,
        dayOfMonth: dayOfMonthOf(isValidDay(start) ? start : today),
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
    if (await apply(changes, undefined, "Dette créée")) onCreated();
  };

  const showLinks = full || withRecurrence;
  const fields = (
    <>
      {full && (
        <Field label="Sens" htmlFor={`${id}-dir`}>
          <Segmented
            label="Sens de la dette"
            value={direction}
            options={[
              { value: "owe", label: DIRECTION_LABELS.owe },
              { value: "lent", label: DIRECTION_LABELS.lent },
            ]}
            onChange={(d) => {
              setDirection(d);
              setCategoryId(defaultCategory(data, d));
            }}
          />
        </Field>
      )}
      <FieldRow>
        <Field label="Intitulé" htmlFor={`${id}-name`} error={errors.name}>
          <TextInput
            id={`${id}-name`}
            data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={lent ? "Avance à un proche…" : "Prêt auto, avance d'un proche…"}
            autoComplete="off"
          />
        </Field>
        {full && (
          <Field label={lent ? "Personne ou organisme qui doit" : "Organisme ou personne"} htmlFor={`${id}-creditor`} hint="Facultatif">
            <TextInput id={`${id}-creditor`} value={creditor} onChange={(e) => setCreditor(e.target.value)} autoComplete="off" />
          </Field>
        )}
      </FieldRow>
      <FieldRow>
        <Field
          label="Montant total"
          htmlFor={`${id}-total`}
          hint={computedHint(schedule, "total") ?? "Remplis deux des trois montants : le troisième se calcule"}
          error={errors.total}
        >
          <AmountInput id={`${id}-total`} text={texts.total} onAmount={(_, t) => onSchedule("total")(t)} />
        </Field>
        <Field label={lent ? "Déjà remboursé" : "Déjà réglé"} htmlFor={`${id}-paid`} error={errors.paid}>
          <AmountInput id={`${id}-paid`} initial={0} onAmount={(c, t) => setPaid(t.trim() === "" ? 0 : c)} />
        </Field>
      </FieldRow>
      <FieldRow>
        <Field
          label="Montant par échéance"
          htmlFor={`${id}-inst`}
          hint={computedHint(schedule, "installment") ?? (full ? "Vide : remboursement libre" : undefined)}
          error={errors.installment}
        >
          <AmountInput id={`${id}-inst`} text={texts.installment} onAmount={(_, t) => onSchedule("installment")(t)} />
        </Field>
        <Field label="Nombre d'échéances" htmlFor={`${id}-count`} hint={computedHint(schedule, "count") ?? undefined} error={errors.count}>
          <TextInput id={`${id}-count`} inputMode="numeric" value={texts.count} onChange={(e) => onSchedule("count")(e.target.value)} autoComplete="off" />
        </Field>
      </FieldRow>
      <Field label="Première échéance" htmlFor={`${id}-start`} error={errors.start}>
        <TextInput id={`${id}-start`} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </Field>
      <Checkbox label="Créer aussi le prélèvement mensuel" checked={withRecurrence} onChange={(e) => setWithRecurrence(e.target.checked)} />
      <FieldRow>
        <Field
          label={full ? "Catégorie" : "Catégorie du prélèvement"}
          htmlFor={`${id}-cat`}
          hidden={!showLinks}
          hint={full ? "Pour les versements et le prélèvement" : undefined}
        >
          <Select id={`${id}-cat`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{full ? "Aucune pour l'instant" : "Choisir une catégorie"}</option>
            <DebtCategoryOptions data={data} direction={direction} />
          </Select>
        </Field>
        <Field label={lent ? "Compte crédité" : "Compte débité"} htmlFor={`${id}-acc`} hidden={!showLinks} error={errors.recurrence}>
          <Select id={`${id}-acc`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {full && <option value="">Aucun pour l'instant</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </FieldRow>
      {errors.recurrence && !showLinks && <p role="alert">{errors.recurrence}</p>}
    </>
  );

  return { fields, submit };
}
