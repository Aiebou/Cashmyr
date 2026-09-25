import { describe, expect, it } from "vitest";
import { latestOperations, monthAggregates, tombstone } from "../src";
import { eur, expense, income, transfer, world } from "./fixtures";

describe("agrégats d'un mois", () => {
  const { cats, accs, build } = world();
  const M = "2026-09";
  const data = build({
    operations: [
      income(`${M}-01`, eur(3000), cats.salaire.id, accs.courant.id),
      income(`${M}-12`, eur(500), cats.freelance.id, accs.courant.id),
      expense(`${M}-05`, eur(800), cats.loyer.id, accs.courant.id),
      expense(`${M}-06`, eur(200), cats.courses.id, accs.courant.id),
      expense(`${M}-07`, eur(150), cats.resto.id, accs.courant.id),
      expense(`${M}-08`, eur(100), cats.pea.id, accs.courant.id),
      transfer(`${M}-09`, eur(300), accs.courant.id, accs.livret.id),
      transfer(`${M}-10`, eur(200), accs.pea.id, accs.courant.id),
      transfer(`${M}-11`, eur(50), accs.courant.id, accs.especes.id),
      transfer(`${M}-13`, eur(100), accs.livret.id, accs.pea.id),
      expense(`2026-08-31`, eur(999), cats.resto.id, accs.courant.id),
    ],
  });
  const a = monthAggregates(data, M);

  it("additionne les revenus et les groupe par source", () => {
    expect(a.income).toBe(eur(3500));
    expect(a.incomeBySource).toEqual([
      { categoryId: cats.salaire.id, amount: eur(3000) },
      { categoryId: cats.freelance.id, amount: eur(500) },
    ]);
  });

  it("groupe toutes les dépenses par catégorie, épargne comprise, sans les transferts", () => {
    expect(a.spendingByCategory).toEqual([
      { categoryId: cats.loyer.id, amount: eur(800) },
      { categoryId: cats.courses.id, amount: eur(200) },
      { categoryId: cats.resto.id, amount: eur(150) },
      { categoryId: cats.pea.id, amount: eur(100) },
    ]);
  });

  it("classe les dépenses par enveloppe", () => {
    expect(a.needs).toBe(eur(1000));
    expect(a.wants).toBe(eur(150));
    expect(a.spent).toBe(eur(1150));
  });

  it("mis de côté = dépenses invest + transferts entrants − transferts sortants des comptes épargne/invest", () => {
    // 100 (PEA et ETF) + 300 (vers Livret) − 200 (retrait PEA) + 100 − 100 (Livret → PEA, neutre)
    // Le transfert vers « Espèces » (rôle autre) ne compte pas.
    expect(a.saved).toBe(eur(200));
  });

  it("balance = revenus − dépensé − mis de côté", () => {
    expect(a.balance).toBe(eur(3500 - 1150 - 200));
  });

  it("compte toutes les opérations du mois, et seulement celles-là", () => {
    expect(a.count).toBe(10);
    expect(monthAggregates(data, "2026-07").count).toBe(0);
  });

  it("un retrait du PEA vers le compte courant diminue la mise de côté du mois", () => {
    const d = build({ operations: [transfer(`${M}-15`, eur(400), accs.pea.id, accs.courant.id)] });
    const agg = monthAggregates(d, M);
    expect(agg.saved).toBe(eur(-400));
    expect(agg.balance).toBe(eur(400));
  });

  it("ignore les opérations supprimées", () => {
    const op = income(`${M}-02`, eur(1000), cats.salaire.id, accs.courant.id);
    const d = build({ operations: [tombstone(op, 5)] });
    expect(monthAggregates(d, M)).toMatchObject({ income: 0, count: 0 });
  });

  it("liste les six dernières opérations, plus récentes d'abord", () => {
    const latest = latestOperations(data, M);
    expect(latest).toHaveLength(6);
    expect(latest.map((o) => o.date)).toEqual([
      `${M}-13`,
      `${M}-12`,
      `${M}-11`,
      `${M}-10`,
      `${M}-09`,
      `${M}-08`,
    ]);
  });
});
