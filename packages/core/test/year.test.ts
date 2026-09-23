import { describe, expect, it } from "vitest";
import { elapsedMonths, yearSummary } from "../src";
import { eur, expense, income, TODAY, transfer, world } from "./fixtures";

const { cats, accs, build } = world();
const salary = (date: string, amount: number) => income(date, eur(amount), cats.salaire.id, accs.courant.id);

describe("synthèse annuelle", () => {
  const data = build({
    operations: [
      salary("2026-03-28", 3000),
      salary("2026-05-28", 3000),
      salary("2026-06-28", 3000),
      salary("2026-07-28", 3000),
      salary("2026-08-28", 3000),
      salary("2026-09-01", 1000),
      expense("2026-03-05", eur(800), cats.loyer.id, accs.courant.id),
      expense("2026-05-05", eur(800), cats.loyer.id, accs.courant.id),
      expense("2026-06-12", eur(300), cats.resto.id, accs.courant.id),
      expense("2026-06-13", eur(200), cats.pea.id, accs.courant.id),
      transfer("2026-06-14", eur(500), accs.courant.id, accs.livret.id),
      transfer("2026-08-14", eur(100), accs.livret.id, accs.courant.id),
    ],
  });
  const y = yearSummary(data, 2026, TODAY);

  it("moyennes sur les mois écoulés : depuis la première opération, mois en cours exclu, mois vides à 0", () => {
    expect(elapsedMonths(data, 2026, TODAY)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    expect(y.averageIncome.value).toBe(eur(15_000 / 6));
    expect(y.averageSpending.value).toBe(eur((800 + 800 + 300) / 6));
  });

  it("totaux et taux d'épargne sur les mois commencés, mois en cours compris", () => {
    expect(y.totals).toEqual({
      income: eur(16_000),
      needs: eur(1600),
      wants: eur(300),
      spent: eur(1900),
      saved: eur(200 + 500 - 100),
    });
    expect(y.savingsRate).toBeCloseTo(600 / 16_000, 10);
  });

  it("douze mois, les mois à venir marqués", () => {
    expect(y.months).toHaveLength(12);
    expect(y.months.filter((m) => m.future).map((m) => m.month)).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("courbe de l'épargne : total des comptes épargne et placements en fin de mois", () => {
    expect(y.savingsCurve).toHaveLength(9);
    expect(y.savingsCurve.find((p) => p.month === "2026-05")?.total).toBe(0);
    expect(y.savingsCurve.find((p) => p.month === "2026-06")?.total).toBe(eur(500));
    expect(y.savingsCurve.find((p) => p.month === "2026-09")?.total).toBe(eur(400));
  });

  it("classement des postes : besoins et envies seulement", () => {
    expect(y.ranking).toEqual([
      { categoryId: cats.loyer.id, bucket: "besoin", amount: eur(1600) },
      { categoryId: cats.resto.id, bucket: "envie", amount: eur(300) },
    ]);
  });

  it("une année passée compte ses douze mois, à partir de la première opération", () => {
    const d = build({ operations: [salary("2025-11-28", 3000), salary("2025-12-28", 1000)] });
    expect(elapsedMonths(d, 2025, TODAY)).toEqual(["2025-11", "2025-12"]);
    expect(yearSummary(d, 2025, TODAY).averageIncome.value).toBe(eur(2000));
  });

  it("sans aucune opération : moyennes absentes, taux absent", () => {
    const empty = yearSummary(build(), 2026, TODAY);
    expect(empty.averageIncome.value).toBeNull();
    expect(empty.savingsRate).toBeNull();
  });

  it("en janvier de l'année en cours, aucun mois n'est encore écoulé", () => {
    const d = build({ operations: [salary("2026-01-05", 3000)] });
    expect(yearSummary(d, 2026, "2026-01-20").averageIncome.value).toBeNull();
  });
});
