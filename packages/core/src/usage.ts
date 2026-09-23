import { indexOf } from "./dataset";
import type { Category, Changes, Dataset } from "./model";
import { tombstone, touch } from "./records";

export class UsageError extends Error {
  override name = "UsageError";
}

export type AccountUsage = { operations: number; recurrences: number; debts: number; goals: number };
export type CategoryUsage = { operations: number; recurrences: number; debts: number };

export const isUsed = (usage: AccountUsage | CategoryUsage): boolean => Object.values(usage).some((n) => n > 0);

/** Lignes vivantes qui font référence à un compte. */
export function accountUsage(data: Dataset, accountId: string): AccountUsage {
  const c = data.collections;
  const live = <T extends { deletedAt: number | null }>(list: readonly T[]) => list.filter((r) => r.deletedAt === null);
  return {
    operations: indexOf(data).liveOps.filter(
      (o) => o.accountId === accountId || o.fromAccountId === accountId || o.toAccountId === accountId,
    ).length,
    recurrences: live(c.recurrences).filter(
      (r) => r.accountId === accountId || r.fromAccountId === accountId || r.toAccountId === accountId,
    ).length,
    debts: live(c.debts).filter((d) => d.accountId === accountId).length,
    goals: live(c.goals).filter((g) => g.accountIds.includes(accountId)).length,
  };
}

/** Lignes vivantes qui font référence à une catégorie. */
export function categoryUsage(data: Dataset, categoryId: string): CategoryUsage {
  const c = data.collections;
  return {
    operations: indexOf(data).liveOps.filter((o) => o.categoryId === categoryId).length,
    recurrences: c.recurrences.filter((r) => r.deletedAt === null && r.categoryId === categoryId).length,
    debts: c.debts.filter((d) => d.deletedAt === null && d.categoryId === categoryId).length,
  };
}

/** Décision 30 : un compte encore utilisé ne se supprime pas. */
export function deleteAccount(data: Dataset, accountId: string, now: number): Changes {
  const account = indexOf(data).accounts.get(accountId);
  if (!account || account.deletedAt !== null) throw new UsageError("Compte introuvable.");
  if (isUsed(accountUsage(data, accountId))) {
    throw new UsageError("Ce compte est encore utilisé : il ne peut pas être supprimé.");
  }
  return { accounts: [tombstone(account, now)] };
}

/**
 * Décision 31 : supprimer une catégorie utilisée demande une remplaçante de même nature,
 * existante ou créée pour l'occasion (`Category` complète, écrite dans le même lot).
 * Opérations, récurrences et dettes y basculent. Sans usage, la suppression est directe.
 */
export function deleteCategory(data: Dataset, categoryId: string, now: number, replacement?: string | Category): Changes {
  const ix = indexOf(data);
  const category = ix.categories.get(categoryId);
  if (!category || category.deletedAt !== null) throw new UsageError("Catégorie introuvable.");
  const changes: Changes = { categories: [tombstone(category, now)] };
  const usage = categoryUsage(data, categoryId);
  if (!isUsed(usage)) return changes;
  if (replacement === undefined) {
    throw new UsageError("Cette catégorie est utilisée : choisis celle qui la remplace.");
  }

  const target = typeof replacement === "string" ? ix.categories.get(replacement) : replacement;
  if (!target || target.deletedAt !== null || target.id === categoryId) {
    throw new UsageError("Catégorie de remplacement introuvable.");
  }
  if (target.kind !== category.kind) {
    throw new UsageError("La catégorie de remplacement doit être de même nature (revenu ou dépense).");
  }
  if (typeof replacement !== "string") {
    if (ix.categories.has(replacement.id)) throw new UsageError("Cette nouvelle catégorie existe déjà.");
    changes.categories!.push(replacement);
  }

  const c = data.collections;
  changes.operations = ix.liveOps.filter((o) => o.categoryId === categoryId).map((o) => touch(o, { categoryId: target.id }, now));
  changes.recurrences = c.recurrences
    .filter((r) => r.deletedAt === null && r.categoryId === categoryId)
    .map((r) => touch(r, { categoryId: target.id }, now));
  changes.debts = c.debts
    .filter((d) => d.deletedAt === null && d.categoryId === categoryId)
    .map((d) => touch(d, { categoryId: target.id }, now));
  return changes;
}
