import {
  applyChanges,
  emptyDataset,
  type Account,
  type Changes,
  type Dataset,
  type Preferences,
} from "@cashmyr/core";
import {
  implicitRegistry,
  Repository,
  SyncEngine,
  syncFileNameFor,
  type AppUpdates,
  type AssistedSyncFile,
  type DeviceState,
  type DisplayPrefs,
  type FileIO,
  type LocalStore,
  type Platform,
  type ProfileEntry,
  type ProfileHost,
  type ProfileRegistry,
  type SetAsideInfo,
  type SnapshotInfo,
  type SyncFile,
} from "@cashmyr/storage";
import { act, render } from "@testing-library/react";
import { App } from "../src/App";
import { defaultCategories } from "../src/lib/data";
import { createAppStore } from "../src/store/app-store";

export const TODAY = "2026-09-23";
export const NOW = Date.UTC(2026, 8, 23, 12);

/** Stockage local en mémoire, pour les tests d'interface. */
export class MemoryLocalStore implements LocalStore {
  readonly kind = "file" as const;
  data: Dataset | null = null;
  device: DeviceState | null = null;
  async load() {
    return this.data;
  }
  async apply(changes: Changes, preferences?: Preferences) {
    this.data = applyChanges(this.data ?? emptyDataset(), changes);
    if (preferences) this.data = { ...this.data, preferences };
  }
  async replace(data: Dataset) {
    this.data = data;
  }
  snapshots: { info: SnapshotInfo; data: Dataset }[] = [];
  async snapshot(now: number) {
    if (!this.data) return null;
    const text = JSON.stringify(this.data);
    const info = { id: `snap-${this.snapshots.length + 1}`, takenAt: now, bytes: text.length };
    this.snapshots.unshift({ info, data: JSON.parse(text) as Dataset });
    this.snapshots = this.snapshots.slice(0, 5);
    return info;
  }
  async listSnapshots() {
    return this.snapshots.map((s) => s.info);
  }
  async readSnapshot(id: string): Promise<Dataset> {
    const found = this.snapshots.find((s) => s.info.id === id);
    if (!found) throw new Error("aucune copie");
    return found.data;
  }
  async getDevice() {
    return this.device;
  }
  async setDevice(state: DeviceState) {
    this.device = state;
  }
  async requestPersistence() {
    return true;
  }
  async flush() {}
  setAsideList: { info: SetAsideInfo; content: string }[] = [];
  async readRaw() {
    return this.data === null ? null : JSON.stringify(this.data);
  }
  async setAside(now: number) {
    const content = await this.readRaw();
    if (content === null) return null;
    const info = { id: String(now), setAsideAt: now, bytes: content.length };
    this.setAsideList.unshift({ info, content });
    return info;
  }
  async clear() {
    this.data = null;
  }
  async listSetAside() {
    return this.setAsideList.map((v) => v.info);
  }
  async readSetAside(id: string) {
    const found = this.setAsideList.find((v) => v.info.id === id);
    if (!found) throw new Error("introuvable");
    return found.content;
  }
  async removeSetAside(id: string) {
    this.setAsideList = this.setAsideList.filter((v) => v.info.id !== id);
  }
}

export const noSync: AssistedSyncFile = {
  mode: "assisted",
  pickAndRead: async () => null,
  offer: async () => "cancelled",
};

/** Profils en mémoire : un stockage par profil, un registre, le mémo de session. */
export class MemoryProfileHost implements ProfileHost {
  stores = new Map<string, MemoryLocalStore>();
  saved: ProfileRegistry | null = null;
  noted: string | null = null;
  removed: string[] = [];
  prepared: string[] = [];
  readonly updates?: AppUpdates;

  constructor(
    private readonly base: Omit<Platform, "local" | "sync" | "syncFileName">,
    private readonly sync: SyncFile = noSync,
  ) {
    if (base.updates) this.updates = base.updates;
  }

  storeOf(profileId: string): MemoryLocalStore {
    let store = this.stores.get(profileId);
    if (!store) this.stores.set(profileId, (store = new MemoryLocalStore()));
    return store;
  }

  registry = {
    read: async () => (this.saved ? structuredClone(this.saved) : null),
    write: async (registry: ProfileRegistry) => {
      this.saved = structuredClone(registry);
    },
  };

  async open(profile: ProfileEntry): Promise<Platform> {
    return { ...this.base, local: this.storeOf(profile.id), sync: this.sync, syncFileName: syncFileNameFor(profile) };
  }
  async localOf(profileId: string): Promise<LocalStore> {
    return this.storeOf(profileId);
  }
  async prepare(profileId: string) {
    this.prepared.push(profileId);
    this.storeOf(profileId);
  }
  async remove(profileId: string) {
    this.removed.push(profileId);
    this.stores.delete(profileId);
  }
  session = {
    get: () => this.noted,
    set: (profileId: string | null) => {
      this.noted = profileId;
    },
  };
}

const account = (id: string, name: string, role: Account["role"], opening: number): Account => ({
  id,
  updatedAt: 1,
  deletedAt: null,
  name,
  role,
  opening,
  safety: role === "epargne",
  color: 0,
});

export const accounts = {
  courant: account("acc-courant", "Compte courant", "courant", 125_000),
  livret: account("acc-livret", "Livret A", "epargne", 300_000),
};

/** Application complète sur un stockage en mémoire, avec catégories et comptes de départ. */
export async function renderApp(
  options: {
    seeded?: boolean;
    target?: Platform["target"];
    files?: Partial<FileIO>;
    updates?: AppUpdates;
    /** Choix d'affichage de l'appareil au démarrage. */
    display?: Partial<DisplayPrefs>;
    /** Onglets déjà présentés par le tutoriel ; sans cette option, un appareil d'avant le tutoriel (aucun). */
    tour?: string[];
    restart?: () => void;
    /** Registre des profils déjà écrit ; le profil ouvert est `profile`, le premier par défaut. */
    registry?: ProfileRegistry;
    profile?: string;
    host?: MemoryProfileHost;
  } = {},
) {
  const host =
    options.host ??
    new MemoryProfileHost({
      target: options.target ?? "web",
      deviceLabel: "test",
      files: { saveAs: async () => true, openText: async () => null, ...options.files },
      ...(options.updates ? { updates: options.updates } : {}),
      shortcutHint: "N",
    });
  if (options.registry) host.saved = structuredClone(options.registry);
  const registry = await host.registry.read();
  const list = (registry ?? implicitRegistry({ syncFileId: null, checkUpdatesOnLaunch: true })).profiles;
  const current = list.find((p) => p.id === options.profile) ?? list[0]!;
  const platform = await host.open(current);
  const local = host.storeOf(current.id);
  // Un appareil neuf attend le tutoriel ; les tests d'écran partent d'un appareil qui ne le montre pas.
  local.device ??= {
    deviceId: "appareil-test",
    deviceLabel: "test",
    sync: { fileId: null, targetName: null, lastMergeAt: null, lastOfferAt: null, lastError: null },
    dirty: {},
    ...(options.tour ? { tour: { seen: options.tour } } : {}),
  };
  const repository = await Repository.open({ local, deviceLabel: "test", now: () => NOW, today: () => TODAY });
  if (options.seeded !== false) {
    await repository.apply({ categories: defaultCategories(), accounts: [accounts.courant, accounts.livret] });
  }
  if (options.display) await repository.updateDevice({ display: options.display });
  const engine = new SyncEngine({
    repository,
    sync: noSync,
    hooks: { confirmFirstJoin: async () => true, confirmDropPurged: async () => false },
    now: () => NOW,
  });
  const store = createAppStore({
    platform,
    repository,
    engine,
    host,
    profiles: { list, current, registered: registry !== null, registry },
    today: () => TODAY,
    now: () => NOW,
    restart: options.restart ?? (() => undefined),
  });
  const view = render(<App store={store} />);
  const actions = store.getState().actions;
  return { store, repository, local, view, actions, act, host };
}

/** Bandeau des comptes : vérifie son titre (le sélecteur du total, décision 62) et renvoie le bandeau. */
export function bannerSection(title: string): HTMLElement {
  const heading = document.getElementById("banner-title");
  if (heading?.textContent !== title) throw new Error(`Bandeau « ${heading?.textContent ?? "absent"} » au lieu de « ${title} »`);
  return heading.closest("section")!;
}
