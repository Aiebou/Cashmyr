import { describe, expect, it } from "vitest";
import {
  colorFor,
  defaultPreferences,
  DASH_BLOCKS,
  hasCustomColor,
  mergePreferences,
  normalizeDashOrder,
  setBucketColor,
  setIncomeColor,
} from "../src";
import { category } from "./fixtures";

const salary = { ...category("Salaire", "in"), color: 2 as const };

describe("accesseur de couleur", () => {
  const prefs = defaultPreferences();

  it("par défaut, la variable CSS du thème", () => {
    expect(colorFor(prefs, { kind: "income", category: salary })).toBe("var(--series-2)");
    expect(colorFor(prefs, { kind: "bucket", bucket: "besoin" })).toBe("var(--bucket-besoin)");
    expect(colorFor(prefs, { kind: "series", color: 5 })).toBe("var(--series-5)");
    expect(hasCustomColor(prefs, { kind: "income", category: salary })).toBe(false);
  });

  it("la valeur personnalisée est prioritaire", () => {
    const custom = setBucketColor(setIncomeColor(prefs, salary.id, "#AA3300", 10), "envie", "#112233", 11);
    expect(colorFor(custom, { kind: "income", category: salary })).toBe("#aa3300");
    expect(colorFor(custom, { kind: "bucket", bucket: "envie" })).toBe("#112233");
    expect(colorFor(custom, { kind: "bucket", bucket: "besoin" })).toBe("var(--bucket-besoin)");
    expect(hasCustomColor(custom, { kind: "income", category: salary })).toBe(true);
    expect(custom.updatedAt).toMatchObject({ categoryColors: 10, bucketColors: 11 });
  });

  it("retour à la valeur par défaut après réinitialisation", () => {
    const custom = setIncomeColor(prefs, salary.id, "#aa3300", 10);
    const reset = setBucketColor(setIncomeColor(custom, salary.id, null, 20), "envie", null, 21);
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
    const b = setBucketColor(prefs, "invest", "#00aa00", 12);
    const { merged } = mergePreferences(a, b);
    expect(merged.categoryColors).toEqual({ [salary.id]: "#aa3300" });
    expect(merged.bucketColors).toEqual({ invest: "#00aa00" });
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
