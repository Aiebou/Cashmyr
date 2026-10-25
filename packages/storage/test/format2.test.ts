import "fake-indexeddb/auto";
import { applyChanges, BUCKETS, defaultBudgetId, emptyDataset, SCHEMA_VERSION, type Dataset } from "@cashmyr/core";
import { openDB } from "idb";
import { describe, expect, it } from "vitest";
import { Repository } from "../src";
import { TauriFileLocalStore } from "../src/tauri";
import { IndexedDbLocalStore } from "../src/web";
import { Clock, MemoryFs, MemoryKv, seed, TODAY } from "./fakes";

const BUCKET_OF: Record<string, string> = Object.fromEntries(BUCKETS.map((b) => [defaultBudgetId(b), b]));

/**
 * Les données telles que la version 0.1 les écrivait : format 1, sans tags, budgets ni types ; les
 * catégories ont un usage, les comptes une case « précaution ».
 */
function formatOne(): Record<string, unknown> {
  const data: Dataset = applyChanges(emptyDataset(), { categories: seed.categories, accounts: seed.accounts });
  const { tags: _tags, budgets: _budgets, types: _types, ...collections } = data.collections;
  const { splits, budgetColors: _colors, updatedAt, ...prefs } = data.preferences;
  return {
    ...data,
    schemaVersion: 1,
    collections: {
      ...collections,
      categories: collections.categories.map(({ budgetId, ...c }) => (budgetId ? { ...c, bucket: BUCKET_OF[budgetId] } : c)),
      accounts: collections.accounts.map((a) => ({ ...a, safety: false })),
    },
    preferences: {
      ...prefs,
      splits: Object.fromEntries(Object.entries(splits).map(([id, bp]) => [BUCKET_OF[id], bp])),
      safety: { mode: "months", months: 4, amount: 0, hidden: false, pinned: true },
      bucketColors: {},
      updatedAt: { ...updatedAt, safety: 0, bucketColors: 0 },
    },
  };
}

describe("mise à niveau des données locales au format 2 (décision 50)", () => {
  it("bureau : data.json du format 1 est lu, mis à niveau puis réécrit ; ses copies se lisent au format courant", async () => {
    const fs = new MemoryFs();
    const old = formatOne();
    fs.files.set("data.json", JSON.stringify(old));
    fs.files.set("backups/data-1.json", JSON.stringify(old));
    const local = new TauriFileLocalStore(fs, new MemoryKv());
    const clock = new Clock();
    const repo = await Repository.open({ local, deviceLabel: "Mac", now: clock.now, today: () => TODAY });
    await repo.flush();
    expect(repo.data.schemaVersion).toBe(SCHEMA_VERSION);
    const written = JSON.parse(fs.files.get("data.json")!) as Dataset;
    expect(written.schemaVersion).toBe(SCHEMA_VERSION);
    expect(written.collections.tags).toEqual([]);
    expect(written.collections.accounts).toEqual(seed.accounts);
    // Et jusqu'au format 3 : les budgets par défaut, les catégories rangées dedans (décision 81).
    expect(written.collections.budgets).toHaveLength(3);
    expect(written.collections.categories.map((c) => c.budgetId)).toEqual(seed.categories.map((c) => c.budgetId));
    expect((await local.readSnapshot("1")).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("web : une base IndexedDB de la version 0.1 gagne le magasin des tags et passe au format 2", async () => {
    const name = "base-0-1";
    const old = formatOne() as { collections: Record<string, { id: string }[]>; preferences: unknown };
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        for (const c of Object.keys(old.collections)) db.createObjectStore(c, { keyPath: "id" });
        db.createObjectStore("meta");
        db.createObjectStore("snapshots", { keyPath: "id" });
      },
    });
    for (const [c, rows] of Object.entries(old.collections)) for (const r of rows) await v1.put(c, r);
    await v1.put("meta", old.preferences, "preferences");
    await v1.put("meta", 1, "schemaVersion");
    await v1.put("snapshots", { id: "1", takenAt: 1, bytes: 10, json: JSON.stringify(old) });
    v1.close();

    const local = await IndexedDbLocalStore.open(name);
    const clock = new Clock();
    const repo = await Repository.open({ local, deviceLabel: "Chrome", now: clock.now, today: () => TODAY });
    expect(repo.data.collections.accounts).toEqual(seed.accounts);
    const reloaded = await local.load();
    expect(reloaded?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(reloaded?.collections.tags).toEqual([]);
    expect(reloaded?.collections.types).toHaveLength(6);
    expect((await local.readSnapshot("1")).collections.tags).toEqual([]);
  });
});
