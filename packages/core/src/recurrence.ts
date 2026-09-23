import { applyChanges, indexOf } from "./dataset";
import { addMonths, clampedDay, maxMonth, minMonth, monthIndex, monthOf, monthRange } from "./dates";
import { debtPaid, debtTotal, remainingInstallments } from "./calc/debts";
import { occurrenceId, skipId } from "./ids";
import type { Cents, Changes, Dataset, Day, Month, Operation, Recurrence, Skip } from "./model";
import { createRecord, revive, tombstone, touch } from "./records";

/** Date de l'occurrence d'un mois, rabattue sur le dernier jour des mois courts. */
export const occurrenceDate = (rec: Recurrence, month: Month): Day => clampedDay(month, rec.dayOfMonth);

const inRange = (rec: Recurrence, month: Month) =>
  month >= rec.startMonth && (rec.endMonth === null || month <= rec.endMonth);

type OccurrenceFields = Omit<Operation, "id" | "updatedAt" | "deletedAt">;

/** Champs de l'opération générée, repris de la récurrence telle qu'elle est aujourd'hui. */
function occurrenceFields(rec: Recurrence, month: Month, amount: Cents): OccurrenceFields {
  const fields: OccurrenceFields = {
    date: occurrenceDate(rec, month),
    amount,
    type: rec.type,
    note: rec.label,
    recurrenceId: rec.id,
  };
  if (rec.type === "tx") {
    if (rec.fromAccountId) fields.fromAccountId = rec.fromAccountId;
    if (rec.toAccountId) fields.toAccountId = rec.toAccountId;
  } else {
    if (rec.categoryId) fields.categoryId = rec.categoryId;
    if (rec.accountId) fields.accountId = rec.accountId;
  }
  if (rec.goalId) fields.goalId = rec.goalId;
  if (rec.debtId) fields.debtId = rec.debtId;
  return fields;
}

/**
 * Montant de l'occurrence d'un mois, ou null si elle ne doit pas exister.
 * Récurrence ordinaire : son montant.
 * Récurrence liée à une dette vivante :
 * - dette soldée ou reste nul : rien ;
 * - mode échéances : seulement si l'échéancier restant, calculé avec les opérations
 *   datées jusqu'au jour de l'occurrence, prévoit une échéance ce mois-là, et au plus
 *   le montant de cette échéance (la dernière peut être réduite) ;
 * - mode libre : plafonnée au reste dû.
 * `extra` : occurrences déjà décidées dans le même passage, pas encore écrites.
 */
export function occurrenceAmount(
  data: Dataset,
  rec: Recurrence,
  month: Month,
  extra: readonly Operation[] = [],
): Cents | null {
  if (!rec.debtId) return rec.amount;
  const debt = indexOf(data).debts.get(rec.debtId);
  if (!debt || debt.deletedAt !== null) return rec.amount;
  if (debt.settled) return null;
  const date = occurrenceDate(rec, month);
  const remaining = debtTotal(debt) - debtPaid(data, debt, date, extra);
  if (remaining <= 0) return null;
  if (debt.mode === "free" || debt.installmentAmount <= 0 || debt.installmentCount <= 0) {
    return Math.min(rec.amount, remaining);
  }
  const due = remainingInstallments(debt, remaining).find((i) => monthOf(i.date) === month);
  return due ? Math.min(rec.amount, due.amount) : null;
}

/** Vrai si le couple (mois, récurrence) porte une annulation vivante. */
export function isSkipped(data: Dataset, recurrenceId: string, month: Month): boolean {
  return data.collections.skips.some(
    (s) => s.deletedAt === null && s.recurrenceId === recurrenceId && s.month === month,
  );
}

function buildOccurrence(data: Dataset, rec: Recurrence, month: Month, amount: Cents, now: number): Operation {
  const id = occurrenceId(rec.id, month);
  const existing = indexOf(data).operations.get(id);
  const fields = occurrenceFields(rec, month, amount);
  if (existing) {
    // Régénérée depuis la récurrence actuelle : rien de l'ancienne version ne subsiste.
    const reset: Operation = { id, updatedAt: existing.updatedAt, deletedAt: existing.deletedAt, ...fields };
    return revive(reset, {}, now);
  }
  // Horodatée par la version de la récurrence, pas par l'heure de génération :
  // deux appareils produisent la même ligne, et toute action de l'utilisateur
  // (annulation, modification) postérieure à cette version la bat, même si
  // l'autre appareil génère plus tard.
  return createRecord<Operation>(id, fields, rec.updatedAt);
}

type Candidate = { rec: Recurrence; month: Month; date: Day };

/** Occurrences à considérer, dans l'ordre chronologique (puis par récurrence). */
function candidates(
  data: Dataset,
  months: (rec: Recurrence) => Month[],
  keep: (date: Day) => boolean,
): Candidate[] {
  const ops = indexOf(data).operations;
  const out: Candidate[] = [];
  for (const rec of data.collections.recurrences) {
    if (rec.deletedAt !== null || !rec.active) continue;
    for (const month of months(rec)) {
      const date = occurrenceDate(rec, month);
      if (!keep(date) || isSkipped(data, rec.id, month)) continue;
      const existing = ops.get(occurrenceId(rec.id, month));
      if (existing && existing.deletedAt === null) continue;
      out.push({ rec, month, date });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rec.id < b.rec.id ? -1 : 1));
}

/**
 * Déroule les candidats dans l'ordre : chaque occurrence retenue compte pour
 * les suivantes (reste dû d'une dette).
 */
function unroll(data: Dataset, list: Candidate[], now: number): { candidate: Candidate; op: Operation }[] {
  const decided: Operation[] = [];
  const out: { candidate: Candidate; op: Operation }[] = [];
  for (const c of list) {
    const amount = occurrenceAmount(data, c.rec, c.month, decided);
    if (amount === null || amount <= 0) continue;
    const op = buildOccurrence(data, c.rec, c.month, amount, now);
    decided.push(op);
    out.push({ candidate: c, op });
  }
  return out;
}

/**
 * Matérialise les occurrences manquantes, de `startMonth` jusqu'au mois en cours,
 * borné par `endMonth`. Une occurrence n'apparaît que le jour venu ; jamais pour
 * un mois futur. Strictement idempotente : ce qui existe déjà ne bouge pas.
 * Renvoie seulement les opérations à écrire.
 */
export function materializeRecurrences(data: Dataset, today: Day, now: number): Operation[] {
  const current = monthOf(today);
  const list = candidates(
    data,
    (rec) => monthRange(rec.startMonth, rec.endMonth === null ? current : minMonth(rec.endMonth, current)),
    (date) => date <= today,
  );
  return unroll(data, list, now).map((r) => r.op);
}

export type PlannedOccurrence = {
  recurrence: Recurrence;
  month: Month;
  date: Day;
  amount: Cents;
};

/**
 * Ce qui est prévu et pas encore généré : la suite du mois en cours, ou un mois
 * futur. Lecture seule. Vide pour un mois passé. Les occurrences prévues avant
 * ce mois sont supposées réglées, ce qui fixe le montant des échéances de dette.
 */
export function plannedOccurrences(data: Dataset, month: Month, today: Day): PlannedOccurrence[] {
  const current = monthOf(today);
  if (month < current) return [];
  const list = candidates(
    data,
    (rec) => {
      const from = maxMonth(rec.startMonth, current);
      const to = rec.endMonth === null ? month : minMonth(rec.endMonth, month);
      return monthRange(from, to);
    },
    (date) => date > today,
  );
  return unroll(data, list, 0)
    .filter((r) => r.candidate.month === month)
    .map((r) => ({ recurrence: r.candidate.rec, month, date: r.candidate.date, amount: r.op.amount }))
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.recurrence.label.localeCompare(b.recurrence.label, "fr"),
    );
}

function skipRecord(data: Dataset, recurrenceId: string, month: Month, now: number): Skip | null {
  if (isSkipped(data, recurrenceId, month)) return null;
  const id = skipId(recurrenceId, month);
  const existing = data.collections.skips.find((s) => s.id === id);
  if (existing) return revive(existing, { month, recurrenceId }, now);
  return createRecord<Skip>(id, { month, recurrenceId }, now);
}

/** Annule une occurrence : l'opération passe en pierre tombale et un Skip est créé. */
export function cancelOccurrence(data: Dataset, recurrenceId: string, month: Month, now: number): Changes {
  const changes: Changes = {};
  const op = indexOf(data).operations.get(occurrenceId(recurrenceId, month));
  if (op && op.deletedAt === null) changes.operations = [tombstone(op, now)];
  const skip = skipRecord(data, recurrenceId, month, now);
  if (skip) changes.skips = [skip];
  return changes;
}

/** Rétablit une occurrence : le Skip passe en pierre tombale et l'occurrence est régénérée si son jour est venu. */
export function restoreOccurrence(
  data: Dataset,
  recurrenceId: string,
  month: Month,
  today: Day,
  now: number,
): Changes {
  const changes: Changes = {};
  const skips = data.collections.skips.filter(
    (s) => s.deletedAt === null && s.recurrenceId === recurrenceId && s.month === month,
  );
  if (skips.length > 0) changes.skips = skips.map((s) => tombstone(s, now));
  const rec = indexOf(data).recurrences.get(recurrenceId);
  if (
    rec &&
    rec.deletedAt === null &&
    rec.active &&
    inRange(rec, month) &&
    occurrenceDate(rec, month) <= today
  ) {
    const existing = indexOf(data).operations.get(occurrenceId(rec.id, month));
    const amount = occurrenceAmount(data, rec, month);
    if ((!existing || existing.deletedAt !== null) && amount !== null && amount > 0) {
      changes.operations = [buildOccurrence(data, rec, month, amount, now)];
    }
  }
  return changes;
}

export function pauseRecurrence(data: Dataset, recurrenceId: string, now: number): Changes {
  const rec = indexOf(data).recurrences.get(recurrenceId);
  if (!rec || rec.deletedAt !== null || !rec.active) return {};
  return { recurrences: [touch(rec, { active: false }, now)] };
}

/**
 * Reprend une récurrence en pause. Les occurrences que la pause a empêchées ne sont
 * pas rattrapées : leurs mois sont marqués « ignorés », rétablissables un par un.
 */
export function resumeRecurrence(data: Dataset, recurrenceId: string, today: Day, now: number): Changes {
  const rec = indexOf(data).recurrences.get(recurrenceId);
  if (!rec || rec.deletedAt !== null || rec.active) return {};
  const resumed = touch(rec, { active: true }, now);
  const probe = applyChanges(data, { recurrences: [resumed] });
  const missed = materializeRecurrences(probe, today, now).filter((op) => op.recurrenceId === recurrenceId);
  const skips = missed
    .map((op) => skipRecord(probe, recurrenceId, monthOf(op.date), now))
    .filter((s): s is Skip => s !== null);
  return skips.length > 0 ? { recurrences: [resumed], skips } : { recurrences: [resumed] };
}

/** Mois dont une opération générée est l'occurrence, même si sa date a été modifiée. */
export function occurrenceMonth(data: Dataset, op: Operation): Month | null {
  if (!op.recurrenceId) return null;
  const own = monthOf(op.date);
  if (occurrenceId(op.recurrenceId, own) === op.id) return own;
  const rec = indexOf(data).recurrences.get(op.recurrenceId);
  const anchor = rec ? minMonth(rec.startMonth, own) : own;
  const from = addMonths(anchor, -24);
  const span = Math.max(monthIndex(own), monthIndex(rec?.endMonth ?? own)) + 24 - monthIndex(from);
  for (let i = 0; i <= span; i++) {
    const m = addMonths(from, i);
    if (occurrenceId(op.recurrenceId, m) === op.id) return m;
  }
  return null;
}

/**
 * Supprime une opération. Une opération générée par une récurrence vivante est
 * annulée (Skip), sinon elle réapparaîtrait au lancement suivant.
 */
export function deleteOperation(data: Dataset, operationId: string, now: number): Changes {
  const op = indexOf(data).operations.get(operationId);
  if (!op || op.deletedAt !== null) return {};
  const changes: Changes = { operations: [tombstone(op, now)] };
  const rec = op.recurrenceId ? indexOf(data).recurrences.get(op.recurrenceId) : undefined;
  if (rec && rec.deletedAt === null) {
    const month = occurrenceMonth(data, op) ?? monthOf(op.date);
    const skip = skipRecord(data, rec.id, month, now);
    if (skip) changes.skips = [skip];
  }
  return changes;
}

/** Récurrences annulées pour un mois, pour la section « ignorées ce mois ». */
export function skippedInMonth(data: Dataset, month: Month): { skip: Skip; recurrence: Recurrence | undefined }[] {
  const ix = indexOf(data);
  return data.collections.skips
    .filter((s) => s.deletedAt === null && s.month === month)
    .map((skip) => ({ skip, recurrence: ix.recurrences.get(skip.recurrenceId) }));
}
