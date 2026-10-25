import { describe, expect, it } from "vitest";
import {
  colorFor,
  defaultPreferences,
  DASH_BLOCKS,
  defaultBudgets,
  hasCustomColor,
  mergePreferences,
  normalizeDashOrder,
  setBudgetColor,
  setIncomeColor,
} from "../src";
import { category } from "./fixtures";

const salary = { ...category("Salaire", "in"), color: 2 as const };
const [needs, wants, saved] = defaultBudgets();
const added = { id: "budget-formation", color: 4 as const };

describe("accesseur de couleur", () => {
  const prefs = defaultPreferences();

  it("par défaut, la variable CSS du thème", () => {
    expect(colorFor(prefs, { kind: "income", category: salary })).toBe("var(--series-2)");
    // Décision 76 : les budgets par défaut gardent la couleur du thème de leur usage, un budget ajouté prend sa série.
    expect(colorFor(prefs, { kind: "budget", budget: needs! })).toBe("var(--bucket-besoin)");
    expect(colorFor(prefs, { kind: "budget", budget: saved! })).toBe("var(--bucket-invest)");
    expect(colorFor(prefs, { kind: "budget", budget: added })).toBe("var(--series-4)");
    expect(colorFor(prefs, { kind: "series", color: 5 })).toBe("var(--series-5)");
    expect(hasCustomColor(prefs, { kind: "income", category: salary })).toBe(false);
  });

  it("la valeur personnalisée est prioritaire", () => {
    const custom = setBudgetColor(setIncomeColor(prefs, salary.id, "#AA3300", 10), wants!.id, "#112233", 11);
    expect(colorFor(custom, { kind: "income", category: salary })).toBe("#aa3300");
    expect(colorFor(custom, { kind: "budget", budget: wants! })).toBe("#112233");
    expect(colorFor(custom, { kind: "budget", budget: needs! })).toBe("var(--bucket-besoin)");
    expect(hasCustomColor(custom, { kind: "income", category: salary })).toBe(true);
    expect(custom.updatedAt).toMatchObject({ categoryColors: 10, budgetColors: 11 });
  });

  it("retour à la valeur par défaut après réinitialisation", () => {
    const custom = setIncomeColor(prefs, salary.id, "#aa3300", 10);
    const reset = setBudgetColor(setIncomeColor(custom, salary.id, null, 20), wants!.id, null, 21);
    expect(colorFor(reset, { kind: "income", category: salary })).toBe("var(--series-2)");
    expect(hasCustomColor(reset, { kind: "income", category: salary })).toBe(false);
    expect(reset.categoryColors).toEqual({});
    expect(reset.updatedAt.categoryColors).toBe(20);
  });

  it("refuse ce qui n'est pas une couleur #rrggbb", () => {
    expect(() => setIncomeColor(prefs, salary.id, "red", 1)).toThrow(RangeError);
  });

  it("se synchronise comme toute préférence, clé par clé", () => {
    const a = setIncomeColor(prefs, salary.id, "#aa3300", 10);
    const b = setBudgetColor(prefs, saved!.id, "#00aa00", 12);
    const { merged } = mergePreferences(a, b);
    expect(merged.categoryColors).toEqual({ [salary.id]: "#aa3300" });
    expect(merged.budgetColors).toEqual({ [saved!.id]: "#00aa00" });
  });
});

describe("ordre des blocs du tableau de bord", () => {
  it("par défaut : objectifs, dettes, indicateurs, 12 mois, épargne, postes", () => {
    expect(defaultPreferences().dashOrder).toEqual(["goals", "debts", "stats", "months", "savings", "cats"]);
  });

  it("un ordre enregistré sans le bloc dettes le reçoit en fin de liste", () => {
    expect(normalizeDashOrder(["cats", "goals", "stats", "months", "savings"])).toEqual([
      "cats",
      "goals",
      "stats",
      "months",
      "savings",
      "debts",
    ]);
  });

  it("retire les clés inconnues et les doublons", () => {
    expect(normalizeDashOrder(["stats", "inconnu", "stats", "goals"])).toEqual([
      "stats",
      "goals",
      ...DASH_BLOCKS.filter((b) => b !== "stats" && b !== "goals"),
    ]);
  });
});
