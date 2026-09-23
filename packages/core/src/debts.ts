import { debtSchedule, debtView } from "./calc/debts";
import { indexOf } from "./dataset";
import { monthOf } from "./dates";
import { derivedId, newId } from "./ids";
import type { Cents, Changes, Dataset, Day, Debt, Operation, Recurrence } from "./model";
import { createRecord, revive, tombstone, touch } from "./records";

export class DebtActionError extends Error {
  override name = "DebtActionError";
}

/** Identifiant du prélèvement d'une dette : deux appareils qui le créent en même temps n'en font qu'un. */
export const debtRecurrenceId = (debtId: string): string => derivedId("debt-recurrence", debtId);

function liveDebt(data: Dataset, debtId: string): Debt {
  const debt = indexOf(data).debts.get(debtId);
  if (!debt || debt.deletedAt !== null) throw new DebtActionError("Dette introuvable.");
  return debt;
}

export type DebtPayment = {
  amount: Cents;
  date: Day;
  /** Case « Créer aussi l'opération dans mon budget ». */
  inBudget: boolean;
  /** À fournir si la dette n'a pas de catégorie ou de compte ; le choix est alors enregistré sur la dette. */
  categoryId?: string;
  accountId?: string;
};

/**
 * Versement ponctuel (ou remboursement reçu).
 * Dans le budget : une vraie opération, dépense pour « je dois », revenu pour « on me doit »,
 * rattachée à la dette, avec sa catégorie et son compte.
 * Hors budget : `paidManual` augmente, aucune opération n'est créée.
 */
export function recordDebtPayment(
  data: Dataset,
  debtId: string,
  payment: DebtPayment,
  now: number,
  id: string = newId(),
): Changes {
  const debt = liveDebt(data, debtId);
  if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0) {
    throw new DebtActionError("Le montant doit être positif.");
  }
  if (!payment.inBudget) {
    return { debts: [touch(debt, { paidManual: debt.paidManual + payment.amount }, now)] };
  }
  const categoryId = payment.categoryId ?? debt.categoryId;
  const accountId = payment.accountId ?? debt.accountId;
  if (!categoryId || !accountId) {
    throw new DebtActionError("Choisis une catégorie et un compte pour créer l'opération.");
  }
  const op = createRecord<Operation>(
    id,
    {
      date: payment.date,
      amount: payment.amount,
      type: debt.direction === "owe" ? "out" : "in",
      note: `Versement — ${debt.name}`,
      categoryId,
      accountId,
      debtId: debt.id,
    },
    now,
  );
  const changes: Changes = { operations: [op] };
  // Une dette sans catégorie ou sans compte retient le choix fait ici.
  if (debt.categoryId === null || debt.accountId === null) {
    changes.debts = [
      touch(debt, { categoryId: debt.categoryId ?? categoryId, accountId: debt.accountId ?? accountId }, now),
    ];
  }
  return changes;
}

/**
 * Prélèvement automatique : une récurrence du montant de l'échéance, avec la catégorie
 * et le compte de la dette, du mois de la prochaine échéance au mois de la dernière.
 */
export function createDebtRecurrence(data: Dataset, debtId: string, today: Day, now: number): Changes {
  const debt = liveDebt(data, debtId);
  if (debt.mode !== "installments") throw new DebtActionError("Le prélèvement suppose un échéancier.");
  if (!debt.categoryId || !debt.accountId) {
    throw new DebtActionError("Renseigne la catégorie et le compte de la dette d'abord.");
  }
  const view = debtView(data, debt, today, today);
  if (!view.next) throw new DebtActionError("Il ne reste rien à régler.");
  const schedule = debtSchedule(debt);
  const id = debtRecurrenceId(debt.id);
  const fields: Omit<Recurrence, "id" | "updatedAt" | "deletedAt"> = {
    label: `Échéance — ${debt.name}`,
    amount: debt.installmentAmount,
    type: debt.direction === "owe" ? "out" : "in",
    categoryId: debt.categoryId,
    accountId: debt.accountId,
    debtId: debt.id,
    dayOfMonth: debt.dayOfMonth,
    startMonth: monthOf(view.next.date),
    endMonth: monthOf(schedule[schedule.length - 1]!),
    active: true,
  };
  const existing = indexOf(data).recurrences.get(id);
  const rec = existing
    ? revive({ id, updatedAt: existing.updatedAt, deletedAt: existing.deletedAt, ...fields }, {}, now)
    : createRecord<Recurrence>(id, fields, now);
  return { recurrences: [rec], debts: [touch(debt, { recurrenceId: id }, now)] };
}

/** Retire le prélèvement sans toucher aux opérations déjà générées. */
export function removeDebtRecurrence(data: Dataset, debtId: string, now: number): Changes {
  const debt = liveDebt(data, debtId);
  const changes: Changes = { debts: [touch(debt, { recurrenceId: null }, now)] };
  const rec = debt.recurrenceId ? indexOf(data).recurrences.get(debt.recurrenceId) : undefined;
  if (rec && rec.deletedAt === null) changes.recurrences = [tombstone(rec, now)];
  return changes;
}

/** Prélèvements vivants d'une dette : celui créé depuis la fiche et toute récurrence qui porte son `debtId`. */
export function debtRecurrences(data: Dataset, debtId: string): Recurrence[] {
  const debt = indexOf(data).debts.get(debtId);
  return data.collections.recurrences.filter(
    (r) => r.deletedAt === null && (r.debtId === debtId || (debt !== undefined && r.id === debt.recurrenceId)),
  );
}

/**
 * Suppression d'une dette : ses prélèvements s'arrêtent avec elle (décision 29).
 * Les opérations déjà générées restent dans le budget, rattachées à la dette supprimée.
 */
export function deleteDebt(data: Dataset, debtId: string, now: number): Changes {
  const debt = liveDebt(data, debtId);
  const changes: Changes = { debts: [tombstone(debt, now)] };
  const recurrences = debtRecurrences(data, debtId);
  if (recurrences.length > 0) changes.recurrences = recurrences.map((r) => tombstone(r, now));
  return changes;
}
