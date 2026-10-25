import { describe, expect, it } from "vitest";
import {
  applyChanges,
  assertValidDataset,
  budgetActual,
  defaultBudgetId,
  defaultCategories,
  defaultTypeId,
  DEFAULTS_AT,
  legacyCategoryId,
  mergeDatasets,
  monthAggregates,
  parseSyncDocument,
  PRECAUTION_TYPE_ID,
  safetyStatus,
  typeShares,
  upgradeSchema,
  validateDataset,
  type Dataset,
} from "../src";
import { account, dataset, eur, expense, income, NOW, precaution, TODAY, transfer, world } from "./fixtures";

const [NEEDS, WANTS, SAVED] = (["besoin", "envie", "invest"] as const).map(defaultBudgetId) as [string, string, string];
const cat = (legacy: string) => legacyCategoryId(legacy);

/**
 * Un profil au format 2, tel qu'une version 0.5 l'écrit : catégories par défaut jamais modifiées
 * (horodatées 0, ou 2 pour les noms de la décision 68), une renommée par l'utilisateur, une ajoutée,
 * un livret coché « précaution » et des réglages modifiés.
 */
function format2(): Record<string, unknown> {
  const c = (legacy: string, name: string, kind: "in" | "out", bucket: string | undefined, updatedAt = 0) => ({
    id: cat(legacy),
    updatedAt,
    deletedAt: null,
    name,
    kind,
    ...(bucket ? { bucket } : {}),
    color: 0,
  });
  return {
    schemaVersion: 2,
    collections: {
      categories: [
        c("r1", "Salaire", "in", undefined),
        c("r2", "Revenus annexes", "in", undefined, 2),
        c("d8", "Loyer et charges", "out", "besoin"),
        c("d12", "Supermarché", "out", "besoin", NOW - 5000),
        c("d18", "Restaurants et bars", "out", "envie"),
        c("d26", "PEA et ETF", "out", "invest"),
        { id: "cat-animaux", updatedAt: NOW - 4000, deletedAt: null, name: "Animaux", kind: "out", bucket: "besoin", color: 0 },
        { id: "cat-alim", updatedAt: NOW - 4000, deletedAt: null, name: "alimentaire", kind: "out", bucket: "besoin", color: 0 },
      ],
      accounts: [
        { id: "acc-courant", updatedAt: 1, deletedAt: null, name: "Compte courant", role: "courant", opening: eur(1000), safety: false, color: 0 },
        { id: "acc-livret", updatedAt: 1, deletedAt: null, name: "Livret A", role: "epargne", opening: eur(3000), safety: true, color: 1 },
      ],
      operations: [
        { id: "op-1", updatedAt: 1, deletedAt: null, date: "2026-09-01", amount: eur(2000), type: "in", note: "", categoryId: cat("r1"), accountId: "acc-courant" },
        { id: "op-2", updatedAt: 1, deletedAt: null, date: "2026-09-02", amount: eur(700), type: "out", note: "", categoryId: cat("d8"), accountId: "acc-courant" },
        { id: "op-3", updatedAt: 1, deletedAt: null, date: "2026-09-03", amount: eur(120), type: "out", note: "", categoryId: cat("d18"), accountId: "acc-courant" },
        { id: "op-4", updatedAt: 1, deletedAt: null, date: "2026-09-04", amount: eur(200), type: "out", note: "", categoryId: cat("d26"), accountId: "acc-courant" },
        { id: "op-5", updatedAt: 1, deletedAt: null, date: "2026-09-05", amount: eur(300), type: "tx", note: "", fromAccountId: "acc-courant", toAccountId: "acc-livret" },
      ],
      goals: [],
      goalSteps: [],
      debts: [],
      recurrences: [],
      skips: [],
      tags: [],
    },
    preferences: {
      splits: { besoin: 5500, envie: 2500, invest: 2000 },
      basis: "avg",
      averageWindow: 6,
      safety: { mode: "months", months: 6, amount: 0, hidden: false, pinned: false },
      dashOrder: ["goals", "debts", "stats", "months", "savings", "cats"],
      theme: "system",
      categoryColors: {},
      bucketColors: { envie: "#aa5500" },
      updatedAt: { splits: NOW - 3000, basis: 0, averageWindow: 0, safety: NOW - 2000, dashOrder: 0, theme: 0, categoryColors: 0, bucketColors: NOW - 1000 },
    },
  };
}

const upgraded = (): Dataset => {
  const data = upgradeSchema(format2()) as unknown as Dataset;
  assertValidDataset(data);
  return data;
};

describe("format 2 → 3 (décision 81)", () => {
  it("donne un jeu valide au format 3, avec les budgets et les types par défaut", () => {
    const data = upgraded();
    expect(data.schemaVersion).toBe(3);
    expect(data.collections.budgets.map((b) => [b.id, b.name, b.nature, b.updatedAt])).toEqual([
      [NEEDS, "Dépenses courantes", "spend", DEFAULTS_AT],
      [WANTS, "Loisirs", "spend", DEFAULTS_AT],
      [SAVED, "Épargne", "save", DEFAULTS_AT],
    ]);
    expect(data.collections.types).toHaveLength(6);
  });

  it("répartition et couleurs passent des usages aux budgets, avec leur horodatage", () => {
    const p = upgraded().preferences;
    expect(p.splits).toEqual({ [NEEDS]: 5500, [WANTS]: 2500, [SAVED]: 2000 });
    expect(p.budgetColors).toEqual({ [WANTS]: "#aa5500" });
    expect(p.updatedAt).toMatchObject({ splits: NOW - 3000, budgetColors: NOW - 1000 });
    expect("safety" in p || "bucketColors" in p || "safety" in p.updatedAt).toBe(false);
  });

  it("la précaution devient l'objectif de son type, à l'horodatage du réglage ; le livret y est rattaché (décision 79)", () => {
    const data = upgraded();
    expect(data.collections.types.find((t) => t.id === PRECAUTION_TYPE_ID)).toMatchObject({
      name: "Épargne de précaution",
      budgetId: SAVED,
      objective: { mode: "months", months: 6, amount: 0, hidden: false, pinned: false },
      updatedAt: NOW - 2000,
    });
    const [courant, livret] = data.collections.accounts;
    expect(courant).not.toHaveProperty("typeIds");
    expect(livret).toMatchObject({ typeIds: [PRECAUTION_TYPE_ID], updatedAt: 1 });
    expect(courant).not.toHaveProperty("safety");
    // Même montant constitué qu'avant : le solde du livret.
    expect(safetyStatus(data, TODAY, TODAY).constituted).toBe(eur(3300));
  });

  it("catégories par défaut jamais modifiées : nouvelle forme, ou suppression qui garde les opérations (décision 73)", () => {
    const byId = new Map(upgraded().collections.categories.map((c) => [c.id, c]));
    // Gardée, avec son budget et son type.
    expect(byId.get(cat("d8"))).toMatchObject({ name: "Loyer et charges", budgetId: NEEDS, typeId: defaultTypeId("charges-fixes"), updatedAt: DEFAULTS_AT });
    // Retirées de la liste : supprimées, horodatées DEFAULTS_AT.
    expect(byId.get(cat("d18"))).toMatchObject({ budgetId: WANTS, deletedAt: DEFAULTS_AT });
    expect(byId.get(cat("r2"))).toMatchObject({ deletedAt: DEFAULTS_AT });
    // Modifiée par l'utilisateur : intouchée, sinon son budget.
    expect(byId.get(cat("d12"))).toMatchObject({ name: "Supermarché", budgetId: NEEDS, updatedAt: NOW - 5000, deletedAt: null });
    expect(byId.get(cat("d12"))).not.toHaveProperty("typeId");
    // Ajoutée par l'utilisateur : son budget, sans type (point 14).
    expect(byId.get("cat-animaux")).toMatchObject({ budgetId: NEEDS, updatedAt: NOW - 4000 });
    expect(byId.get("cat-animaux")).not.toHaveProperty("typeId");
  });

  it("les nouvelles catégories par défaut arrivent, sauf un nom déjà porté", () => {
    const names = upgraded()
      .collections.categories.filter((c) => c.deletedAt === null)
      .map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Aides", "Remboursement et créance", "Consommable", "Placement", "Remboursement de dettes"]));
    // « alimentaire » existe déjà chez l'utilisateur : pas de seconde « Alimentaire ».
    expect(names.filter((n) => n.toLowerCase() === "alimentaire")).toEqual(["alimentaire"]);
  });

  it("les chiffres du mois ne changent pas : une catégorie supprimée compte toujours dans son budget", () => {
    const a = monthAggregates(upgraded(), "2026-09");
    expect(a.byBudget).toEqual({ [NEEDS]: eur(700), [WANTS]: eur(120), [SAVED]: eur(200) });
    expect(a).toMatchObject({ income: eur(2000), spent: eur(820), saved: eur(200 + 300), balance: eur(2000 - 820 - 500), unclassified: 0 });
  });

  it("deux appareils qui mettent à niveau chacun de leur côté convergent sans rien recevoir", () => {
    const a = upgraded();
    const b = upgraded();
    expect(a).toEqual(b);
    const { report } = mergeDatasets(a, b);
    expect(report.received + report.sent).toBe(0);
  });

  it("une catégorie par défaut d'un appareil neuf est identique à celle d'un profil mis à niveau", () => {
    const fresh = new Map(defaultCategories().map((c) => [c.id, c]));
    expect(upgraded().collections.categories.find((c) => c.id === cat("d8"))).toEqual(fresh.get(cat("d8")));
  });

  it("un profil vide ne reçoit ni budget ni type", () => {
    const empty = format2();
    const collections = empty.collections as Record<string, unknown[]>;
    for (const name of Object.keys(collections)) collections[name] = [];
    const data = upgradeSchema(empty) as unknown as Dataset;
    expect(validateDataset(data)).toEqual([]);
    expect(data.collections.budgets).toEqual([]);
    expect(data.collections.types).toEqual([]);
  });

  it("un fichier de synchronisation au format 2 est mis à niveau à la lecture", () => {
    const doc = { format: "finances-sync", fileId: "f", revision: 3, writtenAt: 1, writtenBy: "x", devices: {}, landed: {}, ...format2() };
    const parsed = parseSyncDocument(JSON.stringify(doc));
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.collections.budgets).toHaveLength(3);
  });
});

describe("parts réservées dans un compte (décision 78)", () => {
  const { cats, accs } = world();
  const project = defaultTypeId("projet");
  const lep = account("LEP", "epargne", { opening: eur(8800), typeIds: [PRECAUTION_TYPE_ID, project] });
  const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
  const base = dataset({
    categories: Object.values(cats),
    accounts: [accs.courant, lep],
    operations: months.map((m) => transfer(`2025-${m}-05`, eur(100), accs.courant.id, lep.id, { typeId: project })),
  });

  it("LEP à 10 000 €, 12 × 100 € rattachés au projet : projet 1 200 €, précaution 8 800 €", () => {
    const shares = typeShares(base, TODAY).get(lep.id)!;
    expect(shares.get(project)).toBe(eur(1200));
    expect(shares.get(PRECAUTION_TYPE_ID)).toBe(eur(8800));
    expect(safetyStatus(base, TODAY, TODAY).constituted).toBe(eur(8800));
  });

  it("un retrait rattaché au projet le diminue ; sans rattachement, il est pris sur le principal", () => {
    const data = applyChanges(base, {
      operations: [
        transfer("2026-01-10", eur(200), lep.id, accs.courant.id, { typeId: project }),
        transfer("2026-01-11", eur(50), lep.id, accs.courant.id),
      ],
    });
    const shares = typeShares(data, TODAY).get(lep.id)!;
    expect(shares.get(project)).toBe(eur(1000));
    expect(shares.get(PRECAUTION_TYPE_ID)).toBe(eur(8750));
  });

  it("une opération rattachée à un type que le compte ne porte pas revient au principal", () => {
    const data = applyChanges(base, { operations: [income("2026-01-12", eur(30), cats.salaire.id, lep.id, { typeId: defaultTypeId("placement") })] });
    expect(typeShares(data, TODAY).get(lep.id)!.get(PRECAUTION_TYPE_ID)).toBe(eur(8830));
  });

  it("les opérations datées après la date affichée n'y entrent pas", () => {
    expect(typeShares(base, "2025-06-30").get(lep.id)!.get(project)).toBe(eur(600));
  });
});

describe("validation du format 3", () => {
  const { cats, accs } = world();
  const ok = dataset({ categories: Object.values(cats), accounts: Object.values(accs) });

  it("le jeu de départ est valide", () => {
    expect(validateDataset(ok)).toEqual([]);
  });

  it("un type d'un autre budget que sa catégorie est refusé (décision 72)", () => {
    const wrong = { ...cats.loyer, typeId: defaultTypeId("placement") };
    expect(validateDataset(applyChanges(ok, { categories: [wrong] })).join()).toMatch(/n'appartient pas au budget/);
  });

  it("un revenu n'a ni budget ni type", () => {
    const wrong = { ...cats.salaire, budgetId: NEEDS };
    expect(validateDataset(applyChanges(ok, { categories: [wrong] })).join()).toMatch(/ni budget ni type/);
  });

  it("répartition : la somme fait 100 %, une clé peut viser un budget absent (décision 75)", () => {
    const sum = { ...ok, preferences: { ...ok.preferences, splits: { [NEEDS]: 5000, [WANTS]: 3000 } } };
    expect(validateDataset(sum).join()).toMatch(/somme doit valoir 10000/);
    const gone = { ...ok, preferences: { ...ok.preferences, splits: { [NEEDS]: 5000, [WANTS]: 3000, "budget-purge": 2000 } } };
    expect(validateDataset(gone)).toEqual([]);
  });

  it("un compte rattaché à un type inconnu, ou deux fois au même, est refusé", () => {
    expect(validateDataset(applyChanges(ok, { accounts: [{ ...accs.courant, typeIds: ["type-inconnu"] }] })).join()).toMatch(/typeIds : référence introuvable/);
    expect(validateDataset(applyChanges(ok, { accounts: [{ ...accs.courant, ...precaution, typeIds: [PRECAUTION_TYPE_ID, PRECAUTION_TYPE_ID] }] })).join()).toMatch(
      /typeIds invalide/,
    );
  });

  it("l'objectif d'un type a la forme de l'ancienne précaution", () => {
    const types = ok.collections.types.map((t) => (t.id === PRECAUTION_TYPE_ID ? { ...t, objective: { ...t.objective!, months: 0 } } : t));
    expect(validateDataset({ ...ok, collections: { ...ok.collections, types } }).join()).toMatch(/objective\.months invalide/);
  });

  it("une dépense dont le budget a été supprimé compte toujours dans ce budget", () => {
    const gone = ok.collections.budgets.map((b) => (b.id === WANTS ? { ...b, deletedAt: NOW, updatedAt: NOW } : b));
    const data = { ...ok, collections: { ...ok.collections, budgets: gone, operations: [expense("2026-09-03", eur(40), cats.resto.id, accs.courant.id)] } };
    expect(monthAggregates(data, "2026-09").byBudget).toEqual({ [WANTS]: eur(40) });
  });
});

describe("virements et budgets d'épargne (décision 80)", () => {
  const { cats, accs } = world();
  const formation = { id: "budget-formation", updatedAt: NOW, deletedAt: null, name: "Formation", nature: "save" as const, position: 4, color: 4 as const };
  const course = { id: "type-cours", updatedAt: NOW, deletedAt: null, budgetId: formation.id, name: "Cours", position: 1, objective: null };
  const charge = defaultTypeId("charges-fixes");
  const lep = account("LEP", "epargne", { typeIds: [course.id, PRECAUTION_TYPE_ID] });
  const livret = account("Livret", "epargne");
  const odd = account("Compte à terme", "epargne", { typeIds: [charge] });
  const base = dataset({ categories: Object.values(cats), accounts: [accs.courant, lep, livret, odd] });
  const data: Dataset = {
    ...base,
    collections: {
      ...base.collections,
      budgets: [...base.collections.budgets, formation],
      types: [...base.collections.types, course],
      operations: [
        transfer("2026-09-02", eur(300), accs.courant.id, lep.id),
        transfer("2026-09-03", eur(200), accs.courant.id, livret.id),
        transfer("2026-09-04", eur(50), lep.id, accs.courant.id),
        transfer("2026-09-05", eur(40), accs.courant.id, odd.id),
      ],
    },
  };
  const a = monthAggregates(data, "2026-09");

  it("vers un compte, dans le budget de son type principal ; retirés, ils en sortent", () => {
    expect(budgetActual(a, formation)).toBe(eur(300 - 50));
  });

  it("sans type, ou avec un type principal d'un budget de dépense, dans le budget « Épargne » par défaut", () => {
    expect(budgetActual(a, { id: SAVED })).toBe(eur(200 + 40));
    expect(budgetActual(a, { id: NEEDS })).toBe(0);
  });

  it("la mise de côté du mois reste la somme de tous les virements nets", () => {
    expect(a.saved).toBe(eur(300 + 200 - 50 + 40));
  });
});
