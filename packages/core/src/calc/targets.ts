import type { AverageWindow, Cents, Dataset, Month } from "../model";
import { applyBasisPoints } from "../money";
import { averageIncome } from "./averages";
import { defaultBudgetId } from "../defaults";
import type { Budget } from "../model";
import { monthAggregates, type MonthAggregates } from "./month";

export type Targets = {
  /** Ce sur quoi repose réellement le calcul, à afficher. */
  basis: "avg" | "month";
  /** Vrai si la moyenne était demandée mais n'existe pas encore. */
  fellBack: boolean;
  window: AverageWindow;
  average: Cents | null;
  base: Cents;
  /** Cible de chaque budget de la répartition (décision 75) ; un budget absent n'a pas de cible. */
  targets: Record<string, Cents>;
};

export function monthTargets(data: Dataset, month: Month): Targets {
  const prefs = data.preferences;
  const average = averageIncome(data, month, prefs.averageWindow).value;
  const useAverage = prefs.basis === "avg" && average !== null;
  const base = useAverage ? average : monthAggregates(data, month).income;
  return {
    basis: useAverage ? "avg" : "month",
    fellBack: prefs.basis === "avg" && average === null,
    window: prefs.averageWindow,
    average,
    base,
    targets: Object.fromEntries(Object.entries(prefs.splits).map(([id, bp]) => [id, applyBasisPoints(base, bp)])),
  };
}

/**
 * Ce qu'un budget a reçu dans le mois, à comparer à sa cible : ses dépenses. Les virements vers
 * l'épargne et les placements comptent dans le budget « Épargne » par défaut, comme ils comptaient
 * dans la mise de côté. Leur place quand plusieurs budgets d'épargne existent reste à trancher
 * avant de permettre d'en créer.
 */
export function budgetActual(agg: MonthAggregates, budget: Pick<Budget, "id">): Cents {
  const own = agg.byBudget[budget.id] ?? 0;
  return budget.id === defaultBudgetId("invest") ? own + agg.transferred : own;
}
