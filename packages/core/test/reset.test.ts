import { describe, expect, it } from "vitest";
import {
  applyChanges,
  COLLECTION_NAMES,
  defaultCategories,
  defaultPreferences,
  eraseEverything,
  hasLiveRecords,
  mergeDatasets,
  RENAMED_AT,
  setPreference,
  startingCategories,
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

describe("catégories par défaut de l'écran d'accueil", () => {
  it("horodatées 0 sur un appareil neuf, RENAMED_AT pour les noms remplacés (décision 68)", () => {
    const start = startingCategories(dataset({}), NOW);
    expect(start.every((c) => c.deletedAt === null)).toBe(true);
    expect(start.filter((c) => c.updatedAt !== 0).map((c) => [c.name, c.updatedAt])).toEqual([
      ["Revenus annexes", RENAMED_AT],
      ["Activité indépendante", RENAMED_AT],
      ["Revenus de placements", RENAMED_AT],
      ["Autres placements", RENAMED_AT],
    ]);
  });

  it("décision 68 : le nouveau nom gagne sur l'ancien jamais modifié, pas sur un nom choisi", () => {
    const renamed = startingCategories(dataset({}), NOW).find((c) => c.name === "Activité indépendante")!;
    const untouched = { ...renamed, name: "Missions freelance", updatedAt: 0 };
    const legacy = { ...renamed, name: "Missions freelance", updatedAt: 1 };
    const chosen = { ...renamed, name: "Mon activité", updatedAt: NOW };
    const merged = (mine: typeof renamed) =>
      mergeDatasets(dataset({ categories: [mine] }), dataset({ categories: [renamed] })).data.collections.categories[0]!.name;
    expect(merged(untouched)).toBe("Activité indépendante");
    expect(merged(legacy)).toBe("Activité indépendante");
    expect(merged(chosen)).toBe("Mon activité");
  });

  it("après une remise à zéro partout, elles reviennent et l'emportent sur la suppression", () => {
    const data = sample();
    const { changes, preferences } = eraseEverything(data, NOW);
    const erased = applyChanges({ ...data, preferences }, changes);
    const restarted = applyChanges(erased, { categories: startingCategories(erased, NOW + 1000) });
    expect(restarted.collections.categories.filter((c) => c.deletedAt === null)).toHaveLength(defaultCategories().length);
    // Fusion avec un appareil qui n'a que l'effacement : les catégories restent vivantes.
    const merged = mergeDatasets(restarted, erased).data;
    expect(merged.collections.categories.filter((c) => c.deletedAt === null)).toHaveLength(defaultCategories().length);
    expect(hasLiveRecords(merged)).toBe(true);
  });
});
