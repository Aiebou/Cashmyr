import {
  SCHEMA_VERSION,
  parseSyncDocument,
  serializeSyncDocument,
  syncWithDocument,
  type Dataset,
} from "@cashmyr/core";
import { describe, expect, it, vi } from "vitest";
import { Repository, SyncEngine, type SyncFile, type SyncHooks } from "../src";
import { createTauriSync, TauriFileLocalStore } from "../src/tauri";
import { createAssistedSync, createFsAccessSync } from "../src/web";
import {
  Clock,
  CloudFile,
  FakeBrowser,
  FakeFileHandle,
  fakeTauriInvoke,
  ManualTimers,
  MemoryFs,
  MemoryHandleStore,
  MemoryKv,
  MIN,
  op,
  seed,
  TODAY,
} from "./fakes";

type Kind = "tauri" | "fs-access" | "assisted";

async function device(kind: Kind, cloud: CloudFile, clock = new Clock(), hooks?: Partial<SyncHooks>) {
  const local = new TauriFileLocalStore(new MemoryFs(), new MemoryKv());
  const repo = await Repository.open({ local, deviceLabel: kind, now: clock.now, today: () => TODAY });
  const timers = new ManualTimers();
  const browser = new FakeBrowser();
  const handle = new FakeFileHandle(cloud);
  const sync: SyncFile =
    kind === "tauri"
      ? createTauriSync(fakeTauriInvoke(cloud))
      : kind === "fs-access"
        ? createFsAccessSync(
            {
              showOpenFilePicker: async () => [handle],
              // Comme Chromium, le sélecteur d'enregistrement crée le fichier vide.
              showSaveFilePicker: async () => {
                if (cloud.content === null) cloud.content = "";
                return handle;
              },
            },
            new MemoryHandleStore(),
          )
        : createAssistedSync(browser.env());
  const allHooks: SyncHooks = {
    confirmFirstJoin: vi.fn(async () => true),
    confirmDropPurged: vi.fn(async () => true),
    ...hooks,
  };
  const engine = new SyncEngine({ repository: repo, sync, hooks: allHooks, now: clock.now, timers });
  await engine.start();
  return { repo, engine, timers, browser, handle, hooks: allHooks, clock };
}

const fileData = (cloud: CloudFile) => parseSyncDocument(cloud.content!);
const opIds = (d: { collections: Dataset["collections"] }) => d.collections.operations.map((o) => o.id).sort();

describe("mode automatique", () => {
  it("sans fichier choisi, rien ne se passe et l'écran le dit", async () => {
    const cloud = new CloudFile();
    const d = await device("tauri", cloud);
    await d.repo.apply(seed);
    expect(d.engine.state).toMatchObject({ mode: "auto-tauri", automatic: true, status: "unconfigured", pending: 6 });
    expect(d.timers.count).toBe(0);
  });

  it("créer le fichier y écrit tout le jeu local", async () => {
    const cloud = new CloudFile();
    const d = await device("tauri", cloud);
    await d.repo.apply(seed);
    const outcome = await d.engine.connect("create");
    expect(outcome).toMatchObject({ kind: "merged", wrote: true });
    expect(fileData(cloud).collections.accounts).toHaveLength(2);
    expect(d.engine.state).toMatchObject({ status: "ready", pending: 0, lastMergeAt: d.clock.t, targetName: "finances-sync.json" });
  });

  it("écrit 2 s après une modification, une seule fois pour une rafale", async () => {
    const cloud = new CloudFile();
    const d = await device("tauri", cloud);
    await d.repo.apply(seed);
    await d.engine.connect("create");
    const writes = cloud.writes;
    await d.repo.apply({ operations: [op("op-1", "2026-09-01", 100, "cat-courses", "acc-courant", 2)] });
    await d.repo.apply({ operations: [op("op-2", "2026-09-02", 100, "cat-courses", "acc-courant", 2)] });
    expect(d.timers.delays()).toEqual([2000]);
    expect(cloud.writes).toBe(writes);
    expect(d.engine.state.pending).toBe(2);
    d.timers.fire();
    await d.engine.whenIdle();
    expect(cloud.writes).toBe(writes + 1);
    expect(opIds(fileData(cloud))).toEqual(["op-1", "op-2"]);
    expect(d.engine.state.pending).toBe(0);
  });

  it("n'écrit pas quand le fichier n'a rien à apprendre", async () => {
    const cloud = new CloudFile();
    const d = await device("tauri", cloud);
    await d.repo.apply(seed);
    await d.engine.connect("create");
    const writes = cloud.writes;
    expect(await d.engine.onFocus()).toMatchObject({ kind: "merged", wrote: false });
    expect(cloud.writes).toBe(writes);
  });

  it("fichier à moitié envoyé par le cloud : aucune écriture, aucune perte, nouvel essai au prochain focus", async () => {
    const cloud = new CloudFile();
    const d = await device("tauri", cloud);
    await d.repo.apply(seed);
    await d.engine.connect("create");
    const full = cloud.content!;
    cloud.content = full.slice(0, full.length / 2);
    const before = d.repo.data;
    const writes = cloud.writes;
    const outcome = await d.engine.onFocus();
    expect(outcome).toMatchObject({ kind: "failed" });
    expect(d.engine.state.status).toBe("error");
    expect(d.engine.state.lastError).toMatch(/illisible/);
    expect(cloud.writes).toBe(writes);
    expect(d.repo.data).toBe(before);
    cloud.content = full;
    expect(await d.engine.onFocus()).toMatchObject({ kind: "merged" });
    expect(d.engine.state).toMatchObject({ status: "ready", lastError: null });
  });

  it("fichier écrit par une version plus récente : refusé tel quel", async () => {
    const cloud = new CloudFile();
    const d = await device("tauri", cloud);
    await d.repo.apply(seed);
    await d.engine.connect("create");
    cloud.content = JSON.stringify({ ...fileData(cloud), schemaVersion: SCHEMA_VERSION + 1 });
    expect(await d.engine.onFocus()).toMatchObject({ kind: "failed", error: expect.stringMatching(/Mets l'application à jour/) });
  });

  it("écriture impossible : la fusion locale est gardée, les modifications restent en attente", async () => {
    const cloud = new CloudFile();
    const d = await device("tauri", cloud);
    await d.repo.apply(seed);
    await d.engine.connect("create");
    await d.repo.apply({ operations: [op("op-1", "2026-09-01", 100, "cat-courses", "acc-courant", 2)] });
    cloud.failNextWrite = true;
    expect(await d.engine.syncNow()).toMatchObject({ kind: "failed", error: "disque plein" });
    expect(d.engine.state.pending).toBe(1);
    expect(await d.engine.syncNow()).toMatchObject({ kind: "merged", wrote: true });
    expect(d.engine.state.pending).toBe(0);
  });

  it("fichier disparu : signalé, rien n'est recréé en douce", async () => {
    const cloud = new CloudFile();
    const d = await device("tauri", cloud);
    await d.repo.apply(seed);
    await d.engine.connect("create");
    cloud.content = null;
    expect(await d.engine.onFocus()).toMatchObject({ kind: "skipped", reason: "not-ready" });
    expect(d.engine.state.status).toBe("missing");
    expect(cloud.content).toBeNull();
  });

  it("premier passage d'un appareil qui a déjà des données : on demande avant de réunir", async () => {
    const cloud = new CloudFile();
    const a = await device("tauri", cloud);
    await a.repo.apply(seed);
    await a.engine.connect("create");
    const refuse = await device("fs-access", cloud, new Clock(), { confirmFirstJoin: vi.fn(async () => false) });
    await refuse.repo.apply({ ...seed, operations: [op("op-b", "2026-09-05", 100, "cat-courses", "acc-courant", 2)] });
    expect(await refuse.engine.connect("open")).toEqual({ kind: "skipped", reason: "cancelled" });
    expect(refuse.hooks.confirmFirstJoin).toHaveBeenCalledWith({ localRecords: 7, fileRecords: 6, fileName: "finances-sync.json" });
    expect(opIds(fileData(cloud))).toEqual([]);
    expect(refuse.repo.device.sync.fileId).toBeNull();

    const accept = await device("fs-access", cloud);
    await accept.repo.apply({ ...seed, operations: [op("op-c", "2026-09-06", 100, "cat-courses", "acc-courant", 2)] });
    expect(await accept.engine.connect("open")).toMatchObject({ kind: "merged", wrote: true });
    expect(opIds(fileData(cloud))).toEqual(["op-c"]);
  });

  it("un appareil neuf rejoint le fichier sans question", async () => {
    const cloud = new CloudFile();
    const a = await device("tauri", cloud);
    await a.repo.apply(seed);
    await a.engine.connect("create");
    const b = await device("fs-access", cloud);
    await b.engine.connect("open");
    expect(b.hooks.confirmFirstJoin).not.toHaveBeenCalled();
    expect(b.repo.data.collections.accounts).toHaveLength(2);
    expect(b.repo.isFresh).toBe(false);
  });

  it("Chromium : permission expirée au lancement, redemandée d'un geste", async () => {
    const cloud = new CloudFile();
    const a = await device("fs-access", cloud);
    await a.repo.apply(seed);
    await a.engine.connect("create");
    a.handle.permission = "prompt";
    expect(await a.engine.start()).toBeNull();
    expect(a.engine.state.status).toBe("needs-permission");
    expect(await a.engine.requestPermission()).toMatchObject({ kind: "merged" });
    expect(a.engine.state.status).toBe("ready");
  });

  it("une saisie faite pendant la synchronisation n'est pas perdue, et part au passage suivant", async () => {
    const cloud = new CloudFile();
    const a = await device("tauri", cloud);
    await a.repo.apply(seed);
    await a.engine.connect("create");
    // Un autre appareil a ajouté une opération dans le fichier.
    const remote = syncWithDocument({
      local: { ...a.repo.data, collections: { ...a.repo.data.collections, operations: [op("op-remote", "2026-09-07", 100, "cat-courses", "acc-courant", 9)] } },
      remote: fileData(cloud),
      device: { id: "autre", label: "Autre" },
      now: a.clock.t + MIN,
    });
    cloud.content = serializeSyncDocument(remote.document);
    const running = a.engine.syncNow();
    await a.repo.apply({ operations: [op("op-local", "2026-09-08", 100, "cat-resto", "acc-courant", 10)] });
    await running;
    await a.engine.whenIdle();
    expect(opIds(a.repo.data)).toEqual(["op-local", "op-remote"]);
    expect(a.engine.state.pending).toBe(1);
    a.timers.fire();
    await a.engine.whenIdle();
    expect(opIds(fileData(cloud))).toEqual(["op-local", "op-remote"]);
    expect(a.engine.state.pending).toBe(0);
  });

  it("appareil évincé qui revient : on demande avant de laisser revenir ce qui a été supprimé ailleurs", async () => {
    const cloud = new CloudFile();
    const clock = new Clock();
    const a = await device("tauri", cloud, clock);
    const x = op("op-x", "2026-09-01", 100, "cat-courses", "acc-courant", 2);
    await a.repo.apply({ ...seed, operations: [x] });
    await a.engine.connect("create");
    const c = await device("fs-access", cloud, clock);
    await c.engine.connect("open");
    // A supprime X, puis C reste 200 jours sans synchroniser.
    await a.repo.apply({ operations: [{ ...x, updatedAt: clock.t, deletedAt: clock.t }] });
    await a.engine.syncNow();
    clock.advance(200 * 24 * 60 * MIN);
    const purged = await a.engine.syncNow();
    expect(purged).toMatchObject({ kind: "merged", report: { purged: 1, evictedDevices: [c.repo.device.deviceId] } });
    await c.engine.onFocus();
    expect(c.hooks.confirmDropPurged).toHaveBeenCalledWith([{ collection: "operations", id: "op-x" }]);
    expect(opIds(c.repo.data)).toEqual([]);
    expect(opIds(fileData(cloud))).toEqual([]);
  });

  it("se déconnecter garde les données et remet l'écran à « non configuré »", async () => {
    const cloud = new CloudFile();
    const a = await device("tauri", cloud);
    await a.repo.apply(seed);
    await a.engine.connect("create");
    await a.engine.disconnect();
    expect(a.engine.state).toMatchObject({ status: "unconfigured", targetName: null, lastMergeAt: null });
    expect(a.repo.data.collections.accounts).toHaveLength(2);
  });
});

describe("mode assisté", () => {
  it("dit qu'il n'agit que sur demande, fusionne le fichier désigné et propose le résultat", async () => {
    const cloud = new CloudFile();
    const a = await device("tauri", cloud);
    await a.repo.apply({ ...seed, operations: [op("op-a", "2026-09-01", 100, "cat-courses", "acc-courant", 2)] });
    await a.engine.connect("create");

    const phone = await device("assisted", cloud);
    expect(phone.engine.state).toMatchObject({ mode: "assisted", automatic: false, status: "unconfigured" });
    phone.browser.nextPick = { name: "finances-sync.json", content: cloud.content! };
    expect(await phone.engine.syncNow()).toMatchObject({ kind: "merged", wrote: false, offerReady: true });
    expect(opIds(phone.repo.data)).toEqual(["op-a"]);
    expect(phone.engine.state).toMatchObject({ status: "ready", offerReady: true, lastOfferAt: null });
    expect(phone.timers.count).toBe(0);

    expect(await phone.engine.offerMerged()).toBe("downloaded");
    expect(phone.engine.state).toMatchObject({ offerReady: false, lastOfferAt: phone.clock.t });
    await phone.browser.saveLastOfferOver(cloud);
    expect(Object.keys(fileData(cloud).devices)).toHaveLength(2);
  });

  it("les modifications restent en attente jusqu'à ce qu'un fichier lu les contienne", async () => {
    const cloud = new CloudFile();
    const phone = await device("assisted", cloud);
    await phone.repo.apply(seed);
    expect(await phone.engine.createAssistedFile()).toMatchObject({ kind: "merged", offerReady: true });
    await phone.engine.offerMerged();
    expect(phone.engine.state.pending).toBe(6);
    await phone.browser.saveLastOfferOver(cloud);
    phone.browser.nextPick = { name: "finances-sync.json", content: cloud.content! };
    await phone.engine.syncNow();
    expect(phone.engine.state.pending).toBe(0);
  });

  it("annuler le sélecteur ne touche à rien", async () => {
    const phone = await device("assisted", new CloudFile());
    phone.browser.nextPick = null;
    expect(await phone.engine.syncNow()).toEqual({ kind: "skipped", reason: "cancelled" });
    expect(phone.engine.state.status).toBe("unconfigured");
  });

  it("un fichier qui n'est pas un fichier de synchronisation est refusé", async () => {
    const phone = await device("assisted", new CloudFile());
    phone.browser.nextPick = { name: "mes-finances.json", content: JSON.stringify({ settings: {}, months: {} }) };
    expect(await phone.engine.syncNow()).toMatchObject({ kind: "failed", error: expect.stringMatching(/pas un fichier de synchronisation/) });
  });
});

