import "fake-indexeddb/auto";
import { defaultPreferences, parseSyncDocument } from "@cashmyr/core";
import { deleteDB } from "idb";
import { describe, expect, it, vi } from "vitest";
import {
  addProfile,
  fileOwner,
  FIRST_PROFILE_NAME,
  implicitRegistry,
  isProfileId,
  parseProfileRegistry,
  PRINCIPAL,
  ProfileError,
  removeProfile,
  renameProfile,
  Repository,
  setProfileFile,
  SyncEngine,
  syncFileNameFor,
  type ProfileRegistry,
  type SyncFile,
  type SyncHooks,
} from "../src";
import { createFileRegistryStore, createTauriSync, TauriFileLocalStore } from "../src/tauri";
import { createAssistedSync, createIdbRegistryStore, IndexedDbLocalStore, profileDbName } from "../src/web";
import { Clock, CloudFile, FakeBrowser, fakeTauriInvoke, ManualTimers, MemoryFs, MemoryKv, op, seed, T0, TODAY } from "./fakes";

const FOYER = "0b7e2f4c-1d2a-4c3b-9e8f-7a6b5c4d3e2f";
const ALICE = "5d1c7a2e-8b3f-4e6d-a1c2-3b4d5e6f7a8b";

const base = (): ProfileRegistry => implicitRegistry({ syncFileId: null, checkUpdatesOnLaunch: true });

describe("registre des profils", () => {
  it("sans registre : un seul profil, « Mon budget », à l'emplacement d'avant (décision 55)", () => {
    const registry = implicitRegistry({ syncFileId: "fichier-1", checkUpdatesOnLaunch: false });
    expect(registry).toEqual({
      version: 1,
      profiles: [{ id: PRINCIPAL, name: FIRST_PROFILE_NAME, createdAt: 0, syncFileId: "fichier-1" }],
      checkUpdatesOnLaunch: false,
    });
  });

  it("un nom par profil, à la casse, aux accents et aux espaces près", () => {
    const registry = addProfile(base(), { id: FOYER, name: "  Foyer   Élodie " }, T0);
    expect(registry.profiles[1]).toEqual({ id: FOYER, name: "Foyer Élodie", createdAt: T0, syncFileId: null });
    expect(() => addProfile(registry, { id: ALICE, name: "foyer elodie" }, T0)).toThrow("Le profil « Foyer Élodie » existe déjà");
    expect(() => addProfile(registry, { id: ALICE, name: "   " }, T0)).toThrow(ProfileError);
    expect(() => renameProfile(registry, PRINCIPAL, "FOYER ÉLODIE")).toThrow("existe déjà");
    // Changer seulement la casse de son propre nom est permis.
    expect(renameProfile(registry, FOYER, "foyer élodie").profiles[1]!.name).toBe("foyer élodie");
  });

  it("identifiants : « principal » ou un uuid v4, jamais un chemin", () => {
    expect(isProfileId(PRINCIPAL)).toBe(true);
    expect(isProfileId(FOYER)).toBe(true);
    for (const bad of ["", "..", "../principal", "profils/x", FOYER.toUpperCase(), `${FOYER}/..`]) expect(isProfileId(bad)).toBe(false);
    expect(() => addProfile(base(), { id: "../x", name: "Foyer" }, T0)).toThrow("Identifiant");
    expect(() => addProfile(base(), { id: PRINCIPAL, name: "Foyer" }, T0)).toThrow("Identifiant");
  });

  it("le dernier profil ne se supprime pas (décision 56)", () => {
    const two = addProfile(base(), { id: FOYER, name: "Foyer" }, T0);
    const one = removeProfile(two, PRINCIPAL);
    expect(one.profiles.map((p) => p.id)).toEqual([FOYER]);
    expect(() => removeProfile(one, FOYER)).toThrow("Le dernier profil");
    expect(() => removeProfile(two, ALICE)).toThrow("introuvable");
  });

  it("le fichier de chaque profil est retrouvé par son identifiant (décision 57)", () => {
    let registry = addProfile(base(), { id: FOYER, name: "Foyer" }, T0);
    registry = setProfileFile(registry, FOYER, "fichier-foyer");
    expect(fileOwner(registry, PRINCIPAL, "fichier-foyer")?.name).toBe("Foyer");
    expect(fileOwner(registry, FOYER, "fichier-foyer")).toBeUndefined();
    expect(fileOwner(registry, PRINCIPAL, "autre")).toBeUndefined();
  });

  it("nom proposé pour le fichier de chaque profil", () => {
    expect(syncFileNameFor({ id: PRINCIPAL, name: "Alice" })).toBe("finances-sync.json");
    expect(syncFileNameFor({ id: FOYER, name: "Foyer Élodie & Marc" })).toBe("finances-sync-foyer-elodie-marc.json");
    expect(syncFileNameFor({ id: FOYER, name: "€ ! ?" })).toBe("finances-sync-0b7e2f4c.json");
    expect(syncFileNameFor({ id: FOYER, name: "a".repeat(60) })).toBe(`finances-sync-${"a".repeat(40)}.json`);
  });

  it("un registre abîmé est refusé plutôt que deviné", () => {
    const good = addProfile(base(), { id: FOYER, name: "Foyer" }, T0);
    expect(parseProfileRegistry(JSON.parse(JSON.stringify(good)))).toEqual(good);
    const twins = { ...good, profiles: [good.profiles[0], { ...good.profiles[1], name: "mon budget" }] };
    for (const bad of [null, {}, { ...good, version: 2 }, { ...good, profiles: [] }, { ...good, profiles: [{ id: "../x", name: "x", createdAt: 0, syncFileId: null }] }, twins]) {
      expect(() => parseProfileRegistry(bad)).toThrow("illisible");
    }
  });
});

describe("stockage par profil", () => {
  it("PWA : une base par profil, la première garde son nom ; supprimer une base ouverte ne bloque pas", async () => {
    expect(profileDbName(PRINCIPAL)).toBe("cashmyr");
    expect(profileDbName(FOYER)).toBe(`cashmyr-${FOYER}`);
    const principal = await IndexedDbLocalStore.open(`t-${profileDbName(PRINCIPAL)}`);
    const foyer = await IndexedDbLocalStore.open(`t-${profileDbName(FOYER)}`);
    await principal.apply(seed, defaultPreferences());
    expect(await foyer.load()).toBeNull();

    // La connexion de `foyer` reste ouverte : elle se ferme d'elle-même quand la base est supprimée.
    await deleteDB(`t-${profileDbName(FOYER)}`);
    const reopened = await IndexedDbLocalStore.open(`t-${profileDbName(FOYER)}`);
    expect(await reopened.load()).toBeNull();
    expect((await principal.load())?.collections.accounts).toHaveLength(seed.accounts!.length);
  });

  it("PWA : registre absent tant qu'il n'est pas écrit, puis relu tel quel", async () => {
    const store = createIdbRegistryStore("t-registre");
    expect(await store.read()).toBeNull();
    const registry = addProfile(base(), { id: FOYER, name: "Foyer" }, T0);
    await store.write(registry);
    expect(await store.read()).toEqual(registry);
  });

  it("bureau : profils.json écrit dans un temporaire puis renommé ; illisible, il est refusé", async () => {
    const fs = new MemoryFs();
    const store = createFileRegistryStore(fs);
    expect(await store.read()).toBeNull();
    const registry = addProfile(base(), { id: FOYER, name: "Foyer" }, T0);
    await store.write(registry);
    expect(fs.log).toEqual(["write profils.json.tmp", "rename profils.json.tmp → profils.json"]);
    expect(await store.read()).toEqual(registry);
    fs.files.set("profils.json", "{ tronqué");
    await expect(store.read()).rejects.toThrow("illisible");
  });

  it("bureau : le nom proposé à la création part vers Rust", async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const invoke = (async (command: string, args?: Record<string, unknown>) => {
      calls.push([command, args]);
      return null;
    }) as Parameters<typeof createTauriSync>[0];
    await createTauriSync(invoke, "finances-sync-foyer.json").choose("create");
    expect(calls).toEqual([["sync_choose", { kind: "create", suggestedName: "finances-sync-foyer.json" }]]);
  });
});

describe("un fichier, un profil (décision 57)", () => {
  async function profile(sync: SyncFile, hooks: Partial<SyncHooks>, fileName?: string) {
    const clock = new Clock();
    const local = new TauriFileLocalStore(new MemoryFs(), new MemoryKv());
    const repo = await Repository.open({ local, deviceLabel: "test", now: clock.now, today: () => TODAY });
    const engine = new SyncEngine({
      repository: repo,
      sync,
      hooks: { confirmFirstJoin: vi.fn(async () => true), confirmDropPurged: vi.fn(async () => true), ...hooks },
      now: clock.now,
      timers: new ManualTimers(),
      ...(fileName ? { fileName } : {}),
    });
    await engine.start();
    return { repo, engine };
  }

  it("le fichier d'un autre profil est refusé, oublié, et rien n'est écrit", async () => {
    const cloud = new CloudFile();
    const owner = await profile(createTauriSync(fakeTauriInvoke(cloud)), {});
    await owner.repo.apply({ ...seed, operations: [op("op-a", "2026-09-01", 100, "cat-courses", "acc-courant", 2)] });
    await owner.engine.connect("create");
    const before = cloud.content;
    const fileId = parseSyncDocument(before!).fileId;

    const invoke = fakeTauriInvoke(cloud);
    const fileChanged = vi.fn(async () => undefined);
    const other = await profile(createTauriSync(invoke), {
      fileOwner: async (id) => (id === fileId ? "Foyer" : null),
      fileChanged,
    });
    await other.repo.apply(seed);
    const outcome = await other.engine.connect("open");
    expect(outcome).toEqual({
      kind: "failed",
      error: "Ce fichier est déjà celui du profil « Foyer » sur cet appareil. Choisis un autre fichier, ou ouvre ce profil.",
    });
    expect(cloud.content).toBe(before);
    expect(invoke.calls).toContain("sync_forget");
    expect(other.engine.state).toMatchObject({ status: "unconfigured", targetName: null, lastError: expect.stringContaining("« Foyer »") });
    expect(other.repo.device.sync.fileId).toBeNull();
    expect(other.repo.data.collections.operations).toHaveLength(0);
    // Le prochain passage ne revient pas sur ce fichier.
    expect(await other.engine.syncNow()).toEqual({ kind: "skipped", reason: "not-ready" });
    expect(fileChanged).toHaveBeenLastCalledWith(null);
  });

  it("rejoindre un fichier libre le note pour le profil, l'oublier aussi", async () => {
    const cloud = new CloudFile();
    const fileChanged = vi.fn(async () => undefined);
    const fileOwnerHook = vi.fn(async () => null);
    const p = await profile(createTauriSync(fakeTauriInvoke(cloud)), { fileOwner: fileOwnerHook, fileChanged });
    await p.repo.apply(seed);
    await p.engine.connect("create");
    const fileId = parseSyncDocument(cloud.content!).fileId;
    expect(fileOwnerHook).toHaveBeenCalledWith(fileId);
    expect(fileChanged).toHaveBeenCalledWith(fileId);
    // Un passage de plus sur le même fichier ne redemande rien.
    await p.repo.apply({ operations: [op("op-b", "2026-09-02", 50, "cat-courses", "acc-courant", 3)] });
    await p.engine.syncNow();
    expect(fileOwnerHook).toHaveBeenCalledTimes(1);
    expect(fileChanged).toHaveBeenCalledTimes(1);
    await p.engine.disconnect();
    expect(fileChanged).toHaveBeenLastCalledWith(null);
  });

  it("un registre qui ne s'écrit pas n'empêche pas la synchronisation", async () => {
    const cloud = new CloudFile();
    const p = await profile(createTauriSync(fakeTauriInvoke(cloud)), {
      fileChanged: async () => {
        throw new Error("disque plein");
      },
    });
    await p.repo.apply(seed);
    expect(await p.engine.connect("create")).toMatchObject({ kind: "merged", wrote: true });
  });

  it("mode assisté : le fichier d'un autre profil est refusé sans rien fusionner ; un nouveau fichier porte le nom du profil", async () => {
    const cloud = new CloudFile();
    const owner = await profile(createTauriSync(fakeTauriInvoke(cloud)), {});
    await owner.repo.apply(seed);
    await owner.engine.connect("create");
    const fileId = parseSyncDocument(cloud.content!).fileId;

    const browser = new FakeBrowser();
    const phone = await profile(createAssistedSync(browser.env()), { fileOwner: async (id) => (id === fileId ? "Mon budget" : null) }, "finances-sync-foyer.json");
    browser.nextPick = { name: "finances-sync.json", content: cloud.content! };
    expect(await phone.engine.syncNow()).toMatchObject({ kind: "failed", error: expect.stringContaining("« Mon budget »") });
    expect(phone.repo.data.collections.accounts).toHaveLength(0);
    expect(phone.engine.state).toMatchObject({ status: "unconfigured", offerReady: false });

    await phone.repo.apply(seed);
    await phone.engine.createAssistedFile();
    expect(await phone.engine.offerMerged()).toBe("downloaded");
    expect(browser.downloads.map((d) => d.name)).toEqual(["finances-sync-foyer.json"]);
  });
});
