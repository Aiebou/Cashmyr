import type { Dataset, YearMonth } from "@cashmyr/core";
import type { MonthBar, MonthSeries } from "../components/charts/MonthsChart";
import { budgetColor, liveBudgets } from "./data";

const SAVED = "saved";

/** Couleur de la mise de côté : celle du premier budget d'épargne, sinon celle d'un compte d'épargne. */
export function savingColor(data: Dataset): string {
  const save = liveBudgets(data).find((b) => b.nature === "save");
  return save ? budgetColor(data, save.id) : "var(--bucket-invest)";
}

/**
 * Séries des douze mois : chaque budget de dépense, puis la mise de côté (budgets d'épargne et
 * virements vers l'épargne, décision 74), comme les trois usages d'avant.
 */
export function monthSeries(data: Dataset, months: readonly YearMonth[]): { series: MonthSeries[]; months: MonthBar[] } {
  const spend = liveBudgets(data).filter((b) => b.nature === "spend");
  const series: MonthSeries[] = [
    ...spend.map((b) => ({ key: b.id, label: b.name, color: budgetColor(data, b.id) })),
    { key: SAVED, label: "Mise de côté", color: savingColor(data) },
  ];
  return {
    series,
    months: months.map((m) => ({
      month: m.month,
      income: m.income,
      balance: m.balance,
      future: m.future,
      values: { ...Object.fromEntries(spend.map((b) => [b.id, m.byBudget[b.id] ?? 0])), [SAVED]: m.saved },
    })),
  };
}
