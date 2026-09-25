import "fake-indexeddb/auto";
import { applyChanges, emptyDataset, SCHEMA_VERSION, type Dataset } from "@cashmyr/core";
import { openDB } from "idb";
import { describe, expect, it } from "vitest";
import { Repository } from "../src";
import { TauriFileLocalStore } from "../src/tauri";
import { IndexedDbLocalStore } from "../src/web";
import { Clock, MemoryFs, MemoryKv, seed, TODAY } from "./fakes";

/** Les données telles que la version 0.1 les écrivait : format 1, sans collection des tags. */
function formatOne(): Record<string, unknown> {
  const data: Dataset = applyChanges(emptyDataset(), seed);
  const { tags: _tags, ...collections } = data.collections;
  return { ...data, schemaVersion: 1, collections };
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
    expect((await local.readSnapshot("1")).collections.tags).toEqual([]);
  });
});
