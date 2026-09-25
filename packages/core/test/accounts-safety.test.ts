import { describe, expect, it } from "vitest";
import {
  accountFigures,
  accountFlows,
  asOfForYear,
  currentAccountsOverview,
  declaredAsOf,
  netWorth,
  savingsOverview,
  safetyStatus,
  setPreference,
  tombstone,
  worthOverview,
} from "../src";
import { account, dataset, debt, eur, expense, income, TODAY, transfer, world } from "./fixtures";

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

  it("écart avec la valeur déclarée ; les regroupements restent en capital injecté", () => {
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

describe("valeur déclarée dans les totaux (décisions 42 à 44)", () => {
  const { cats } = world();
  const courant = account("Compte courant", "courant", { opening: eur(1000), declaredValue: eur(9999), declaredAt: "2026-09-01" });
  const livret = account("Livret A", "epargne", { opening: eur(3000), declaredValue: eur(3100), declaredAt: "2026-09-01" });
  const pea = account("PEA", "invest", { opening: eur(800) });
  const crypto = account("Crypto", "autre", { opening: eur(40), declaredValue: eur(55), declaredAt: "2026-09-20" });
  const gone = tombstone(account("Fermé", "epargne", { opening: eur(500), declaredValue: eur(600), declaredAt: "2026-09-01" }), 9);
  const data = dataset({
    categories: Object.values(cats),
    accounts: [courant, livret, pea, crypto, gone],
    operations: [transfer("2026-09-10", eur(100), courant.id, pea.id)],
  });

  it("par défaut : comptes courants en solde, les autres en valeur déclarée, sinon en capital injecté", () => {
    const w = worthOverview(data, TODAY, TODAY, "declared");
    // Le compte courant ignore sa valeur déclarée ; le PEA, sans valeur déclarée, compte pour 900 € injectés.
    expect(w.total).toBe(eur(900 + 3100 + 900 + 55));
    expect(w).toMatchObject({ current: eur(900), savings: eur(3100 + 900), others: eur(55), undeclared: 1 });
    expect(w.injectedOutsideCurrent).toBe(eur(3000 + 900 + 40));
    expect(w.byAccount.map((b) => [b.account.name, b.balance, b.declared, b.value])).toEqual([
      ["Compte courant", eur(900), null, eur(900)],
      ["Livret A", eur(3000), eur(3100), eur(3100)],
      ["PEA", eur(900), null, eur(900)],
      ["Crypto", eur(40), eur(55), eur(55)],
    ]);
  });

  it("tout en capital injecté, ou capital injecté hors comptes courants", () => {
    const all = worthOverview(data, TODAY, TODAY, "injected");
    expect(all.total).toBe(eur(900 + 3000 + 900 + 40));
    expect(all.undeclared).toBe(0);
    const outside = worthOverview(data, TODAY, TODAY, "injectedOutsideCurrent");
    expect(outside.total).toBe(eur(3000 + 900 + 40));
    expect(outside.byAccount.map((b) => b.account.name)).toEqual(["Livret A", "PEA", "Crypto"]);
  });

  it("une valeur déclarée après la date affichée n'est pas utilisée ; sans date, elle ne vaut que pour aujourd'hui", () => {
    const early = worthOverview(data, "2026-09-15", TODAY, "declared");
    expect(early.byAccount.find((b) => b.account.name === "Crypto")).toMatchObject({ declared: null, value: eur(40) });
    expect(early.undeclared).toBe(2);
    const legacy = account("Assurance-vie", "invest", { declaredValue: eur(700) });
    expect(declaredAsOf(legacy, TODAY, TODAY)).toBe(eur(700));
    expect(declaredAsOf(legacy, "2025-12-31", TODAY)).toBeNull();
  });

  it("patrimoine net : total en valeurs déclarées − total dû", () => {
    const withDebt = dataset({ ...data.collections, debts: [debt({ installmentAmount: eur(100), installmentCount: 3 })] });
    expect(netWorth(withDebt, TODAY, TODAY)).toBe(eur(900 + 3100 + 900 + 55 - 300));
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
