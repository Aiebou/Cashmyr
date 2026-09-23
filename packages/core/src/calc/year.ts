import { indexOf } from "../dataset";
import { addMonths, lastDayOf, maxMonth, minDay, minMonth, monthOf, monthRange } from "../dates";
import type { Cents, Dataset, Day, Month } from "../model";
import { savingsOverview } from "./accounts";
import { averageOver, firstActivityMonth, type Average } from "./averages";
import { monthAggregates, type MonthAggregates } from "./month";

export type YearMonth = MonthAggregates & { future: boolean };

export type YearSummary = {
  year: number;
  /** Les 12 mois ; `future` pour ceux qui ne sont pas encore commencés. */
  months: YearMonth[];
  /** Totaux des mois commencés. */
  totals: { income: Cents; needs: Cents; wants: Cents; spent: Cents; saved: Cents };
  /**
   * Moyennes sur les mois écoulés de l'année (mois en cours exclu, car incomplet),
   * sans remonter avant la première opération ; un mois vide compte pour 0.
   */
  averageIncome: Average;
  averageSpending: Average;
  /** Σ mis de côté ÷ Σ revenus ; null sans revenu. Ratio d'affichage, jamais stocké. */
  savingsRate: number | null;
  /** Total des comptes épargne et placements à la fin de chaque mois commencé. */
  savingsCurve: { month: Month; total: Cents }[];
  /** Besoins et envies par catégorie, du plus gros au plus petit. */
  ranking: { categoryId: string; bucket: "besoin" | "envie"; amount: Cents }[];
};

/** Mois écoulés de l'année servant aux moyennes annuelles. */
export function elapsedMonths(data: Dataset, year: number, today: Day): Month[] {
  const first = firstActivityMonth(data);
  if (first === null) return [];
  const y = String(year).padStart(4, "0");
  const from = maxMonth(`${y}-01`, first);
  const to = minMonth(`${y}-12`, addMonths(monthOf(today), -1));
  return monthRange(from, to);
}

export function yearSummary(data: Dataset, year: number, today: Day): YearSummary {
  const y = String(year).padStart(4, "0");
  const current = monthOf(today);
  const months: YearMonth[] = monthRange(`${y}-01`, `${y}-12`).map((m) => ({
    ...monthAggregates(data, m),
    future: m > current,
  }));
  const started = months.filter((m) => !m.future);

  const totals = { income: 0, needs: 0, wants: 0, spent: 0, saved: 0 };
  for (const m of started) {
    totals.income += m.income;
    totals.needs += m.needs;
    totals.wants += m.wants;
    totals.spent += m.spent;
    totals.saved += m.saved;
  }

  const elapsed = elapsedMonths(data, year, today);
  const ix = indexOf(data);
  const ranking = new Map<string, { categoryId: string; bucket: "besoin" | "envie"; amount: Cents }>();
  for (const m of started) {
    for (const op of ix.opsByMonth.get(m.month) ?? []) {
      if (op.type !== "out" || !op.categoryId) continue;
      const bucket = ix.categories.get(op.categoryId)?.bucket;
      if (bucket !== "besoin" && bucket !== "envie") continue;
      const entry = ranking.get(op.categoryId) ?? { categoryId: op.categoryId, bucket, amount: 0 };
      entry.amount += op.amount;
      ranking.set(op.categoryId, entry);
    }
  }

  return {
    year,
    months,
    totals,
    averageIncome: averageOver(data, elapsed, (a) => a.income),
    averageSpending: averageOver(data, elapsed, (a) => a.spent),
    savingsRate: totals.income > 0 ? totals.saved / totals.income : null,
    savingsCurve: started.map((m) => ({
      month: m.month,
      total: savingsOverview(data, minDay(lastDayOf(m.month), today)).total,
    })),
    ranking: [...ranking.values()].sort((a, b) => b.amount - a.amount || a.categoryId.localeCompare(b.categoryId)),
  };
}
