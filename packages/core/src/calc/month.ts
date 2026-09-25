import { indexOf, type DatasetIndex } from "../dataset";
import type { Cents, Dataset, Month, Operation, Role } from "../model";

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
   * Dépenses groupées par catégorie, toutes les dépenses (besoins, envies, épargne), du plus gros
   * au plus petit ; les transferts n'en sont pas. Catégorie introuvable : clé "".
   */
  spendingByCategory: { categoryId: string; amount: Cents }[];
  needs: Cents;
  wants: Cents;
  saved: Cents;
  spent: Cents;
  balance: Cents;
  /** Dépenses dont la catégorie est introuvable : anomalie d'intégrité, signalée à l'écran. */
  unclassified: Cents;
};

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
      const bucket = op.categoryId ? ix.categories.get(op.categoryId)?.bucket : undefined;
      if (bucket === "besoin") acc.needs += op.amount;
      else if (bucket === "envie") acc.wants += op.amount;
      else if (bucket === "invest") acc.saved += op.amount;
      else acc.unclassified += op.amount;
      return;
    }
    case "tx": {
      const to = op.toAccountId ? ix.accounts.get(op.toAccountId) : undefined;
      const from = op.fromAccountId ? ix.accounts.get(op.fromAccountId) : undefined;
      if (isSavingRole(to?.role)) acc.saved += op.amount;
      if (isSavingRole(from?.role)) acc.saved -= op.amount;
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
    needs: 0,
    wants: 0,
    saved: 0,
    spent: 0,
    balance: 0,
    unclassified: 0,
  };
  const sources = new Map<string, Cents>();
  const spending = new Map<string, Cents>();
  for (const op of ops) accumulate(op, ix, acc, sources, spending);
  acc.spent = acc.needs + acc.wants;
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
