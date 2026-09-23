import { indexOf } from "../dataset";
import { addMonths, clampedDay, daysBetween, monthOf } from "../dates";
import type { Cents, Dataset, Day, Debt, Operation } from "../model";
import { allAccountsOverview } from "./accounts";
import { averageIncome } from "./averages";

/** Montant total : le principal s'il est renseigné, sinon montant × nombre d'échéances, sinon 0. */
export function debtTotal(debt: Debt): Cents {
  if (debt.principal > 0) return debt.principal;
  if (debt.mode === "installments") return debt.installmentAmount * debt.installmentCount;
  return 0;
}

const hasSchedule = (debt: Debt) =>
  debt.mode === "installments" && debt.installmentAmount > 0 && debt.installmentCount > 0;

/** Effet signé d'une opération rattachée sur le montant réglé. */
export function debtEffect(debt: Debt, op: Pick<Operation, "type" | "amount">): Cents {
  if (debt.direction === "owe") return op.type === "in" ? -op.amount : op.amount;
  return op.type === "in" ? op.amount : -op.amount;
}

/**
 * Montant réglé au soir du jour `asOf` : `paidManual` plus les opérations vivantes
 * portant ce `debtId`. `extra` ajoute des opérations pas encore écrites (génération en cours).
 */
export function debtPaid(data: Dataset, debt: Debt, asOf: Day, extra: readonly Operation[] = []): Cents {
  let paid = debt.paidManual;
  for (const list of [indexOf(data).liveOps, extra]) {
    for (const op of list) {
      if (op.debtId === debt.id && op.date <= asOf) paid += debtEffect(debt, op);
    }
  }
  return paid;
}

/** Échéancier : `installmentCount` dates mensuelles depuis le mois de `startDate`, au jour `dayOfMonth`. */
export function debtSchedule(debt: Debt): Day[] {
  if (!hasSchedule(debt)) return [];
  const first = monthOf(debt.startDate);
  return Array.from({ length: debt.installmentCount }, (_, i) => clampedDay(addMonths(first, i), debt.dayOfMonth));
}

export type Installment = { index: number; date: Day; amount: Cents };

/**
 * Ce qui reste à payer, échéance par échéance, pour un reste donné. Les échéances
 * restantes s'alignent sur la fin de l'échéancier ; la dernière peut être réduite.
 * Si le reste dépasse l'échéancier, on part de la première date et l'excédent
 * n'est porté par aucune échéance (voir `uncovered`).
 */
export function remainingInstallments(debt: Debt, remaining: Cents): Installment[] {
  if (!hasSchedule(debt) || remaining <= 0) return [];
  const schedule = debtSchedule(debt);
  const count = debt.installmentCount;
  const amount = debt.installmentAmount;
  const left = Math.ceil(remaining / amount);
  const first = Math.max(0, count - left);
  const lastAmount = left <= count ? remaining - (left - 1) * amount : amount;
  const out: Installment[] = [];
  for (let i = first; i < count; i++) {
    out.push({ index: i, date: schedule[i]!, amount: i === count - 1 ? lastAmount : amount });
  }
  return out;
}

export type NextInstallment = Installment & {
  /** overdue : date passée ; soon : dans 0 à 6 jours ; upcoming : plus tard. */
  status: "overdue" | "soon" | "upcoming";
  /** Jours jusqu'à l'échéance ; négatif si elle est passée. */
  daysUntil: number;
};

export type DebtView = {
  debt: Debt;
  total: Cents;
  paid: Cents;
  /** max(0, total − réglé). */
  remaining: Cents;
  schedule: Day[];
  /** floor(réglé ÷ montant), entre 0 et le nombre d'échéances : remplissage des segments. */
  covered: number | null;
  /** ceil(reste ÷ montant). */
  installmentsLeft: number | null;
  /** Montant de la dernière échéance restante, éventuellement réduit. */
  lastAmount: Cents | null;
  next: NextInstallment | null;
  /** Date de la dernière échéance restante, plafonnée à la fin de l'échéancier. */
  payoffDate: Day | null;
  /** Part du reste qu'aucune échéance ne porte (reste supérieur à l'échéancier). */
  uncovered: Cents;
  /** Reste nul sans que la dette soit marquée soldée : la carte le propose. */
  suggestSettled: boolean;
};

export function debtView(data: Dataset, debt: Debt, asOf: Day, today: Day): DebtView {
  const total = debtTotal(debt);
  const paid = debtPaid(data, debt, asOf);
  const remaining = Math.max(0, total - paid);
  const schedule = debtSchedule(debt);
  const base = { debt, total, paid, remaining, schedule, suggestSettled: !debt.settled && remaining === 0 };
  if (!hasSchedule(debt)) {
    return { ...base, covered: null, installmentsLeft: null, lastAmount: null, next: null, payoffDate: null, uncovered: 0 };
  }
  const amount = debt.installmentAmount;
  const count = debt.installmentCount;
  const left = Math.ceil(remaining / amount);
  const entries = remainingInstallments(debt, remaining);
  const first = entries[0];
  let next: NextInstallment | null = null;
  if (first) {
    const daysUntil = daysBetween(today, first.date);
    next = { ...first, daysUntil, status: daysUntil < 0 ? "overdue" : daysUntil < 7 ? "soon" : "upcoming" };
  }
  const firstIndex = Math.max(0, count - left);
  return {
    ...base,
    covered: Math.min(count, Math.max(0, Math.floor(paid / amount))),
    installmentsLeft: left,
    lastAmount: left > 0 ? remaining - (left - 1) * amount : null,
    next,
    payoffDate: left > 0 ? schedule[Math.min(firstIndex + left - 1, count - 1)]! : null,
    uncovered: Math.max(0, remaining - count * amount),
  };
}

const liveDebts = (data: Dataset) => data.collections.debts.filter((d) => d.deletedAt === null);

/**
 * Charge mensuelle : somme des montants d'échéance des dettes « je dois »
 * en mode échéances, ni soldées ni archivées, dont le reste est strictement positif.
 */
export function monthlyDebtLoad(data: Dataset, asOf: Day): Cents {
  return liveDebts(data)
    .filter((d) => d.direction === "owe" && d.mode === "installments" && !d.settled && !d.archived)
    .filter((d) => debtTotal(d) - debtPaid(data, d, asOf) > 0)
    .reduce((sum, d) => sum + d.installmentAmount, 0);
}

/** Dettes « je dois » qui comptent dans le total dû : ni archivées, ni soldées. */
const owedDebts = (data: Dataset) =>
  liveDebts(data).filter((d) => d.direction === "owe" && !d.archived && !d.settled);

/** Total dû : somme des restes des dettes « je dois » ni archivées ni soldées. */
export function totalOwed(data: Dataset, asOf: Day): Cents {
  return owedDebts(data).reduce((sum, d) => sum + Math.max(0, debtTotal(d) - debtPaid(data, d, asOf)), 0);
}

/** Patrimoine net : total des comptes moins le total dû. */
export function netWorth(data: Dataset, asOf: Day): Cents {
  return allAccountsOverview(data, asOf).total - totalOwed(data, asOf);
}

export type DebtsOverview = {
  totalOwed: Cents;
  /** Reste par dette, pour la barre segmentée. */
  byDebt: { debt: Debt; remaining: Cents }[];
  monthlyLoad: Cents;
  /** Revenu moyen du mois en cours, même règle que l'écran Mois. */
  averageIncome: Cents | null;
  /** Charge mensuelle ÷ revenu moyen ; null sans revenu moyen. Ratio d'affichage. */
  loadRatio: number | null;
};

export function debtsOverview(data: Dataset, asOf: Day, today: Day): DebtsOverview {
  const byDebt = owedDebts(data)
    .map((debt) => ({ debt, remaining: Math.max(0, debtTotal(debt) - debtPaid(data, debt, asOf)) }))
    .filter((d) => d.remaining > 0);
  const monthlyLoad = monthlyDebtLoad(data, asOf);
  const avg = averageIncome(data, monthOf(today), data.preferences.averageWindow).value;
  return {
    totalOwed: byDebt.reduce((sum, d) => sum + d.remaining, 0),
    byDebt,
    monthlyLoad,
    averageIncome: avg,
    loadRatio: avg !== null && avg > 0 ? monthlyLoad / avg : null,
  };
}

const byPosition = (a: Debt, b: Debt) => a.position - b.position || a.name.localeCompare(b.name, "fr");
const pinnedFirst = (a: Debt, b: Debt) => Number(b.pinned) - Number(a.pinned) || byPosition(a, b);

/** Bloc dettes du tableau de bord : ni archivées, ni masquées, et non soldées ou épinglées. */
export function dashboardDebts(data: Dataset): Debt[] {
  return liveDebts(data)
    .filter((d) => !d.archived && !d.hidden && (!d.settled || d.pinned))
    .sort(pinnedFirst);
}

/** Onglet Dettes : actives, soldées, archivées. */
export function debtsByState(data: Dataset): { active: Debt[]; settled: Debt[]; archived: Debt[] } {
  const live = liveDebts(data);
  return {
    active: live.filter((d) => !d.archived && !d.settled).sort(pinnedFirst),
    settled: live.filter((d) => !d.archived && d.settled).sort(pinnedFirst),
    archived: live.filter((d) => d.archived).sort(byPosition),
  };
}
