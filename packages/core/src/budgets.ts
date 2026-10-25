import { indexOf, setPreference } from "./dataset";
import { defaultBudgetId, PRECAUTION_TYPE_ID } from "./defaults";
import { newId } from "./ids";
import type { Account, Budget, BudgetNature, BudgetType, Cents, Changes, Dataset, Preferences, SeriesColor } from "./model";
import { cleanName } from "./names";
import { createRecord, nextStamp, tombstone } from "./records";
import { typeShares } from "./calc/safety";
import { UsageError } from "./usage";

const live = <T extends { deletedAt: number | null }>(rows: readonly T[]) => rows.filter((r) => r.deletedAt === null);
const nextPosition = (rows: readonly { position: number; deletedAt: number | null }[]) =>
  live(rows).reduce((max, r) => Math.max(max, r.position), 0) + 1;

/** Le budget « Épargne » par défaut : il porte la précaution et reçoit les virements sans type (décision 86). */
export const SAVINGS_BUDGET_ID = defaultBudgetId("invest");

/** Budgets vivants, dans leur ordre. */
export const liveBudgetsOf = (data: Dataset): Budget[] =>
  live(data.collections.budgets).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "fr"));

/** Types vivants d'un budget, dans leur ordre. */
export const typesOf = (data: Dataset, budgetId: string): BudgetType[] =>
  live(data.collections.types)
    .filter((t) => t.budgetId === budgetId)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "fr"));

/** Nouveau budget, à 0 % de la répartition (point 9), après les autres. */
export function createBudget(data: Dataset, name: string, nature: BudgetNature, now: number): Budget {
  const clean = cleanName(name);
  if (!clean) throw new UsageError("Donne un nom au budget.");
  const color = (data.collections.budgets.length % 7) as SeriesColor;
  return createRecord<Budget>(newId(), { name: clean, nature, position: nextPosition(data.collections.budgets), color }, now);
}

/** Nouveau type d'un budget, sans objectif, après les autres types de ce budget. */
export function createType(data: Dataset, budgetId: string, name: string, now: number): BudgetType {
  const clean = cleanName(name);
  if (!clean) throw new UsageError("Donne un nom au type.");
  const budget = indexOf(data).budgets.get(budgetId);
  if (!budget || budget.deletedAt !== null) throw new UsageError("Budget introuvable.");
  const position = nextPosition(data.collections.types.filter((t) => t.budgetId === budgetId));
  return createRecord<BudgetType>(newId(), { budgetId, name: clean, position, objective: null }, now);
}

/** Déplace un budget d'un cran parmi les vivants ; les positions sont réécrites dans le nouvel ordre. */
export function moveBudget(data: Dataset, budgetId: string, delta: -1 | 1, now: number): Changes {
  const order = liveBudgetsOf(data);
  const i = order.findIndex((b) => b.id === budgetId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return {};
  [order[i], order[j]] = [order[j]!, order[i]!];
  return {
    budgets: order
      .map((b, k) => ({ b, position: k + 1 }))
      .filter(({ b, position }) => b.position !== position)
      .map(({ b, position }) => ({ ...b, position, updatedAt: nextStamp(now, b) })),
  };
}

/** Dépenses vivantes des catégories d'un budget, tous mois confondus : ce qu'un changement déplacerait. */
export function budgetWeight(data: Dataset, budgetId: string): { count: number; amount: Cents } {
  const ix = indexOf(data);
  const ops = ix.liveOps.filter((o) => o.type === "out" && o.categoryId && ix.categories.get(o.categoryId)?.budgetId === budgetId);
  return { count: ops.length, amount: ops.reduce((sum, o) => sum + o.amount, 0) };
}

/**
 * Ce qu'un type réserve aujourd'hui dans les comptes : ce qui revient aux autres types si on le
 * supprime (décision 84). `asOf` : la date des soldes affichés.
 */
export function typeHolding(data: Dataset, typeId: string, asOf: string): Cents {
  let sum = 0;
  for (const shares of typeShares(data, asOf).values()) sum += shares.get(typeId) ?? 0;
  return sum;
}

/** Le compte sans ce type ; un type principal retiré laisse la place au suivant. */
function withoutType(account: Account, typeId: string, now: number): Account {
  const { typeIds: _old, ...rest } = account;
  const typeIds = (account.typeIds ?? []).filter((id) => id !== typeId);
  return { ...rest, ...(typeIds.length > 0 ? { typeIds } : {}), updatedAt: nextStamp(now, account) };
}

/**
 * Supprime un type (décision 84) : ses catégories restent dans leur budget sans type, les comptes le
 * perdent ; les opérations et les récurrences gardent leur rattachement, dont le montant revient au
 * type principal du compte. Le type de précaution ne se supprime pas (décision 85).
 */
export function deleteType(data: Dataset, typeId: string, now: number): Changes {
  if (typeId === PRECAUTION_TYPE_ID) throw new UsageError("L'épargne de précaution ne se supprime pas : son objectif s'affiche dans Objectifs.");
  const type = indexOf(data).types.get(typeId);
  if (!type || type.deletedAt !== null) throw new UsageError("Type introuvable.");
  const c = data.collections;
  return {
    types: [tombstone(type, now)],
    categories: live(c.categories)
      .filter((cat) => cat.typeId === typeId)
      .map((cat) => {
        const { typeId: _t, ...rest } = cat;
        return { ...rest, updatedAt: nextStamp(now, cat) };
      }),
    accounts: live(c.accounts)
      .filter((a) => a.typeIds?.includes(typeId))
      .map((a) => withoutType(a, typeId, now)),
  };
}

/**
 * Supprime un budget (point 13, décision 87) : ses catégories passent dans `targetId`, sans type ; ses
 * types sont supprimés comme par `deleteType` ; sa part de la répartition s'ajoute à celle de
 * `targetId`. Ni le dernier budget ni le budget « Épargne » par défaut ne se suppriment (décision 86).
 */
export function deleteBudget(data: Dataset, budgetId: string, targetId: string, now: number): { changes: Changes; preferences: Preferences } {
  const ix = indexOf(data);
  const budget = ix.budgets.get(budgetId);
  const target = ix.budgets.get(targetId);
  if (!budget || budget.deletedAt !== null) throw new UsageError("Budget introuvable.");
  if (budgetId === SAVINGS_BUDGET_ID) throw new UsageError("Le budget « Épargne » ne se supprime pas : il porte l'épargne de précaution.");
  if (liveBudgetsOf(data).length <= 1) throw new UsageError("Il faut garder au moins un budget.");
  if (!target || target.deletedAt !== null || targetId === budgetId) throw new UsageError("Choisis le budget qui reçoit ses catégories.");

  const types = typesOf(data, budgetId);
  const typeIds = new Set(types.map((t) => t.id));
  const c = data.collections;
  const changes: Changes = {
    budgets: [tombstone(budget, now)],
    types: types.map((t) => tombstone(t, now)),
    categories: live(c.categories)
      .filter((cat) => cat.budgetId === budgetId)
      .map((cat) => {
        const { typeId: _t, ...rest } = cat;
        return { ...rest, budgetId: targetId, updatedAt: nextStamp(now, cat) };
      }),
    accounts: live(c.accounts)
      .filter((a) => a.typeIds?.some((id) => typeIds.has(id)))
      .map((a) => [...typeIds].reduce((acc, id) => withoutType(acc, id, now), a)),
  };

  const splits = { ...data.preferences.splits };
  const moved = splits[budgetId] ?? 0;
  delete splits[budgetId];
  if (moved > 0) splits[targetId] = (splits[targetId] ?? 0) + moved;
  return { changes, preferences: setPreference(data.preferences, "splits", splits, now) };
}
