import { describe, expect, it } from "vitest";
import {
  applyChanges,
  budgetWeight,
  createBudget,
  createType,
  defaultBudgetId,
  defaultTypeId,
  deleteBudget,
  deleteType,
  liveBudgetsOf,
  monthAggregates,
  moveBudget,
  PRECAUTION_TYPE_ID,
  reservableTypes,
  safetyStatus,
  SAVINGS_BUDGET_ID,
  setAccountTypes,
  typeHolding,
  typesOf,
  UsageError,
  validateDataset,
  type Dataset,
} from "../src";
import { account, category, dataset, eur, expense, NOW, TODAY, transfer, world } from "./fixtures";

const [NEEDS, WANTS] = (["besoin", "envie"] as const).map(defaultBudgetId) as [string, string];
const project = defaultTypeId("projet");
const apply = (data: Dataset, step: { changes: Parameters<typeof applyChanges>[1]; preferences: Dataset["preferences"] }) =>
  applyChanges({ ...data, preferences: step.preferences }, step.changes);

describe("créer et ordonner (décisions 71 et 72)", () => {
  const { cats, accs } = world();
  const base = dataset({ categories: Object.values(cats), accounts: Object.values(accs) });

  it("un budget arrive après les autres ; un type, après ceux de son budget", () => {
    const formation = createBudget(base, "  Formation ", "save", NOW);
    expect(formation).toMatchObject({ name: "Formation", nature: "save", position: 4, deletedAt: null });
    const data = applyChanges(base, { budgets: [formation] });
    const course = createType(data, formation.id, "Cours", NOW);
    expect(course).toMatchObject({ budgetId: formation.id, position: 1, objective: null });
    expect(createType(data, NEEDS, "Énergie", NOW).position).toBe(4);
    expect(validateDataset(applyChanges(data, { types: [course] }))).toEqual([]);
    expect(() => createBudget(base, "  ", "spend", NOW)).toThrow(UsageError);
  });

  it("déplacer un budget réécrit les positions dans le nouvel ordre", () => {
    const after = applyChanges(base, moveBudget(base, WANTS, -1, NOW));
    expect(liveBudgetsOf(after).map((b) => b.name)).toEqual(["Loisirs", "Dépenses courantes", "Épargne"]);
    expect(moveBudget(base, NEEDS, -1, NOW)).toEqual({});
  });
});

describe("supprimer un type (décision 84)", () => {
  const { cats, accs } = world();
  const lep = account("LEP", "epargne", { opening: eur(8800), typeIds: [project, PRECAUTION_TYPE_ID] });
  const savings = { ...category("Projet maison", "out", "invest"), typeId: project };
  const base = dataset({
    categories: [...Object.values(cats), savings],
    accounts: [accs.courant, lep],
    operations: [transfer("2026-01-05", eur(1200), accs.courant.id, lep.id, { typeId: project })],
  });

  it("LEP [Projet, Précaution] : Projet supprimé, ses 1 200 € reviennent à la précaution", () => {
    expect(typeHolding(base, project, TODAY)).toBe(eur(10_000));
    // Projet est ici le type principal : il prend le reste du compte.
    const asSecond = applyChanges(base, { accounts: [{ ...lep, typeIds: [PRECAUTION_TYPE_ID, project] }] });
    expect(typeHolding(asSecond, project, TODAY)).toBe(eur(1200));
    const after = applyChanges(asSecond, deleteType(asSecond, project, NOW));
    expect(safetyStatus(after, TODAY, TODAY).constituted).toBe(eur(10_000));
    expect(after.collections.accounts.find((a) => a.id === lep.id)!.typeIds).toEqual([PRECAUTION_TYPE_ID]);
    expect(after.collections.categories.find((c) => c.id === savings.id)).not.toHaveProperty("typeId");
    // Le rattachement de l'opération reste.
    expect(after.collections.operations[0]!.typeId).toBe(project);
    expect(validateDataset(after)).toEqual([]);
  });

  it("le type principal retiré laisse la place au suivant", () => {
    const after = applyChanges(base, deleteType(base, project, NOW));
    expect(after.collections.accounts.find((a) => a.id === lep.id)!.typeIds).toEqual([PRECAUTION_TYPE_ID]);
  });

  it("l'épargne de précaution ne se supprime pas (décision 85)", () => {
    expect(() => deleteType(base, PRECAUTION_TYPE_ID, NOW)).toThrow(UsageError);
  });
});

describe("supprimer un budget (point 13, décisions 86 et 87)", () => {
  const { cats, accs } = world();
  const formation = { id: "budget-formation", updatedAt: 1, deletedAt: null, name: "Formation", nature: "save" as const, position: 4, color: 4 as const };
  const course = { id: "type-cours", updatedAt: 1, deletedAt: null, budgetId: formation.id, name: "Cours", position: 1, objective: null };
  const books = { ...category("Livres", "out"), budgetId: formation.id, typeId: course.id };
  const lep = account("LEP", "epargne", { typeIds: [course.id, PRECAUTION_TYPE_ID] });
  const base0 = dataset({ categories: [...Object.values(cats), books], accounts: [accs.courant, lep] });
  const base: Dataset = {
    ...base0,
    collections: {
      ...base0.collections,
      budgets: [...base0.collections.budgets, formation],
      types: [...base0.collections.types, course],
      operations: [expense("2026-08-10", eur(700), books.id, accs.courant.id), expense("2026-09-10", eur(500), books.id, accs.courant.id)],
    },
    preferences: { ...base0.preferences, splits: { [NEEDS]: 5000, [WANTS]: 3000, [SAVINGS_BUDGET_ID]: 1000, [formation.id]: 1000 } },
  };

  it("Formation (10 %) supprimé vers Épargne (10 %) : catégories, types, comptes et part suivent", () => {
    expect(budgetWeight(base, formation.id)).toEqual({ count: 2, amount: eur(1200) });
    const after = apply(base, deleteBudget(base, formation.id, SAVINGS_BUDGET_ID, NOW));
    expect(validateDataset(after)).toEqual([]);
    expect(after.preferences.splits).toEqual({ [NEEDS]: 5000, [WANTS]: 3000, [SAVINGS_BUDGET_ID]: 2000 });
    const moved = after.collections.categories.find((c) => c.id === books.id)!;
    expect(moved.budgetId).toBe(SAVINGS_BUDGET_ID);
    expect(moved).not.toHaveProperty("typeId");
    expect(typesOf(after, formation.id)).toEqual([]);
    expect(after.collections.accounts.find((a) => a.id === lep.id)!.typeIds).toEqual([PRECAUTION_TYPE_ID]);
    // Les mois passés changent de budget, montant à l'appui.
    expect(monthAggregates(after, "2026-08").byBudget).toEqual({ [SAVINGS_BUDGET_ID]: eur(700) });
  });

  it("ni le budget « Épargne », ni le dernier budget, ni vers lui-même", () => {
    expect(() => deleteBudget(base, SAVINGS_BUDGET_ID, NEEDS, NOW)).toThrow(/Épargne/);
    expect(() => deleteBudget(base, NEEDS, NEEDS, NOW)).toThrow(UsageError);
    const alone = { ...base, collections: { ...base.collections, budgets: base.collections.budgets.filter((b) => b.id === WANTS) } };
    expect(() => deleteBudget(alone, WANTS, SAVINGS_BUDGET_ID, NOW)).toThrow(/au moins un budget/);
  });
});

describe("types d'un compte et parts à réserver (décisions 77 et 78)", () => {
  const { cats, accs } = world();
  const base = dataset({ categories: Object.values(cats), accounts: Object.values(accs) });

  it("le premier type est le principal ; une liste vide retire le champ", () => {
    const lep = setAccountTypes(accs.livret, [PRECAUTION_TYPE_ID, project, project], NOW);
    expect(lep.typeIds).toEqual([PRECAUTION_TYPE_ID, project]);
    expect(setAccountTypes(lep, [], NOW + 1)).not.toHaveProperty("typeIds");
    expect(validateDataset(applyChanges(base, { accounts: [lep] }))).toEqual([]);
  });

  it("on réserve aux types des comptes touchés, hors principal", () => {
    const lep = setAccountTypes(accs.livret, [PRECAUTION_TYPE_ID, project], NOW);
    const pea = setAccountTypes(accs.pea, [defaultTypeId("placement"), project], NOW);
    const data = applyChanges(base, { accounts: [lep, pea] });
    expect(reservableTypes(data, [accs.courant.id, lep.id]).map((t) => t.id)).toEqual([project]);
    expect(reservableTypes(data, [lep.id, pea.id]).map((t) => t.id)).toEqual([project]);
    expect(reservableTypes(data, [accs.courant.id, undefined])).toEqual([]);
  });
});
