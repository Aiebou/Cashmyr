import { describe, expect, it } from "vitest";
import {
  applyChanges,
  COLLECTION_NAMES,
  defaultCategories,
  defaultPreferences,
  eraseEverything,
  hasLiveRecords,
  DEFAULTS_AT,
  mergeDatasets,
  setPreference,
  startingDefaults,
  validateDataset,
  tombstone,
  touch,
  type Dataset,
} from "../src";
import { dataset, eur, expense, NOW, world } from "./fixtures";

const { cats, accs } = world();

function sample(): Dataset {
  const data = dataset(
    {
      categories: [...defaultCategories(), ...Object.values(cats)],
      accounts: Object.values(accs),
      operations: [expense("2026-09-05", eur(80), cats.courses.id, accs.courant.id)],
    },
    {},
  );
  const prefs = setPreference(data.preferences, "averageWindow", 12, NOW - 1000);
  return { ...data, preferences: prefs };
}
const live = (data: Dataset) => COLLECTION_NAMES.reduce((n, name) => n + data.collections[name].filter((r) => r.deletedAt === null).length, 0);

describe("remise à zéro partout (décision 45)", () => {
  it("chaque ligne vivante devient une suppression, chaque réglage reprend sa valeur par défaut", () => {
    const data = sample();
    const gone = tombstone(accs.pea, NOW - 5000);
    const withDeleted = applyChanges(data, { accounts: [gone] });
    const { changes, preferences } = eraseEverything(withDeleted, NOW);
    const after = applyChanges({ ...withDeleted, preferences }, changes);
    expect(live(after)).toBe(0);
    expect(hasLiveRecords(after)).toBe(false);
    // Une ligne déjà supprimée n'est pas réécrite.
    expect(changes.accounts?.some((a) => a.id === gone.id)).toBe(false);
    expect(changes.operations?.[0]).toMatchObject({ updatedAt: NOW, deletedAt: NOW });
    expect(preferences.averageWindow).toBe(defaultPreferences().averageWindow);
    expect(preferences.updatedAt.averageWindow).toBe(NOW);
    expect(preferences.updatedAt.theme).toBe(NOW);
  });

  it("l'effacement gagne à la fusion sur les versions plus anciennes ; une modification plus récente revient", () => {
    const other = sample();
    const { changes, preferences } = eraseEverything(other, NOW);
    const erased = applyChanges({ ...other, preferences }, changes);
    const edited = touch(other.collections.accounts[0]!, { name: "Renommé après" }, NOW + 60_000);
    const remote = applyChanges(other, { accounts: [edited] });
    const merged = mergeDatasets(erased, remote).data;
    expect(merged.collections.accounts.filter((a) => a.deletedAt === null).map((a) => a.name)).toEqual(["Renommé après"]);
    expect(merged.collections.operations.every((o) => o.deletedAt !== null)).toBe(true);
    expect(merged.preferences.averageWindow).toBe(defaultPreferences().averageWindow);
  });
});

describe("budgets, types et catégories par défaut de l'écran d'accueil", () => {
  it("horodatés DEFAULTS_AT sur un appareil neuf (décisions 71 à 73)", () => {
    const start = startingDefaults(dataset({}), NOW);
    const all = [...start.budgets, ...start.types, ...start.categories];
    expect(all.every((r) => r.deletedAt === null && r.updatedAt === DEFAULTS_AT)).toBe(true);
    expect(start.budgets.map((b) => [b.name, b.nature])).toEqual([
      ["Dépenses courantes", "spend"],
      ["Loisirs", "spend"],
      ["Épargne", "save"],
    ]);
    expect(start.types.map((t) => t.name)).toEqual(["Charges fixes", "Quotidien", "Charge ponctuelle", "Épargne de précaution", "Placement", "Projet"]);
    expect(start.categories).toHaveLength(23);
    expect(validateDataset(applyChanges(dataset({}), start))).toEqual([]);
  });

  it("le nouveau nom gagne sur l'ancien jamais modifié, pas sur un nom choisi", () => {
    const renamed = startingDefaults(dataset({}), NOW).categories.find((c) => c.name === "Sorties")!;
    const untouched = { ...renamed, name: "Sorties et loisirs", updatedAt: 0 };
    const legacy = { ...renamed, name: "Sorties et loisirs", updatedAt: 1 };
    const chosen = { ...renamed, name: "Mes sorties", updatedAt: NOW };
    const merged = (mine: typeof renamed) =>
      mergeDatasets(dataset({ categories: [mine] }), dataset({ categories: [renamed] })).data.collections.categories[0]!.name;
    expect(merged(untouched)).toBe("Sorties");
    expect(merged(legacy)).toBe("Sorties");
    expect(merged(chosen)).toBe("Mes sorties");
  });

  it("après une remise à zéro partout, ils reviennent et l'emportent sur la suppression", () => {
    const data = sample();
    const { changes, preferences } = eraseEverything(data, NOW);
    const erased = applyChanges({ ...data, preferences }, changes);
    const restarted = applyChanges(erased, startingDefaults(erased, NOW + 1000));
    expect(restarted.collections.categories.filter((c) => c.deletedAt === null)).toHaveLength(defaultCategories().length);
    expect(restarted.collections.budgets.filter((b) => b.deletedAt === null)).toHaveLength(3);
    // Fusion avec un appareil qui n'a que l'effacement : tout reste vivant.
    const merged = mergeDatasets(restarted, erased).data;
    expect(merged.collections.categories.filter((c) => c.deletedAt === null)).toHaveLength(defaultCategories().length);
    expect(merged.collections.types.filter((t) => t.deletedAt === null)).toHaveLength(6);
    expect(hasLiveRecords(merged)).toBe(true);
  });
});
