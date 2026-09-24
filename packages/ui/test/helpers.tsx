import {
  applyChanges,
  emptyDataset,
  type Account,
  type Changes,
  type Dataset,
  type Preferences,
} from "@cashmyr/core";
import {
  Repository,
  SyncEngine,
  type AppUpdates,
  type AssistedSyncFile,
  type DeviceState,
  type FileIO,
  type LocalStore,
  type Platform,
  type SetAsideInfo,
  type SnapshotInfo,
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

const noSync: AssistedSyncFile = {
  mode: "assisted",
  pickAndRead: async () => null,
  offer: async () => "cancelled",
};

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
  options: { seeded?: boolean; target?: Platform["target"]; files?: Partial<FileIO>; updates?: AppUpdates } = {},
) {
  const local = new MemoryLocalStore();
  const repository = await Repository.open({ local, deviceLabel: "test", now: () => NOW, today: () => TODAY });
  if (options.seeded !== false) {
    await repository.apply({ categories: defaultCategories(), accounts: [accounts.courant, accounts.livret] });
  }
  const engine = new SyncEngine({
    repository,
    sync: noSync,
    hooks: { confirmFirstJoin: async () => true, confirmDropPurged: async () => false },
    now: () => NOW,
  });
  const platform: Platform = {
    target: options.target ?? "web",
    deviceLabel: "test",
    local,
    sync: noSync,
    files: { saveAs: async () => true, openText: async () => null, ...options.files },
    ...(options.updates ? { updates: options.updates } : {}),
    shortcutHint: "N",
  };
  const store = createAppStore({ platform, repository, engine, today: () => TODAY, now: () => NOW });
  const view = render(<App store={store} />);
  const actions = store.getState().actions;
  return { store, repository, local, view, actions, act };
}
