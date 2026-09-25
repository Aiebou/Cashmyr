import "fake-indexeddb/auto";
import { SCHEMA_VERSION } from "@cashmyr/core";
import { describe, expect, it } from "vitest";
import { LocalDataError, recoverLocalData, recoveryCopies, Repository, type LocalStore } from "../src";
import { TauriFileLocalStore } from "../src/tauri";
import { IndexedDbLocalStore } from "../src/web";
import { Clock, MemoryFs, MemoryKv, op, seed, TODAY } from "./fakes";

/** Opération au montant non entier : refusée par la validation. */
const invalid = op("op-x", "2026-09-01", 12.5, "cat-courses", "acc-courant", 2);

function desktop(fs = new MemoryFs()) {
  const clock = new Clock();
  const local = new TauriFileLocalStore(fs, new MemoryKv());
  const open = () => Repository.open({ local, deviceLabel: "Mac", now: clock.now, today: () => TODAY });
  return { clock, fs, local, open };
}

let dbCount = 0;
async function web() {
  const clock = new Clock();
  const local = await IndexedDbLocalStore.open(`secours-${++dbCount}`);
  const open = () => Repository.open({ local, deviceLabel: "Chrome · Mac", now: clock.now, today: () => TODAY });
  return { clock, local, open };
}

/** Données de départ, une copie prise à l'ouverture suivante, puis des données abîmées. */
async function damaged(env: { clock: Clock; local: LocalStore; open: () => Promise<Repository> }) {
  const repo = await env.open();
  await repo.apply(seed);
  env.clock.advance(1000);
  const reopened = await env.open(); // copie de sauvegarde des bonnes données
  env.clock.advance(1000);
  await reopened.apply({ operations: [op("op-1", "2026-09-10", 4_250, "cat-courses", "acc-courant", env.clock.now())] });
  const good = reopened.data;
  const broken = structuredClone(good);
  broken.collections.operations.push(invalid);
  await env.local.replace(broken);
  return { good };
}

describe("ouverture de données abîmées", () => {
  it("bureau : JSON illisible → LocalDataError « illisible », sans copie ni écriture", async () => {
    const env = desktop();
    await (await env.open()).apply(seed);
    env.fs.files.set("data.json", '{"schemaVersion":1,"collec');
    const before = new Map(env.fs.files);
    const error = await env.open().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LocalDataError);
    expect((error as LocalDataError).kind).toBe("illisible");
    expect(env.fs.files).toEqual(before);
  });

  it("contenu invalide → LocalDataError « invalide », avec le détail de la validation", async () => {
    for (const env of [desktop(), await web()]) {
      await damaged(env);
      const before = await env.local.listSnapshots();
      const error = await env.open().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LocalDataError);
      expect((error as LocalDataError).kind).toBe("invalide");
      expect((error as LocalDataError).detail).toContain("operations");
      expect(await env.local.listSnapshots()).toEqual(before);
    }
  });

  it("données d'une version plus récente : pas d'écran de secours, rien n'est touché", async () => {
    const env = desktop();
    await (await env.open()).apply(seed);
    const newer = JSON.parse(env.fs.files.get("data.json")!);
    newer.schemaVersion = SCHEMA_VERSION + 1;
    env.fs.files.set("data.json", JSON.stringify(newer));
    const error = await env.open().catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(LocalDataError);
    expect(String(error)).toContain("version plus récente");
    expect(JSON.parse(env.fs.files.get("data.json")!).schemaVersion).toBe(SCHEMA_VERSION + 1);
  });
});

describe("mise de côté", () => {
  it("bureau : copie dans mis-de-cote/ sans toucher data.json ; liste, lecture, suppression", async () => {
    const env = desktop();
    await (await env.open()).apply(seed);
    const raw = env.fs.files.get("data.json")!;
    const info = await env.local.setAside(5000);
    expect(info).toEqual({ id: "5000", setAsideAt: 5000, bytes: new TextEncoder().encode(raw).length });
    expect(env.fs.files.get("data.json")).toBe(raw);
    expect(env.fs.files.get("mis-de-cote/data-5000.json")).toBe(raw);
    await env.local.setAside(6000);
    expect((await env.local.listSetAside()).map((s) => s.id)).toEqual(["6000", "5000"]);
    expect(await env.local.readSetAside("5000")).toBe(raw);
    await env.local.removeSetAside("5000");
    expect((await env.local.listSetAside()).map((s) => s.id)).toEqual(["6000"]);
    await expect(env.local.readSetAside("../data")).rejects.toThrow("introuvable");
  });

  it("web : garde la dernière version seulement", async () => {
    const env = await web();
    await (await env.open()).apply(seed);
    const raw = await env.local.readRaw();
    await env.local.setAside(5000);
    await env.local.setAside(6000);
    expect((await env.local.listSetAside()).map((s) => s.id)).toEqual(["6000"]);
    expect(await env.local.readSetAside("6000")).toBe(raw);
    await expect(env.local.readSetAside("5000")).rejects.toThrow("introuvable");
    expect(await env.local.load()).not.toBeNull();
    await env.local.removeSetAside("6000");
    expect(await env.local.listSetAside()).toEqual([]);
  });

  it("vider : l'appareil repart sur l'écran d'accueil, copies et versions mises de côté gardées", async () => {
    for (const env of [desktop(), await web()]) {
      await damaged(env);
      await env.local.setAside(9000);
      await env.local.clear();
      expect(await env.local.load()).toBeNull();
      expect(await env.local.listSnapshots()).toHaveLength(1);
      expect(await env.local.listSetAside()).toHaveLength(1);
    }
  });
});

describe("restauration de secours", () => {
  it("les copies sont vérifiées : une copie abîmée est listée mais pas restaurable", async () => {
    const env = desktop();
    await damaged(env);
    env.clock.advance(1000);
    // Une copie abîmée, comme si elle venait d'une version fautive.
    env.fs.files.set(`backups/data-${env.clock.now()}.json`, "{abîmé");
    const copies = await recoveryCopies(env.local);
    expect(copies.map((c) => c.usable)).toEqual([false, true]);
  });

  it("décision 38 : la copie reprend sa place telle quelle, la version abîmée est gardée", async () => {
    for (const env of [desktop(), await web()]) {
      await damaged(env);
      const damagedRaw = await env.local.readRaw();
      const [copy] = await recoveryCopies(env.local);
      const expected = await env.local.readSnapshot(copy!.id);
      await recoverLocalData(env.local, copy!.id, 9000);
      expect(await env.local.load()).toEqual(expected);
      expect(await env.local.readSetAside("9000")).toBe(damagedRaw);
      // Les dates d'origine sont gardées : la synchronisation suivante ramène ce qui est plus récent.
      const repo = await env.open();
      expect(repo.data.collections.categories.map((c) => c.updatedAt)).toEqual(seed.categories.map((c) => c.updatedAt));
    }
  });

  it("modifications en attente ramenées à la copie ; appareil et fichier de synchronisation gardés", async () => {
    const env = desktop();
    const repo = await env.open();
    await repo.apply(seed);
    env.clock.advance(1000);
    const reopened = await env.open(); // copie : seed seulement
    env.clock.advance(1000);
    const newer = { ...seed.categories[1]!, name: "Courses et marché", updatedAt: env.clock.now() };
    await reopened.apply({ categories: [newer], operations: [op("op-1", "2026-09-10", 4_250, "cat-courses", "acc-courant", env.clock.now())] });
    const device = (await env.local.getDevice())!;
    await env.local.setDevice({ ...device, sync: { ...device.sync, fileId: "fichier-1" } });
    env.fs.files.set("data.json", "{abîmé");

    const [copy] = await recoveryCopies(env.local);
    await recoverLocalData(env.local, copy!.id, 9000);
    const after = (await env.local.getDevice())!;
    expect(after.deviceId).toBe(device.deviceId);
    expect(after.sync.fileId).toBe("fichier-1");
    // op-1 n'existe pas dans la copie : plus rien à envoyer. La catégorie revient à sa version de la copie.
    expect(after.dirty["operations:op-1"]).toBeUndefined();
    expect(after.dirty["categories:cat-courses"]).toBe(seed.categories[1]!.updatedAt);
  });

  it("décision 39 : repartir de zéro vide l'appareil (écran d'accueil) et garde la version abîmée", async () => {
    for (const env of [desktop(), await web()]) {
      await damaged(env);
      const damagedRaw = await env.local.readRaw();
      await recoverLocalData(env.local, null, 9000);
      expect(await env.local.load()).toBeNull();
      expect(await env.local.readSetAside("9000")).toBe(damagedRaw);
      expect((await env.local.getDevice())!.dirty).toEqual({});
      expect((await env.open()).isFresh).toBe(true);
    }
  });

  it("une copie invalide est refusée avant de toucher à quoi que ce soit", async () => {
    const env = desktop();
    await damaged(env);
    env.clock.advance(1000);
    const id = String(env.clock.now());
    env.fs.files.set(`backups/data-${id}.json`, JSON.stringify({ schemaVersion: 1 }));
    const before = new Map(env.fs.files);
    await expect(recoverLocalData(env.local, id, 9000)).rejects.toThrow();
    expect(env.fs.files).toEqual(before);
  });

  it("panne pendant la restauration : les données abîmées restent en place, l'écran de secours reviendra", async () => {
    class FullDisk extends MemoryFs {
      full = false;
      override async rename(from: string, to: string) {
        if (this.full && to === "data.json") throw new Error("disque plein");
        return super.rename(from, to);
      }
    }
    const fs = new FullDisk();
    const env = desktop(fs);
    const repo = await env.open();
    await repo.apply(seed);
    env.clock.advance(1000);
    await env.open();
    fs.files.set("data.json", "{abîmé");
    const [copy] = await recoveryCopies(env.local);
    fs.full = true;
    await expect(recoverLocalData(env.local, copy!.id, 9000)).rejects.toThrow("disque plein");
    expect(fs.files.get("data.json")).toBe("{abîmé");
    await expect(env.open()).rejects.toBeInstanceOf(LocalDataError);
  });
});
