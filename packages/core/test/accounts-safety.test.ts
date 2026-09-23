import { describe, expect, it } from "vitest";
import {
  accountFigures,
  accountFlows,
  asOfForYear,
  currentAccountsOverview,
  savingsOverview,
  safetyStatus,
  setPreference,
  tombstone,
} from "../src";
import { account, dataset, eur, expense, income, TODAY, transfer, world } from "./fixtures";

describe("soldes de comptes", () => {
  const { cats, accs, build } = world();
  const courant = { ...accs.courant, opening: eur(1000) };
  const pea = { ...accs.pea, declaredValue: eur(350), declaredAt: "2026-09-01" };
  const data = dataset({
    categories: Object.values(cats),
    accounts: [courant, accs.livret, pea, accs.especes],
    operations: [
      income("2026-09-01", eur(3000), cats.salaire.id, courant.id),
      expense("2026-09-05", eur(800), cats.loyer.id, courant.id),
      transfer("2026-09-06", eur(500), courant.id, accs.livret.id),
      transfer("2026-09-07", eur(200), accs.livret.id, courant.id),
      transfer("2026-09-08", eur(300), courant.id, pea.id),
      income("2026-09-30", eur(3000), cats.salaire.id, courant.id),
    ],
  });
  void build;
  const f = accountFigures(data, TODAY);

  it("départ + revenus − dépenses + transferts reçus − transferts émis", () => {
    expect(f.get(courant.id)).toMatchObject({
      opening: eur(1000),
      inflow: eur(3000 + 200),
      outflow: eur(800 + 500 + 300),
      balance: eur(1000 + 3000 - 800 - 500 + 200 - 300),
    });
    expect(f.get(accs.livret.id)?.balance).toBe(eur(300));
    expect(f.get(pea.id)?.balance).toBe(eur(300));
  });

  it("n'entre que les opérations datées au plus tard du jour de référence", () => {
    expect(accountFigures(data, "2026-09-30").get(courant.id)?.balance).toBe(eur(5600));
    expect(accountFigures(data, "2026-09-05").get(courant.id)?.balance).toBe(eur(3200));
  });

  it("affiche l'écart avec la valeur déclarée sans l'utiliser ailleurs", () => {
    expect(f.get(pea.id)).toMatchObject({ declaredValue: eur(350), declaredGap: eur(50) });
    expect(f.get(accs.livret.id)?.declaredGap).toBeNull();
    const s = savingsOverview(data, TODAY);
    expect(s.total).toBe(eur(600));
    expect(s.declaredGap).toBe(eur(50));
  });

  it("regroupe épargne/placements et comptes courants ; « autre » et comptes supprimés à part", () => {
    expect(savingsOverview(data, TODAY).byAccount.map((b) => b.account.id)).toEqual([accs.livret.id, pea.id]);
    expect(currentAccountsOverview(data, TODAY).total).toBe(eur(2600));
    const withoutPea = { ...data, collections: { ...data.collections, accounts: data.collections.accounts.map((a) => (a.id === pea.id ? tombstone(a, 9) : a)) } };
    expect(savingsOverview(withoutPea, TODAY).total).toBe(eur(300));
  });

  it("mouvements d'une période, par compte", () => {
    const flows = accountFlows(data, "2026-09-06", "2026-09-07");
    expect(flows.get(accs.livret.id)).toEqual({ inflow: eur(500), outflow: eur(200) });
    expect(flows.get(courant.id)).toEqual({ inflow: eur(200), outflow: eur(500) });
  });

  it("date de référence d'une année", () => {
    expect(asOfForYear(2025, TODAY)).toBe("2025-12-31");
    expect(asOfForYear(2026, TODAY)).toBe(TODAY);
    expect(asOfForYear(2027, TODAY)).toBe(TODAY);
  });
});

describe("épargne de précaution", () => {
  const { cats, accs } = world();
  const livret = { ...accs.livret, opening: eur(3000) };
  const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  const base = dataset({
    categories: Object.values(cats),
    accounts: [accs.courant, livret, accs.pea],
    operations: months.map((m) => expense(`${m}-10`, eur(500), cats.courses.id, accs.courant.id)),
  });

  it("500 € de dépenses, objectif 4 mois, 3 000 € constitués → 2 000 € et 6,0 mois de capacité", () => {
    const s = safetyStatus(base, TODAY, TODAY);
    expect(s.averageSpending).toBe(eur(500));
    expect(s.objective).toBe(eur(2000));
    expect(s.constituted).toBe(eur(3000));
    expect(s.capacityMonths).toBe(6);
    expect(s.reached).toBe(true);
  });

  it("capacité arrondie à une décimale", () => {
    const d = { ...base, collections: { ...base.collections, accounts: [accs.courant, { ...livret, opening: eur(1234) }] } };
    expect(safetyStatus(d, TODAY, TODAY).capacityMonths).toBe(2.5);
  });

  it("mode montant fixe", () => {
    const d = { ...base, preferences: setPreference(base.preferences, "safety", { ...base.preferences.safety, mode: "amount", amount: eur(5000) }, 1) };
    const s = safetyStatus(d, TODAY, TODAY);
    expect(s.objective).toBe(eur(5000));
    expect(s.reached).toBe(false);
    expect(s.capacityMonths).toBe(6);
  });

  it("sans historique : objectif en mois et capacité inconnus, jamais zéro", () => {
    const d = dataset({ categories: Object.values(cats), accounts: [livret] });
    const s = safetyStatus(d, TODAY, TODAY);
    expect(s).toMatchObject({ objective: null, capacityMonths: null, reached: null, constituted: eur(3000) });
  });

  it("ne compte que les comptes cochés", () => {
    const pea = { ...accs.pea, opening: eur(10_000) };
    const d = { ...base, collections: { ...base.collections, accounts: [accs.courant, livret, pea] } };
    expect(safetyStatus(d, TODAY, TODAY).constituted).toBe(eur(3000));
    const checked = { ...d, collections: { ...d.collections, accounts: [accs.courant, livret, { ...pea, safety: true }] } };
    expect(safetyStatus(checked, TODAY, TODAY)).toMatchObject({ constituted: eur(13_000), accountIds: [livret.id, pea.id] });
  });

  it("même fenêtre que le revenu moyen, mois vides à 0", () => {
    const d = dataset({
      categories: Object.values(cats),
      accounts: [accs.courant, livret],
      operations: [
        income("2026-03-01", eur(2000), cats.salaire.id, accs.courant.id),
        expense("2026-08-10", eur(600), cats.courses.id, accs.courant.id),
      ],
    });
    expect(safetyStatus(d, TODAY, TODAY).averageSpending).toBe(eur(100));
    const three = { ...d, preferences: setPreference(d.preferences, "averageWindow", 3, 1) };
    expect(safetyStatus(three, TODAY, TODAY).averageSpending).toBe(eur(200));
  });

  it("vue d'une année passée : la fenêtre s'arrête en décembre", () => {
    const d = dataset({
      categories: Object.values(cats),
      accounts: [accs.courant, livret],
      operations: [
        expense("2025-12-10", eur(600), cats.courses.id, accs.courant.id),
        expense("2026-01-10", eur(6000), cats.courses.id, accs.courant.id),
      ],
    });
    const s = safetyStatus(d, "2025-12-31", TODAY);
    expect(s.averageMonths).toEqual(["2025-12"]);
    expect(s.averageSpending).toBe(eur(600));
  });

  it("les comptes de précaution d'un autre rôle comptent aussi", () => {
    const cash = account("Espèces", "autre", { safety: true, opening: eur(100) });
    const d = { ...base, collections: { ...base.collections, accounts: [...base.collections.accounts, cash] } };
    expect(safetyStatus(d, TODAY, TODAY).constituted).toBe(eur(3100));
  });
});
