import { indexOf } from "../dataset";
import { addMonths, maxMonth, monthOf, monthRange } from "../dates";
import type { Cents, Dataset, Month } from "../model";
import { roundDiv } from "../money";
import { monthAggregates, type MonthAggregates } from "./month";

/** Mois de la toute première opération vivante, ou null si aucune. */
export function firstActivityMonth(data: Dataset): Month | null {
  let first: Month | null = null;
  for (const m of indexOf(data).opsByMonth.keys()) if (first === null || m < first) first = m;
  return first;
}

/**
 * Fenêtre de moyenne : les `n` mois civils qui précèdent `before`, sans remonter
 * avant le mois de la première opération (le suivi n'existait pas encore).
 */
export function averageWindowMonths(before: Month, n: number, first: Month | null): Month[] {
  if (first === null) return [];
  const from = maxMonth(addMonths(before, -n), first);
  return monthRange(from, addMonths(before, -1));
}

export type Average = {
  /** null si aucun mois de la fenêtre ne contient d'opération : afficher un message, jamais 0. */
  value: Cents | null;
  /** Mois pris en compte ; un mois vide y compte pour 0. */
  months: Month[];
};

/**
 * Moyenne sur des mois donnés. Un mois vide compte pour 0 ; si tous sont vides,
 * la moyenne n'existe pas.
 */
export function averageOver(data: Dataset, months: Month[], pick: (a: MonthAggregates) => Cents): Average {
  const aggregates = months.map((m) => monthAggregates(data, m));
  if (!aggregates.some((a) => a.count > 0)) return { value: null, months };
  const total = aggregates.reduce((sum, a) => sum + pick(a), 0);
  return { value: roundDiv(total, months.length), months };
}

/** Revenu moyen des `n` mois qui précèdent le mois affiché. */
export function averageIncome(data: Dataset, displayed: Month, n: number): Average {
  return averageOver(data, averageWindowMonths(displayed, n, firstActivityMonth(data)), (a) => a.income);
}

/** Dépenses courantes moyennes (besoins + envies) des `n` mois qui précèdent `before`. */
export function averageSpending(data: Dataset, before: Month, n: number): Average {
  return averageOver(data, averageWindowMonths(before, n, firstActivityMonth(data)), (a) => a.spent);
}

/** Mois de référence des moyennes vues à une date : le mois en cours, ou le mois qui suit une date passée. */
export function referenceMonth(asOf: string, today: string): Month {
  return asOf < today ? addMonths(monthOf(asOf), 1) : monthOf(today);
}
