import {
  asOfForYear,
  centsToInput,
  colorFor,
  createDebtRecurrence,
  dayOfMonthOf,
  deleteDebt,
  debtRecurrences,
  debtSchedule,
  debtsByState,
  debtsOverview,
  debtView,
  indexOf,
  isValidDay,
  monthOf,
  parseAmount,
  recordDebtPayment,
  removeDebtRecurrence,
  touch,
  type Cents,
  type Changes,
  type Dataset,
  type Debt,
  type DebtView,
  type Recurrence,
} from "@cashmyr/core";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { ConfirmDelete } from "../components/ConfirmDelete";
import {
  AmountInput,
  Button,
  Checkbox,
  cx,
  Field,
  FieldRow,
  IconButton,
  Segmented,
  Select,
  submitOnEnter,
  TextInput,
} from "../components/controls";
import { Gauge, SegmentedBar } from "../components/figures";
import { ArchiveIcon, CheckIcon, EyeIcon, EyeOffIcon, PinIcon, RepeatIcon, RestoreIcon } from "../components/icons";
import { Card, ScreenTitle, SectionTitle, Stack } from "../components/layout";
import { debtSentence } from "../lib/debt-text";
import { liveAccounts } from "../lib/data";
import { dayLong, money, monthLong, monthShort, ofMonth, ratio } from "../lib/format";
import { useActions, useApp } from "../store/context";
import { DebtCategoryOptions, DIRECTION_LABELS, useDebtForm, type Direction } from "./DebtForm";
import s from "./DebtsScreen.module.css";

const hasLinkedOperations = (data: Dataset, debtId: string) => indexOf(data).liveOps.some((op) => op.debtId === debtId);

/** Prélèvement vivant d'une dette, s'il existe. */
function liveRecurrence(data: Dataset, debt: Debt): Recurrence | undefined {
  const rec = debt.recurrenceId ? indexOf(data).recurrences.get(debt.recurrenceId) : undefined;
  return rec && rec.deletedAt === null ? rec : undefined;
}

/** Suppression : la dette et ses prélèvements (décision 29) ; les opérations générées restent. */
function DeleteDebt({ debt, label }: { debt: Debt; label: string }) {
  const data = useApp((st) => st.data);
  const { apply } = useActions();
  const debits = debtRecurrences(data, debt.id).length > 0;
  return (
    <ConfirmDelete
      label={label}
      detail={
        debits
          ? "Son prélèvement mensuel s'arrête aussi ; les opérations déjà passées restent dans le budget."
          : "Les opérations rattachées restent dans le budget."
      }
      onConfirm={() => apply(deleteDebt(data, debt.id, Date.now()), undefined, "Dette supprimée")}
    />
  );
}

// ── Bandeau ────────────────────────────────────────────────────────────────

function Banner({ asOf, today }: { asOf: string; today: string }) {
  const data = useApp((st) => st.data);
  const o = useMemo(() => debtsOverview(data, asOf, today), [data, asOf, today]);
  const prefs = data.preferences;
  const segments = o.byDebt.map(({ debt, remaining }) => ({
    key: debt.id,
    label: debt.name,
    value: remaining,
    color: colorFor(prefs, { kind: "series", color: debt.color }),
  }));

  let load;
  if (o.monthlyLoad === 0) load = <p>Aucune échéance mensuelle en cours.</p>;
  else if (o.loadRatio !== null && o.averageIncome !== null) {
    load = (
      <p>
        Charge mensuelle : <strong>{money(o.monthlyLoad)}</strong>, soit <strong>{ratio(o.loadRatio)}</strong> du revenu moyen des{" "}
        {prefs.averageWindow} derniers mois ({money(o.averageIncome)}).
      </p>
    );
  } else {
    load = (
      <p>
        Charge mensuelle : <strong>{money(o.monthlyLoad)}</strong>. Pas encore de revenu moyen pour la comparer.
      </p>
    );
  }

  return (
    <section className={s.banner} aria-labelledby="debts-banner-title">
      <p className={s.eyebrow} id="debts-banner-title">
        {asOf === today ? "Reste à rembourser aujourd'hui" : `Reste à rembourser au ${dayLong(asOf)}`}
      </p>
      <p className={s.big}>{money(o.totalOwed)}</p>
      <SegmentedBar label="Reste par dette" segments={segments} />
      <div className={s.lines}>{load}</div>
    </section>
  );
}

// ── Échéancier ─────────────────────────────────────────────────────────────

/**
 * Une case par échéance ; les échéances couvertes par le montant réglé sont pleines.
 * Au-delà de 60 échéances, les cases deviendraient illisibles : une barre continue.
 */
function ScheduleBar({ view, color }: { view: DebtView; color: string }) {
  const n = view.schedule.length;
  const first = view.schedule[0];
  const last = view.schedule[n - 1];
  if (!first || !last) return null;
  const covered = view.covered ?? 0;
  const amount = money(view.debt.installmentAmount);
  const label =
    n === 1
      ? `Échéancier : 1 échéance de ${amount}, le ${dayLong(first)}`
      : `Échéancier : ${n} échéances de ${amount}, du ${dayLong(first)} au ${dayLong(last)}`;
  const dense = n > 60;
  return (
    <div className={s.schedule}>
      <div className={cx(s.slots, n > 24 && s.tight, dense && s.dense)} role="img" aria-label={label} style={{ ["--c" as string]: color }}>
        {dense ? (
          <div className={s.denseFill} style={{ width: `${(covered / n) * 100}%` }} />
        ) : (
          view.schedule.map((day, i) => <span key={day + i} className={cx(s.slot, i < covered && s.filled)} />)
        )}
      </div>
      <div className={s.scheduleEnds} aria-hidden="true">
        <span>{monthShort(monthOf(first))}</span>
        {n > 1 && <span>{monthShort(monthOf(last))}</span>}
      </div>
    </div>
  );
}

// ── Versement ponctuel ─────────────────────────────────────────────────────

function PaymentBox({ debt, remaining }: { debt: Debt; remaining: Cents }) {
  const data = useApp((st) => st.data);
  const today = useApp((st) => st.today);
  const { apply } = useActions();
  const id = useId();
  const lent = debt.direction === "lent";
  const accounts = liveAccounts(data);
  const [amount, setAmount] = useState<Cents | null>(null);
  const [date, setDate] = useState(today);
  const [inBudget, setInBudget] = useState(true);
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState(accounts.find((a) => a.role === "courant")?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  // Décision 26 : sans catégorie ou sans compte sur la dette, le versement les demande.
  const askCategory = inBudget && debt.categoryId === null;
  const askAccount = inBudget && debt.accountId === null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (amount === null || amount <= 0) return setError("Indique un montant positif.");
    if (inBudget && !isValidDay(date)) return setError("Date invalide.");
    let changes: Changes;
    try {
      changes = recordDebtPayment(
        data,
        debt.id,
        {
          amount,
          date,
          inBudget,
          ...(askCategory && categoryId ? { categoryId } : {}),
          ...(askAccount && accountId ? { accountId } : {}),
        },
        Date.now(),
      );
    } catch (err) {
      return setError((err as Error).message);
    }
    setError(null);
    const message = inBudget
      ? lent
        ? "Remboursement enregistré dans le budget"
        : "Versement enregistré dans le budget"
      : lent
        ? "Remboursement enregistré hors budget"
        : "Versement enregistré hors budget";
    if (await apply(changes, undefined, message)) {
      setAmount(null);
      setDate(today);
      setKey((k) => k + 1);
    }
  };

  const title = lent ? "Remboursement reçu" : "Versement ponctuel";
  return (
    <form className={s.payment} onSubmit={submit} onKeyDown={submitOnEnter} aria-labelledby={`${id}-title`} noValidate>
      <p className={s.paymentTitle} id={`${id}-title`}>
        {title}
      </p>
      <div className={s.paymentGrid}>
        <Field
          label="Montant"
          htmlFor={`${id}-amount`}
          hint={amount !== null && remaining > 0 && amount > remaining ? `Plus que le reste dû (${money(remaining)}).` : undefined}
        >
          <AmountInput key={key} id={`${id}-amount`} placeholder="0,00" onAmount={(c) => setAmount(c)} />
        </Field>
        <Field label="Date" htmlFor={`${id}-date`} hidden={!inBudget}>
          <TextInput id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {askCategory && (
          <Field label="Catégorie" htmlFor={`${id}-cat`} hint="Retenue pour les prochains versements">
            <Select id={`${id}-cat`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="" disabled>
                Choisir une catégorie
              </option>
              <DebtCategoryOptions data={data} direction={debt.direction} />
            </Select>
          </Field>
        )}
        {askAccount && (
          <Field label={lent ? "Compte crédité" : "Compte débité"} htmlFor={`${id}-acc`} hint="Retenu pour les prochains versements">
            <Select id={`${id}-acc`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
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
        )}
        <Button className={s.payButton} type="submit" disabled={amount === null || amount <= 0}>
          Enregistrer
        </Button>
        <Checkbox
          className={s.payFull}
          label="Créer aussi l'opération dans mon budget"
          checked={inBudget}
          onChange={(e) => setInBudget(e.target.checked)}
        />
        {!inBudget && (
          <p className={cx(s.muted, s.payFull)}>
            Sans opération, le montant s'ajoute simplement au déjà {lent ? "remboursé" : "réglé"} : pour un paiement en espèces ou
            déjà saisi ailleurs.
          </p>
        )}
        {error && (
          <p className={cx(s.error, s.payFull)} role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

// ── Prélèvement automatique ────────────────────────────────────────────────

function AutoDebit({ debt, view }: { debt: Debt; view: DebtView }) {
  const data = useApp((st) => st.data);
  const today = useApp((st) => st.today);
  const { apply, toast } = useActions();
  const rec = liveRecurrence(data, debt);
  const lent = debt.direction === "lent";
  const noun = lent ? "remboursement mensuel" : "prélèvement mensuel";
  if (debt.mode !== "installments" && !rec) return null;

  const create = async (message: string) => {
    let changes: Changes;
    try {
      changes = createDebtRecurrence(data, debt.id, today, Date.now());
    } catch (err) {
      toast((err as Error).message, "error");
      return;
    }
    // Une mise à jour ne relance pas un prélèvement mis en pause.
    if (rec && !rec.active && changes.recurrences) {
      changes = { ...changes, recurrences: changes.recurrences.map((r) => ({ ...r, active: false })) };
    }
    await apply(changes, undefined, message);
  };

  if (rec) {
    const schedule = debtSchedule(debt);
    const lastInstallment = schedule[schedule.length - 1];
    const stale =
      debt.mode === "installments" &&
      !debt.settled &&
      view.next !== null &&
      (rec.amount !== debt.installmentAmount ||
        rec.dayOfMonth !== debt.dayOfMonth ||
        rec.type !== (lent ? "in" : "out") ||
        (debt.categoryId !== null && rec.categoryId !== debt.categoryId) ||
        (debt.accountId !== null && rec.accountId !== debt.accountId) ||
        (lastInstallment !== undefined && rec.endMonth !== monthOf(lastInstallment)));
    const span = rec.endMonth ? `${ofMonth(rec.startMonth)} à ${monthLong(rec.endMonth)}` : `depuis ${monthLong(rec.startMonth)}`;
    return (
      <div className={s.debit}>
        <p className={s.debitText}>
          <RepeatIcon size={16} />
          <span>
            {lent ? "Remboursement mensuel automatique" : "Prélèvement mensuel"} : {money(rec.amount)} le {rec.dayOfMonth} de chaque mois,{" "}
            {span}
            {rec.active ? "" : " · en pause"}. Chaque occurrence suit l'échéancier restant.
          </span>
        </p>
        {stale && (
          <p className={s.muted}>Les réglages de la dette ont changé depuis la création du {noun}.</p>
        )}
        <div className={s.debitTools}>
          {stale && (
            <Button size="small" onClick={() => create(lent ? "Remboursement mensuel mis à jour" : "Prélèvement mis à jour")}>
              Mettre à jour le {noun}
            </Button>
          )}
          <Button
            size="small"
            variant="ghost"
            onClick={() =>
              apply(removeDebtRecurrence(data, debt.id, Date.now()), undefined, lent ? "Remboursement mensuel retiré" : "Prélèvement retiré")
            }
          >
            Retirer le {noun}
          </Button>
        </div>
        <p className={s.muted}>Le retirer ne touche pas aux opérations déjà générées.</p>
      </div>
    );
  }

  if (debt.settled || view.next === null) return null;
  const missing = debt.categoryId === null || debt.accountId === null;
  return (
    <div className={s.debit}>
      <div className={s.debitTools}>
        <Button size="small" disabled={missing} onClick={() => create(lent ? "Remboursement mensuel créé" : "Prélèvement créé")}>
          <RepeatIcon size={16} />
          Créer le {noun}
        </Button>
      </div>
      <p className={s.muted}>
        {missing
          ? "Renseigne d'abord la catégorie et le compte de la dette, dans « Modifier la dette »."
          : `${money(debt.installmentAmount)} le ${debt.dayOfMonth} de chaque mois, ${ofMonth(monthOf(view.next.date))} à la dernière échéance. Les opérations apparaîtront dans le budget le jour venu.`}
      </p>
    </div>
  );
}

// ── Configuration ──────────────────────────────────────────────────────────

type Draft = {
  name: string;
  creditor: string;
  direction: Direction;
  principal: string;
  paidManual: string;
  mode: Debt["mode"];
  installmentAmount: string;
  installmentCount: string;
  startDate: string;
  dayOfMonth: number;
  categoryId: string;
  accountId: string;
};

const toDraft = (d: Debt): Draft => ({
  name: d.name,
  creditor: d.creditor,
  direction: d.direction,
  principal: d.principal > 0 ? centsToInput(d.principal) : "",
  paidManual: centsToInput(d.paidManual),
  mode: d.mode,
  installmentAmount: d.installmentAmount > 0 ? centsToInput(d.installmentAmount) : "",
  installmentCount: d.installmentCount > 0 ? String(d.installmentCount) : "",
  startDate: d.startDate,
  dayOfMonth: d.dayOfMonth,
  categoryId: d.categoryId ?? "",
  accountId: d.accountId ?? "",
});

const optionalAmount = (text: string): Cents | null => (text.trim() === "" ? 0 : parseAmount(text));

/** Valide un brouillon ; renvoie les erreurs par champ, ou le correctif à écrire. */
function readDraft(draft: Draft, debt: Debt): { errors: Record<string, string>; patch?: Partial<Debt> } {
  const errors: Record<string, string> = {};
  const principal = optionalAmount(draft.principal);
  const paidManual = optionalAmount(draft.paidManual);
  if (!draft.name.trim()) errors.name = "Donne un intitulé à la dette.";
  if (principal === null) errors.principal = "Montant invalide.";
  if (paidManual === null) errors.paidManual = "Montant invalide.";

  let schedule: Pick<Debt, "installmentAmount" | "installmentCount" | "startDate" | "dayOfMonth"> = {
    installmentAmount: debt.installmentAmount,
    installmentCount: debt.installmentCount,
    startDate: debt.startDate,
    dayOfMonth: debt.dayOfMonth,
  };
  if (draft.mode === "installments") {
    const amount = parseAmount(draft.installmentAmount);
    const count = Number(draft.installmentCount);
    if (amount === null || amount <= 0) errors.installmentAmount = "Indique le montant d'une échéance.";
    if (draft.installmentCount.trim() === "" || !Number.isInteger(count) || count < 1 || count > 1200) {
      errors.installmentCount = "Entre 1 et 1 200 échéances.";
    }
    if (!isValidDay(draft.startDate)) errors.startDate = "Date invalide.";
    if (!errors.installmentAmount && !errors.installmentCount && principal !== null && principal > amount! * count) {
      errors.principal = "Le total dépasse ce que couvrent les échéances.";
    }
    schedule = { installmentAmount: amount ?? 0, installmentCount: count, startDate: draft.startDate, dayOfMonth: draft.dayOfMonth };
  } else if (principal !== null && principal <= 0) {
    errors.principal = "Sans échéancier, le montant total est indispensable.";
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    patch: {
      name: draft.name.trim(),
      creditor: draft.creditor.trim(),
      direction: draft.direction,
      principal: principal!,
      paidManual: paidManual!,
      mode: draft.mode,
      ...schedule,
      categoryId: draft.categoryId || null,
      accountId: draft.accountId || null,
    },
  };
}

function DebtSettings({ debt }: { debt: Debt }) {
  const data = useApp((st) => st.data);
  const { apply } = useActions();
  const id = useId();
  const accounts = liveAccounts(data);
  const current = toDraft(debt);
  const currentKey = JSON.stringify(current);
  const [draft, setDraft] = useState(current);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const base = useRef(currentKey);
  const lent = draft.direction === "lent";
  const rec = liveRecurrence(data, debt);
  const directionLocked = rec !== undefined || hasLinkedOperations(data, debt.id);
  const dirty = JSON.stringify(draft) !== currentKey;

  // Modifiée ailleurs (autre carte, synchronisation) : on suit, sauf saisie en cours.
  useEffect(() => {
    setDraft((d) => (JSON.stringify(d) === base.current ? (JSON.parse(currentKey) as Draft) : d));
    base.current = currentKey;
  }, [currentKey]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const { errors: found, patch } = readDraft(draft, debt);
    setErrors(found);
    if (!patch) return;
    // Le brouillon repart de la version enregistrée, au format d'affichage (« 300,00 »).
    if (await apply({ debts: [touch(debt, patch, Date.now())] }, undefined, "Dette mise à jour")) setDraft(toDraft({ ...debt, ...patch }));
  };

  return (
    <details className={s.settings}>
      <summary>Modifier la dette</summary>
      <form className={s.settingsBody} onSubmit={save} onKeyDown={submitOnEnter} noValidate>
        <FieldRow>
          <Field label="Intitulé" htmlFor={`${id}-name`} error={errors.name}>
            <TextInput id={`${id}-name`} value={draft.name} onChange={(e) => set("name", e.target.value)} autoComplete="off" />
          </Field>
          <Field label={lent ? "Personne ou organisme qui doit" : "Organisme ou personne"} htmlFor={`${id}-creditor`}>
            <TextInput id={`${id}-creditor`} value={draft.creditor} onChange={(e) => set("creditor", e.target.value)} autoComplete="off" />
          </Field>
        </FieldRow>

        <Field
          label="Sens"
          htmlFor={`${id}-dir`}
          hint={directionLocked ? "Des opérations ou un prélèvement y sont rattachés : le sens ne change plus." : undefined}
        >
          {directionLocked ? (
            <p id={`${id}-dir`}>{DIRECTION_LABELS[draft.direction]}</p>
          ) : (
            <Segmented
              label="Sens de la dette"
              value={draft.direction}
              options={[
                { value: "owe", label: DIRECTION_LABELS.owe },
                { value: "lent", label: DIRECTION_LABELS.lent },
              ]}
              onChange={(direction) => {
                const category = draft.categoryId ? indexOf(data).categories.get(draft.categoryId) : undefined;
                const fits = category?.kind === (direction === "owe" ? "out" : "in");
                setDraft((d) => ({ ...d, direction, categoryId: fits ? d.categoryId : "" }));
              }}
            />
          )}
        </Field>

        <FieldRow>
          <Field label="Montant total" htmlFor={`${id}-principal`} hint="Vide : calculé depuis les échéances" error={errors.principal}>
            <TextInput id={`${id}-principal`} inputMode="decimal" value={draft.principal} onChange={(e) => set("principal", e.target.value)} autoComplete="off" />
          </Field>
          <Field
            label={lent ? "Déjà remboursé hors application" : "Déjà réglé hors application"}
            htmlFor={`${id}-paid`}
            hint="Pour rattraper l'historique d'une dette entamée avant l'application"
            error={errors.paidManual}
          >
            <TextInput id={`${id}-paid`} inputMode="decimal" value={draft.paidManual} onChange={(e) => set("paidManual", e.target.value)} autoComplete="off" />
          </Field>
        </FieldRow>

        <Field label="Remboursement" htmlFor={`${id}-mode`}>
          <Segmented
            label="Mode de remboursement"
            value={draft.mode}
            options={[
              { value: "installments", label: "Échéancier" },
              { value: "free", label: "Libre" },
            ]}
            onChange={(mode) => set("mode", mode)}
          />
        </Field>
        <div className={s.scheduleFields} hidden={draft.mode !== "installments"}>
          <FieldRow>
            <Field label="Montant par échéance" htmlFor={`${id}-inst`} error={errors.installmentAmount}>
              <TextInput id={`${id}-inst`} inputMode="decimal" value={draft.installmentAmount} onChange={(e) => set("installmentAmount", e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Nombre d'échéances" htmlFor={`${id}-count`} error={errors.installmentCount}>
              <TextInput id={`${id}-count`} inputMode="numeric" value={draft.installmentCount} onChange={(e) => set("installmentCount", e.target.value)} autoComplete="off" />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Première échéance" htmlFor={`${id}-start`} error={errors.startDate}>
              <TextInput
                id={`${id}-start`}
                type="date"
                value={draft.startDate}
                onChange={(e) => {
                  const startDate = e.target.value;
                  setDraft((d) => ({ ...d, startDate, dayOfMonth: isValidDay(startDate) ? dayOfMonthOf(startDate) : d.dayOfMonth }));
                }}
              />
            </Field>
            <Field label="Jour des échéances" htmlFor={`${id}-day`} hint="Ramené au dernier jour des mois courts">
              <Select id={`${id}-day`} value={draft.dayOfMonth} onChange={(e) => set("dayOfMonth", Number(e.target.value))}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    le {d}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
        </div>

        <FieldRow>
          <Field label="Catégorie" htmlFor={`${id}-cat`} hint="Pour les versements et le prélèvement">
            <Select id={`${id}-cat`} value={draft.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              <option value="">Aucune</option>
              <DebtCategoryOptions data={data} direction={draft.direction} />
            </Select>
          </Field>
          <Field label={lent ? "Compte crédité" : "Compte débité"} htmlFor={`${id}-acc`}>
            <Select id={`${id}-acc`} value={draft.accountId} onChange={(e) => set("accountId", e.target.value)}>
              <option value="">Aucun</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>

        <div className={s.formActions}>
          <Button type="submit" variant="primary" disabled={!dirty}>
            Enregistrer les modifications
          </Button>
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(current);
                setErrors({});
              }}
            >
              Annuler
            </Button>
          )}
        </div>

        <div className={s.alignStart}>
          <DeleteDebt debt={debt} label="Supprimer la dette" />
        </div>
      </form>
    </details>
  );
}

// ── Carte ──────────────────────────────────────────────────────────────────

function DebtCard({ debt, asOf }: { debt: Debt; asOf: string }) {
  const data = useApp((st) => st.data);
  const today = useApp((st) => st.today);
  const { apply } = useActions();
  const view = useMemo(() => debtView(data, debt, asOf, today), [data, debt, asOf, today]);
  const save = (patch: Partial<Debt>, message?: string) => apply({ debts: [touch(debt, patch, Date.now())] }, undefined, message);
  const color = colorFor(data.preferences, { kind: "series", color: debt.color });
  const lent = debt.direction === "lent";
  const paid = Math.max(0, view.paid);
  const settle = () => save({ settled: true, settledAt: today }, "Dette marquée soldée");

  const subtitle = [
    DIRECTION_LABELS[debt.direction],
    debt.creditor,
    debt.settled ? `soldée${debt.settledAt ? ` le ${dayLong(debt.settledAt)}` : ""}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card
      as="article"
      title={debt.name}
      subtitle={subtitle}
      actions={
        <>
          <IconButton label={debt.hidden ? "Afficher au tableau de bord" : "Masquer du tableau de bord"} aria-pressed={debt.hidden} onClick={() => save({ hidden: !debt.hidden })}>
            {debt.hidden ? <EyeOffIcon /> : <EyeIcon />}
          </IconButton>
          <IconButton label={debt.pinned ? "Désépingler" : "Épingler en tête"} aria-pressed={debt.pinned} onClick={() => save({ pinned: !debt.pinned })}>
            <PinIcon filled={debt.pinned} />
          </IconButton>
          <IconButton
            label={debt.settled ? "Ne plus marquer soldée" : "Marquer soldée"}
            aria-pressed={debt.settled}
            onClick={() => (debt.settled ? save({ settled: false, settledAt: null }) : settle())}
          >
            <CheckIcon />
          </IconButton>
          <IconButton label="Archiver" onClick={() => save({ archived: true }, "Dette archivée")}>
            <ArchiveIcon />
          </IconButton>
        </>
      }
    >
      <Gauge
        label={lent ? "Remboursé" : "Réglé"}
        color={color}
        value={view.paid}
        target={view.total > 0 ? view.total : null}
        caption={
          view.total > 0
            ? `${money(paid)} ${lent ? "remboursés" : "réglés"} sur ${money(view.total)} · ${ratio(paid / view.total)}`
            : "Montant total non renseigné"
        }
      />
      <ScheduleBar view={view} color={color} />
      <p className={cx(s.sentence, view.next?.status === "overdue" && s.overdue)}>{debtSentence(view, today)}</p>
      {view.suggestSettled && view.total > 0 && (
        <div className={s.suggest}>
          <span>{lent ? "Tout a été remboursé." : "Le reste dû est nul."}</span>
          <Button size="small" onClick={settle}>
            Marquer soldée
          </Button>
        </div>
      )}
      {!debt.settled && <PaymentBox debt={debt} remaining={view.remaining} />}
      <AutoDebit debt={debt} view={view} />
      <DebtSettings debt={debt} />
    </Card>
  );
}

// ── Création et archives ───────────────────────────────────────────────────

function NewDebtForm({ first, onCreated }: { first: boolean; onCreated(): void }) {
  const form = useDebtForm({ full: true, onCreated });
  return (
    <Card title="Nouvelle dette" subtitle={first ? "Aucune dette en cours : ajoute la première ici." : undefined} tone="muted">
      <form className={s.newDebt} onSubmit={form.submit} onKeyDown={submitOnEnter} noValidate>
        {form.fields}
        <div className={s.alignStart}>
          <Button type="submit" variant="primary">
            Créer la dette
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ArchivedDebts({ debts }: { debts: Debt[] }) {
  const { apply } = useActions();
  return (
    <ul className={s.archive}>
      {debts.map((d) => (
        <li key={d.id}>
          <span className={s.archiveName}>{d.name}</span>
          <span className={s.muted}>{DIRECTION_LABELS[d.direction]}</span>
          <span className={s.archiveTools}>
            <Button size="small" variant="ghost" onClick={() => apply({ debts: [touch(d, { archived: false }, Date.now())] }, undefined, "Dette restaurée")}>
              <RestoreIcon size={16} />
              Restaurer
            </Button>
            <DeleteDebt debt={d} label="Supprimer" />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DebtsScreen() {
  const data = useApp((st) => st.data);
  const year = useApp((st) => st.year);
  const today = useApp((st) => st.today);
  const asOf = asOfForYear(year, today);
  const { active, settled, archived } = useMemo(() => debtsByState(data), [data]);
  const [formKey, setFormKey] = useState(0);
  const any = active.length + settled.length > 0;

  return (
    <Stack gap={18}>
      <ScreenTitle title="Dettes">{asOf !== today && <p className={s.muted}>Situation au {dayLong(asOf)}</p>}</ScreenTitle>
      {any && <Banner asOf={asOf} today={today} />}
      {active.map((d) => (
        <DebtCard key={d.id} debt={d} asOf={asOf} />
      ))}
      <NewDebtForm key={formKey} first={active.length === 0} onCreated={() => setFormKey((k) => k + 1)} />
      {settled.length > 0 && (
        <>
          <SectionTitle>Dettes soldées</SectionTitle>
          {settled.map((d) => (
            <DebtCard key={d.id} debt={d} asOf={asOf} />
          ))}
        </>
      )}
      {archived.length > 0 && (
        <>
          <SectionTitle>Archives</SectionTitle>
          <ArchivedDebts debts={archived} />
        </>
      )}
    </Stack>
  );
}
