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
  type AssistedSyncFile,
  type DeviceState,
  type LocalStore,
  type Platform,
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
  async snapshot() {
    return null;
  }
  async listSnapshots() {
    return [];
  }
  async readSnapshot(): Promise<Dataset> {
    throw new Error("aucune copie");
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
export async function renderApp(options: { seeded?: boolean; target?: Platform["target"] } = {}) {
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
    files: { saveAs: async () => true, openText: async () => null },
    shortcutHint: "N",
  };
  const store = createAppStore({ platform, repository, engine, today: () => TODAY, now: () => NOW });
  const view = render(<App store={store} />);
  const actions = store.getState().actions;
  return { store, repository, view, actions, act };
}
