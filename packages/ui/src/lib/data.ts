import {
  colorFor,
  indexOf,
  orderAccounts,
  type Account,
  type Budget,
  type Category,
  type Dataset,
  type Debt,
  type Goal,
  type Operation,
  type SeriesColor,
} from "@cashmyr/core";

export const ROLE_LABELS: Record<Account["role"], string> = {
  courant: "Compte courant",
  epargne: "Épargne",
  invest: "Placement",
  autre: "Autre",
};

const deleted = (name: string) => `${name} (supprimé)`;

export const liveCategories = (data: Dataset, kind: "in" | "out"): Category[] =>
  data.collections.categories
    .filter((c) => c.deletedAt === null && c.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

const byPosition = (a: { position: number; name: string }, b: { position: number; name: string }) =>
  a.position - b.position || a.name.localeCompare(b.name, "fr");

/** Budgets vivants, dans leur ordre (décision 71). */
export const liveBudgets = (data: Dataset): Budget[] => data.collections.budgets.filter((b) => b.deletedAt === null).sort(byPosition);

/**
 * Budgets de la répartition : les vivants, puis un budget supprimé sur un autre appareil qui y
 * garde une part, signalé jusqu'au prochain enregistrement (décision 75).
 */
export function splitBudgets(data: Dataset): Budget[] {
  const ix = indexOf(data);
  const gone = Object.entries(data.preferences.splits)
    .filter(([id, bp]) => bp > 0 && ix.budgets.get(id)?.deletedAt != null)
    .map(([id]) => ix.budgets.get(id)!);
  return [...liveBudgets(data), ...gone.sort(byPosition)];
}

export function budgetName(data: Dataset, id: string | undefined): string {
  const b = id ? indexOf(data).budgets.get(id) : undefined;
  if (!b) return "Sans budget";
  return b.deletedAt === null ? b.name : deleted(b.name);
}

/** Couleur d'un budget, supprimé compris ; gris sans budget. */
export function budgetColor(data: Dataset, id: string | undefined): string {
  const b = id ? indexOf(data).budgets.get(id) : undefined;
  return b ? colorFor(data.preferences, { kind: "budget", budget: b }) : "var(--ink-3)";
}

/** Catégories de dépense groupées par budget vivant, dans l'ordre des budgets. */
export function expenseGroups(data: Dataset): { budget: Budget; label: string; categories: Category[] }[] {
  const all = liveCategories(data, "out");
  return liveBudgets(data).map((budget) => ({
    budget,
    label: budget.name,
    categories: all.filter((c) => c.budgetId === budget.id),
  }));
}

/** Comptes vivants, dans l'ordre choisi dans Mes comptes (décision 49). */
export const liveAccounts = (data: Dataset): Account[] => orderAccounts(data.collections.accounts.filter((a) => a.deletedAt === null));

export const liveGoals = (data: Dataset): Goal[] =>
  data.collections.goals.filter((g) => g.deletedAt === null && !g.archived).sort((a, b) => a.position - b.position);

export const liveDebts = (data: Dataset): Debt[] =>
  data.collections.debts.filter((d) => d.deletedAt === null && !d.archived).sort((a, b) => a.position - b.position);

export function categoryName(data: Dataset, id: string | undefined): string {
  if (!id) return "Sans catégorie";
  const c = indexOf(data).categories.get(id);
  if (!c) return "Catégorie inconnue";
  return c.deletedAt === null ? c.name : deleted(c.name);
}

export function accountName(data: Dataset, id: string | undefined): string {
  if (!id) return "—";
  const a = indexOf(data).accounts.get(id);
  if (!a) return "Compte inconnu";
  return a.deletedAt === null ? a.name : deleted(a.name);
}

/** Libellé d'une opération dans une liste. */
export function operationLabel(data: Dataset, op: Operation): string {
  if (op.note.trim()) return op.note.trim();
  if (op.type === "tx") return `${accountName(data, op.fromAccountId)} → ${accountName(data, op.toAccountId)}`;
  return categoryName(data, op.categoryId);
}

/** Pastille d'une opération : source de revenu, usage de la dépense, ou neutre pour un transfert. */
export function operationColor(data: Dataset, op: Operation): string {
  const prefs = data.preferences;
  if (op.type === "tx") return "var(--ink-3)";
  const c = op.categoryId ? indexOf(data).categories.get(op.categoryId) : undefined;
  if (!c) return "var(--ink-3)";
  if (op.type === "in") return colorFor(prefs, { kind: "income", category: c });
  return budgetColor(data, c.budgetId);
}

/** Prochaine couleur de série : attribuée dans l'ordre de création. */
export const nextColor = (existing: readonly { color: SeriesColor }[]): SeriesColor =>
  (existing.length % 7) as SeriesColor;

/** Catégories par défaut : définies dans `core`, avec les identifiants de l'ancienne application. */
export { defaultCategories } from "@cashmyr/core";
