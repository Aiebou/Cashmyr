import {
  COLLECTION_NAMES,
  SCHEMA_VERSION,
  upgradeSchema,
  type Changes,
  type CollectionName,
  type Collections,
  type Dataset,
  type Preferences,
} from "@cashmyr/core";
import { openDB, type IDBPDatabase } from "idb";
import type { DeviceState, LocalStore, SetAsideInfo, SnapshotInfo } from "../types";

/** 2 : magasin des tags (format 2 des données, version 0.2.0). */
const DB_VERSION = 2;
/** Collections de la première version de la base ; celles d'après ont chacune leur étape. */
const FIRST_STORES: readonly CollectionName[] = ["categories", "accounts", "operations", "goals", "goalSteps", "debts", "recurrences", "skips"];
const META = "meta";
const SNAPSHOTS = "snapshots";
const KEEP_SNAPSHOTS = 5;
const STORES = [...COLLECTION_NAMES, META] as string[];

type StoredSnapshot = SnapshotInfo & { json: string };
/** Version refusée à l'ouverture, mise de côté par l'écran de secours : la dernière seulement. */
const SET_ASIDE = "setAside";
type StoredSetAside = SetAsideInfo & { content: string };

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/**
 * Stockage local de la PWA : un magasin IndexedDB par collection, un magasin
 * `meta` (préférences, état de l'appareil, handle du fichier de synchronisation)
 * et un magasin de copies de sauvegarde.
 */
export class IndexedDbLocalStore implements LocalStore {
  readonly kind = "indexeddb" as const;

  private constructor(private readonly db: IDBPDatabase) {}

  static async open(name = "cashmyr"): Promise<IndexedDbLocalStore> {
    const db = await openDB(name, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          for (const collection of FIRST_STORES) database.createObjectStore(collection, { keyPath: "id" });
          database.createObjectStore(META);
          database.createObjectStore(SNAPSHOTS, { keyPath: "id" });
        }
        if (oldVersion < 2) database.createObjectStore("tags", { keyPath: "id" });
      },
      // Suppression du profil (§9) ou nouvelle version ouverte dans un autre onglet : la connexion
      // se ferme au lieu de bloquer l'autre côté.
      blocking(_current, _next, event) {
        (event.target as IDBDatabase).close();
      },
    });
    return new IndexedDbLocalStore(db);
  }

  async load(): Promise<Dataset | null> {
    const tx = this.db.transaction(STORES, "readonly");
    const preferences = (await tx.objectStore(META).get("preferences")) as Preferences | undefined;
    const schemaVersion = (await tx.objectStore(META).get("schemaVersion")) as Dataset["schemaVersion"] | undefined;
    if (preferences === undefined || schemaVersion === undefined) {
      await tx.done;
      return null;
    }
    const collections = {} as Record<string, unknown[]>;
    for (const name of COLLECTION_NAMES) collections[name] = await tx.objectStore(name).getAll();
    await tx.done;
    return { schemaVersion, collections: collections as Collections, preferences };
  }

  async apply(changes: Changes, preferences?: Preferences): Promise<void> {
    const tx = this.db.transaction(STORES, "readwrite");
    const writes: Promise<unknown>[] = [];
    for (const name of COLLECTION_NAMES) {
      for (const record of changes[name] ?? []) writes.push(tx.objectStore(name).put(record));
    }
    if (preferences) {
      writes.push(tx.objectStore(META).put(preferences, "preferences"));
      writes.push(tx.objectStore(META).put(SCHEMA_VERSION, "schemaVersion"));
    }
    await Promise.all([...writes, tx.done]);
  }

  async replace(data: Dataset): Promise<void> {
    const tx = this.db.transaction(STORES, "readwrite");
    const writes: Promise<unknown>[] = [];
    for (const name of COLLECTION_NAMES) {
      const store = tx.objectStore(name);
      writes.push(store.clear());
      for (const record of data.collections[name]) writes.push(store.put(record));
    }
    writes.push(tx.objectStore(META).put(data.preferences, "preferences"));
    writes.push(tx.objectStore(META).put(data.schemaVersion, "schemaVersion"));
    await Promise.all([...writes, tx.done]);
  }

  async snapshot(now: number): Promise<SnapshotInfo | null> {
    const data = await this.load();
    if (!data) return null;
    const json = JSON.stringify(data);
    const info: SnapshotInfo = { id: String(now), takenAt: now, bytes: byteLength(json) };
    const tx = this.db.transaction(SNAPSHOTS, "readwrite");
    await tx.store.put({ ...info, json } satisfies StoredSnapshot);
    const all = (await tx.store.getAll()) as StoredSnapshot[];
    const stale = all.sort((a, b) => b.takenAt - a.takenAt).slice(KEEP_SNAPSHOTS);
    await Promise.all([...stale.map((s) => tx.store.delete(s.id)), tx.done]);
    return info;
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const all = (await this.db.getAll(SNAPSHOTS)) as StoredSnapshot[];
    return all.map(({ id, takenAt, bytes }) => ({ id, takenAt, bytes })).sort((a, b) => b.takenAt - a.takenAt);
  }

  async readSnapshot(id: string): Promise<Dataset> {
    const snap = (await this.db.get(SNAPSHOTS, id)) as StoredSnapshot | undefined;
    if (!snap) throw new Error(`Copie de sauvegarde introuvable : ${id}`);
    // Une copie prise par une version précédente est mise au format courant.
    return upgradeSchema(JSON.parse(snap.json) as Dataset);
  }

  async getDevice(): Promise<DeviceState | null> {
    return ((await this.db.get(META, "device")) as DeviceState | undefined) ?? null;
  }

  async setDevice(state: DeviceState): Promise<void> {
    await this.db.put(META, state, "device");
  }

  /** Valeur libre du magasin `meta` (handle du fichier de synchronisation). */
  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.get(META, key)) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    if (value === undefined || value === null) await this.db.delete(META, key);
    else await this.db.put(META, value, key);
  }

  async requestPersistence(): Promise<boolean> {
    const storage = (globalThis as { navigator?: { storage?: { persist?: () => Promise<boolean> } } }).navigator
      ?.storage;
    return storage?.persist ? storage.persist() : false;
  }

  async flush(): Promise<void> {}

  async readRaw(): Promise<string | null> {
    const data = await this.load();
    return data ? JSON.stringify(data) : null;
  }

  async setAside(now: number): Promise<SetAsideInfo | null> {
    const content = await this.readRaw();
    if (content === null) return null;
    const info: SetAsideInfo = { id: String(now), setAsideAt: now, bytes: byteLength(content) };
    await this.db.put(META, { ...info, content } satisfies StoredSetAside, SET_ASIDE);
    return info;
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction(STORES, "readwrite");
    const writes: Promise<unknown>[] = COLLECTION_NAMES.map((name) => tx.objectStore(name).clear());
    writes.push(tx.objectStore(META).delete("preferences"), tx.objectStore(META).delete("schemaVersion"));
    await Promise.all([...writes, tx.done]);
  }

  async listSetAside(): Promise<SetAsideInfo[]> {
    const kept = (await this.db.get(META, SET_ASIDE)) as StoredSetAside | undefined;
    return kept ? [{ id: kept.id, setAsideAt: kept.setAsideAt, bytes: kept.bytes }] : [];
  }

  async readSetAside(id: string): Promise<string> {
    const kept = (await this.db.get(META, SET_ASIDE)) as StoredSetAside | undefined;
    if (!kept || kept.id !== id) throw new Error(`Version mise de côté introuvable : ${id}`);
    return kept.content;
  }

  async removeSetAside(id: string): Promise<void> {
    const kept = (await this.db.get(META, SET_ASIDE)) as StoredSetAside | undefined;
    if (kept?.id === id) await this.db.delete(META, SET_ASIDE);
  }

  close(): void {
    this.db.close();
  }
}
