import { indexOf, type DatasetIndex } from "../dataset";
import type { Budget, Cents, Dataset, Month, Operation, Role } from "../model";

const SAVING_ROLES: ReadonlySet<Role> = new Set<Role>(["epargne", "invest"]);
export const isSavingRole = (role: Role | undefined): boolean => role !== undefined && SAVING_ROLES.has(role);

export type MonthAggregates = {
  month: Month;
  /** Nombre d'opérations vivantes du mois, tous types confondus. 0 = mois vide. */
  count: number;
  income: Cents;
  /** Revenus groupés par catégorie, du plus gros au plus petit. */
  incomeBySource: { categoryId: string; amount: Cents }[];
  /**
   * Dépenses groupées par catégorie, toutes les dépenses (épargne comprise), du plus gros
   * au plus petit ; les transferts n'en sont pas. Catégorie introuvable : clé "".
   */
  spendingByCategory: { categoryId: string; amount: Cents }[];
  /** Dépenses par budget, budget supprimé compris (décision 74). */
  byBudget: Record<string, Cents>;
  /** Mis de côté : dépenses des budgets d'épargne, et virements nets vers l'épargne et les placements (décision 74). */
  saved: Cents;
  /** La part des virements dans `saved` : vers un compte épargne ou placement, moins ce qui en revient. */
  transferred: Cents;
  /** Dépensé : dépenses des budgets de dépense (décision 74). */
  spent: Cents;
  balance: Cents;
  /** Dépenses dont la catégorie est introuvable : anomalie d'intégrité, signalée à l'écran. */
  unclassified: Cents;
};

/** Budget d'une catégorie de dépense, supprimé compris ; undefined si la catégorie ou le budget est introuvable. */
export function budgetOf(ix: DatasetIndex, categoryId: string | undefined): Budget | undefined {
  const budgetId = categoryId ? ix.categories.get(categoryId)?.budgetId : undefined;
  return budgetId ? ix.budgets.get(budgetId) : undefined;
}

/** Effet d'une opération sur les agrégats du mois. */
function accumulate(
  op: Operation,
  ix: DatasetIndex,
  acc: MonthAggregates,
  sources: Map<string, Cents>,
  spending: Map<string, Cents>,
): void {
  switch (op.type) {
    case "in": {
      acc.income += op.amount;
      const key = op.categoryId ?? "";
      sources.set(key, (sources.get(key) ?? 0) + op.amount);
      return;
    }
    case "out": {
      const key = op.categoryId ?? "";
      spending.set(key, (spending.get(key) ?? 0) + op.amount);
      const budget = budgetOf(ix, op.categoryId);
      if (!budget) {
        acc.unclassified += op.amount;
        return;
      }
      acc.byBudget[budget.id] = (acc.byBudget[budget.id] ?? 0) + op.amount;
      if (budget.nature === "save") acc.saved += op.amount;
      else acc.spent += op.amount;
      return;
    }
    case "tx": {
      const to = op.toAccountId ? ix.accounts.get(op.toAccountId) : undefined;
      const from = op.fromAccountId ? ix.accounts.get(op.fromAccountId) : undefined;
      if (isSavingRole(to?.role)) acc.transferred += op.amount;
      if (isSavingRole(from?.role)) acc.transferred -= op.amount;
      return;
    }
  }
}

export function monthAggregates(data: Dataset, month: Month): MonthAggregates {
  const ix = indexOf(data);
  const ops = ix.opsByMonth.get(month) ?? [];
  const acc: MonthAggregates = {
    month,
    count: ops.length,
    income: 0,
    incomeBySource: [],
    spendingByCategory: [],
    byBudget: {},
    saved: 0,
    transferred: 0,
    spent: 0,
    balance: 0,
    unclassified: 0,
  };
  const sources = new Map<string, Cents>();
  const spending = new Map<string, Cents>();
  for (const op of ops) accumulate(op, ix, acc, sources, spending);
  acc.saved += acc.transferred;
  acc.balance = acc.income - acc.spent - acc.saved;
  acc.incomeBySource = byAmount(sources);
  acc.spendingByCategory = byAmount(spending);
  return acc;
}

function byAmount(totals: Map<string, Cents>): { categoryId: string; amount: Cents }[] {
  return [...totals]
    .map(([categoryId, amount]) => ({ categoryId, amount }))
    .sort((a, b) => b.amount - a.amount || a.categoryId.localeCompare(b.categoryId));
}

/** Les six dernières opérations du mois, par date puis écriture décroissantes. */
export function latestOperations(data: Dataset, month: Month, limit = 6): Operation[] {
  return [...(indexOf(data).opsByMonth.get(month) ?? [])].sort(compareOpsDesc).slice(0, limit);
}

export function compareOpsDesc(a: Operation, b: Operation): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.id < b.id ? 1 : -1;
}
