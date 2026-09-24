import "fake-indexeddb/auto";
import { applyChanges, emptyDataset, setPreference, type Dataset } from "@cashmyr/core";
import { describe, expect, it } from "vitest";
import type { DeviceState, LocalStore } from "../src";
import { LocalFileCorruptedError, localRecoverySteps, TauriFileLocalStore } from "../src/tauri";
import { IndexedDbLocalStore } from "../src/web";
import { MemoryFs, MemoryKv, op, seed, T0 } from "./fakes";

let dbCount = 0;
const makers: [string, () => Promise<LocalStore>][] = [
  ["IndexedDB", () => IndexedDbLocalStore.open(`test-${++dbCount}`)],
  ["fichier Tauri", async () => new TauriFileLocalStore(new MemoryFs(), new MemoryKv())],
];

const base: Dataset = applyChanges(emptyDataset(), seed);
const device: DeviceState = {
  deviceId: "dev-1",
  deviceLabel: "Mac",
  sync: { fileId: null, targetName: null, lastMergeAt: null, lastOfferAt: null, lastError: null },
  dirty: { "operations:x": 3 },
};

const sortById = (d: Dataset) => ({
  ...d,
  collections: Object.fromEntries(
    Object.entries(d.collections).map(([k, v]) => [k, [...v].sort((a, b) => a.id.localeCompare(b.id))]),
  ),
});

describe.each(makers)("stockage local : %s", (_, make) => {
  it("vide au premier lancement", async () => {
    const store = await make();
    expect(await store.load()).toBeNull();
    expect(await store.getDevice()).toBeNull();
    expect(await store.snapshot(T0)).toBeNull();
  });

  it("relit exactement ce qu'il a écrit, par écritures incrémentales", async () => {
    const store = await make();
    await store.apply(seed, base.preferences);
    const prefs = setPreference(base.preferences, "theme", "dark", 5);
    await store.apply({ operations: [op("op-1", "2026-09-01", 1250, "cat-courses", "acc-courant", 2)] }, prefs);
    await store.apply({ operations: [op("op-1", "2026-09-01", 1300, "cat-courses", "acc-courant", 3)] });
    await store.flush();
    const loaded = (await store.load())!;
    expect(loaded.preferences.theme).toBe("dark");
    expect(loaded.collections.operations).toEqual([op("op-1", "2026-09-01", 1300, "cat-courses", "acc-courant", 3)]);
    expect(sortById({ ...loaded, collections: { ...loaded.collections, operations: [] } })).toEqual(
      sortById({ ...base, preferences: prefs }),
    );
  });

  it("remplace tout le jeu", async () => {
    const store = await make();
    await store.apply(seed, base.preferences);
    const other = applyChanges(emptyDataset(), { accounts: [seed.accounts[0]!] });
    await store.replace(other);
    await store.flush();
    expect(await store.load()).toEqual(other);
  });

  it("garde les cinq copies de sauvegarde les plus récentes", async () => {
    const store = await make();
    await store.apply(seed, base.preferences);
    for (let i = 0; i < 7; i++) {
      await store.apply({ operations: [op(`op-${i}`, "2026-09-01", 100 + i, "cat-courses", "acc-courant", 2)] });
      await store.snapshot(T0 + i);
    }
    const list = await store.listSnapshots();
    expect(list.map((s) => s.takenAt)).toEqual([T0 + 6, T0 + 5, T0 + 4, T0 + 3, T0 + 2]);
    expect(list.every((s) => s.bytes > 0)).toBe(true);
    const third = await store.readSnapshot(String(T0 + 2));
    expect(third.collections.operations).toHaveLength(3);
  });

  it("conserve l'état de l'appareil", async () => {
    const store = await make();
    await store.setDevice(device);
    expect(await store.getDevice()).toEqual(device);
  });
});

describe("fichier local du bureau : écriture atomique", () => {
  it("écrit dans un fichier temporaire puis le renomme", async () => {
    const fs = new MemoryFs();
    const store = new TauriFileLocalStore(fs, new MemoryKv());
    await store.apply(seed, base.preferences);
    expect(fs.log).toEqual(["write data.json.tmp", "rename data.json.tmp → data.json"]);
    expect([...fs.files.keys()]).toEqual(["data.json"]);
  });

  it("une panne pendant l'écriture laisse le fichier précédent intact", async () => {
    const fs = new MemoryFs();
    const store = new TauriFileLocalStore(fs, new MemoryKv());
    await store.apply(seed, base.preferences);
    const before = fs.files.get("data.json");
    for (const failing of ["writeTextFile", "rename"]) {
      fs.failNext = failing;
      await expect(
        store.apply({ operations: [op("op-x", "2026-09-01", 1, "cat-courses", "acc-courant", 2)] }),
      ).rejects.toThrow("panne simulée");
      expect(fs.files.get("data.json")).toBe(before);
    }
    // L'écriture suivante réussit et emporte tout ce qui est en mémoire.
    await store.apply({});
    expect(JSON.parse(fs.files.get("data.json")!).collections.operations).toHaveLength(1);
  });

  it("regroupe les écritures rapprochées", async () => {
    const fs = new MemoryFs();
    const store = new TauriFileLocalStore(fs, new MemoryKv());
    const writes = [0, 1, 2, 3].map((i) =>
      store.apply(i === 0 ? seed : { operations: [op(`op-${i}`, "2026-09-01", i, "cat-courses", "acc-courant", 2)] }, base.preferences),
    );
    await Promise.all(writes);
    expect(fs.log.filter((l) => l.startsWith("rename")).length).toBeLessThanOrEqual(2);
    expect(JSON.parse(fs.files.get("data.json")!).collections.operations).toHaveLength(3);
  });

  it("signale un fichier local illisible au lieu de repartir de zéro", async () => {
    const fs = new MemoryFs();
    fs.files.set("data.json", '{"schemaVersion":1,"collec');
    await expect(new TauriFileLocalStore(fs, new MemoryKv()).load()).rejects.toThrow(LocalFileCorruptedError);
  });

  it("un fichier refusé au chargement n'est ni réécrit ni copié : les copies restent bonnes", async () => {
    const fs = new MemoryFs();
    const store = new TauriFileLocalStore(fs, new MemoryKv());
    await store.replace(emptyDataset());
    await store.snapshot(1000);
    const good = fs.files.get("backups/data-1000.json");
    fs.files.set("data.json", "{abîmé");
    await expect(store.load()).rejects.toThrow(LocalFileCorruptedError);
    expect(fs.files.get("data.json")).toBe("{abîmé");
    expect([...fs.files.keys()].filter((k) => k.startsWith("backups/"))).toEqual(["backups/data-1000.json"]);
    expect(fs.files.get("backups/data-1000.json")).toBe(good);
  });

  it("marche à suivre : le vrai dossier, le séparateur du système, data.json gardé de côté", () => {
    const mac = localRecoverySteps("/Users/moi/Library/Application Support/io.github.aiebou.cashmyr");
    expect(mac[1]).toContain("/Users/moi/Library/Application Support/io.github.aiebou.cashmyr");
    expect(mac[2]).toContain("data-illisible.json");
    expect(mac[3]).toContain("io.github.aiebou.cashmyr/backups");
    expect(mac[3]).toContain("renomme-la data.json");
    const windows = localRecoverySteps("C:\\Users\\moi\\AppData\\Roaming\\io.github.aiebou.cashmyr");
    expect(windows[3]).toContain("io.github.aiebou.cashmyr\\backups");
  });
});

describe("IndexedDB : magasin meta", () => {
  it("garde une valeur libre (handle du fichier de synchronisation) et l'oublie", async () => {
    const store = await IndexedDbLocalStore.open(`test-${++dbCount}`);
    await store.setMeta("syncHandle", { name: "finances-sync.json" });
    expect(await store.getMeta("syncHandle")).toEqual({ name: "finances-sync.json" });
    await store.setMeta("syncHandle", null);
    expect(await store.getMeta("syncHandle")).toBeUndefined();
  });
});
