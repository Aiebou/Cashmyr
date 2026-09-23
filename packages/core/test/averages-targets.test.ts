import { describe, expect, it } from "vitest";
import { averageIncome, averageSpending, monthTargets } from "../src";
import { eur, expense, income, world } from "./fixtures";

const { cats, accs, build } = world();
const salary = (date: string, amount: number) => income(date, eur(amount), cats.salaire.id, accs.courant.id);
const rent = (date: string, amount: number) => expense(date, eur(amount), cats.loyer.id, accs.courant.id);

describe("revenu moyen", () => {
  it("un mois vide compte pour 0 : juin 3 000, juillet vide, août 2 000 → 1 666,67 €", () => {
    const data = build({ operations: [salary("2026-01-15", 100), salary("2026-06-28", 3000), salary("2026-08-28", 2000)] });
    const avg = averageIncome(data, "2026-09", 3);
    expect(avg.months).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(avg.value).toBe(166_667);
  });

  it("ne compte pas le mois affiché", () => {
    const data = build({ operations: [salary("2026-08-28", 2000), salary("2026-09-01", 9000)] });
    expect(averageIncome(data, "2026-09", 3).value).toBe(eur(2000));
  });

  it("ne remonte pas avant la première opération : début en septembre, octobre affiché → septembre ÷ 1", () => {
    const data = build({ operations: [salary("2026-09-23", 1200)] });
    const avg = averageIncome(data, "2026-10", 6);
    expect(avg.months).toEqual(["2026-09"]);
    expect(avg.value).toBe(eur(1200));
  });

  it("un mois avec seulement des dépenses n'est pas vide et pèse 0 € de revenu", () => {
    const data = build({ operations: [rent("2026-06-05", 800), salary("2026-07-28", 3000)] });
    const avg = averageIncome(data, "2026-08", 3);
    expect(avg.months).toEqual(["2026-06", "2026-07"]);
    expect(avg.value).toBe(eur(1500));
  });

  it("null si toute la fenêtre est vide, jamais 0", () => {
    const data = build({ operations: [salary("2026-01-15", 3000)] });
    expect(averageIncome(data, "2026-09", 3).value).toBeNull();
    expect(averageIncome(build(), "2026-09", 3).value).toBeNull();
    expect(averageIncome(data, "2026-01", 3).value).toBeNull();
  });

  it("suit la fenêtre choisie : 3, 6 ou 12 mois", () => {
    const ops = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].map((m, i) =>
      salary(`${m}-28`, 1000 * (i + 1)),
    );
    const data = build({ operations: ops });
    expect(averageIncome(data, "2026-09", 3).value).toBe(eur(5000));
    expect(averageIncome(data, "2026-09", 6).value).toBe(eur(3500));
    // 12 mois : la fenêtre s'arrête à mars, premier mois d'activité.
    expect(averageIncome(data, "2026-09", 12).months).toHaveLength(6);
  });
});

describe("dépenses moyennes", () => {
  it("besoins + envies, même règle : mois vides à 0", () => {
    const data = build({
      operations: [
        salary("2026-06-28", 3000),
        rent("2026-06-05", 900),
        expense("2026-08-10", eur(300), cats.resto.id, accs.courant.id),
        expense("2026-08-11", eur(5000), cats.pea.id, accs.courant.id),
      ],
    });
    // juin 900, juillet vide, août 300 ; le PEA (invest) n'est pas une dépense courante.
    expect(averageSpending(data, "2026-09", 3).value).toBe(eur(400));
  });
});

describe("cibles 50/30/20", () => {
  const ops = [salary("2026-06-28", 3000), salary("2026-07-28", 3000), salary("2026-08-28", 3000), salary("2026-09-01", 2000)];

  it("sur la moyenne quand elle existe", () => {
    const t = monthTargets(build({ operations: ops }, { basis: "avg", averageWindow: 3 }), "2026-09");
    expect(t).toMatchObject({ basis: "avg", fellBack: false, base: eur(3000) });
    expect(t.targets).toEqual({ besoin: eur(1500), envie: eur(900), invest: eur(600) });
  });

  it("sur les revenus du mois quand la moyenne manque, et le dit", () => {
    const t = monthTargets(build({ operations: [salary("2026-09-01", 2000)] }, { basis: "avg" }), "2026-09");
    expect(t).toMatchObject({ basis: "month", fellBack: true, average: null, base: eur(2000) });
  });

  it("sur les revenus du mois si c'est la base choisie", () => {
    const t = monthTargets(build({ operations: ops }, { basis: "month" }), "2026-09");
    expect(t).toMatchObject({ basis: "month", fellBack: false, base: eur(2000) });
    expect(t.targets.besoin).toBe(eur(1000));
  });

  it("arrondit chaque cible au centime", () => {
    const data = build(
      { operations: [salary("2026-06-28", 3000), salary("2026-08-28", 2000)] },
      { basis: "avg", averageWindow: 3, splits: { besoin: 5000, envie: 3000, invest: 2000 } },
    );
    const t = monthTargets(data, "2026-09");
    expect(t.base).toBe(166_667);
    expect(t.targets).toEqual({ besoin: 83_334, envie: 50_000, invest: 33_333 });
  });
});
