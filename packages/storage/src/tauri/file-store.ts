import { applyChanges, emptyDataset, upgradeSchema, type Changes, type Dataset, type Preferences } from "@cashmyr/core";
import type { DeviceState, LocalStore, SetAsideInfo, SnapshotInfo } from "../types";

/** Opérations de fichiers utilisées, sur des chemins relatifs au répertoire de données de l'application. */
export interface FsLike {
  exists(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
  /** Remplace la destination si elle existe. */
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  readDir(path: string): Promise<{ name: string; isFile: boolean }[]>;
  remove(path: string): Promise<void>;
}

/** Petit magasin clé-valeur (plugin-store) pour l'état de l'appareil. */
export interface KeyValueLike {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
}

const DATA = "data.json";
const TMP = "data.json.tmp";
const BACKUPS = "backups";
const KEEP_SNAPSHOTS = 5;
const SNAPSHOT_NAME = /^data-(\d+)\.json$/;
/** Versions refusées à l'ouverture, mises de côté par l'écran de secours : un fichier par incident. */
const SET_ASIDE = "mis-de-cote";
const SET_ASIDE_NAME = /^data-(\d+)\.json$/;

const byteLength = (text: string) => new TextEncoder().encode(text).length;

export class LocalFileCorruptedError extends Error {
  override name = "LocalFileCorruptedError";
}

/**
 * Stockage local du bureau : un fichier JSON dans le répertoire de données de
 * l'application. Chaque écriture passe par un fichier temporaire renommé ensuite,
 * de sorte qu'une coupure ne laisse jamais un fichier à moitié écrit.
 */
export class TauriFileLocalStore implements LocalStore {
  readonly kind = "file" as const;
  private cache: Dataset | null = null;
  private writing: Promise<void> = Promise.resolve();
  private queued = false;

  constructor(
    private readonly fs: FsLike,
    private readonly kv: KeyValueLike,
  ) {}

  async load(): Promise<Dataset | null> {
    if (!(await this.fs.exists(DATA))) {
      this.cache = null;
      return null;
    }
    const text = await this.fs.readTextFile(DATA);
    try {
      this.cache = JSON.parse(text) as Dataset;
    } catch {
      // Rien n'est écrit ni copié : Repository.open en fait une LocalDataError (écran de secours).
      throw new LocalFileCorruptedError(`Le fichier ${DATA} n'est pas du JSON lisible.`);
    }
    return this.cache;
  }

  /** Écritures sérialisées ; plusieurs demandes rapprochées n'en font qu'une. */
  private scheduleWrite(): Promise<void> {
    if (this.queued) return this.writing;
    this.queued = true;
    const run = this.writing.then(async () => {
      this.queued = false;
      const text = JSON.stringify(this.cache);
      await this.fs.writeTextFile(TMP, text);
      await this.fs.rename(TMP, DATA);
    });
    this.writing = run.catch(() => undefined);
    return run;
  }

  apply(changes: Changes, preferences?: Preferences): Promise<void> {
    let next = applyChanges(this.cache ?? emptyDataset(), changes);
    if (preferences) next = { ...next, preferences };
    this.cache = next;
    return this.scheduleWrite();
  }

  replace(data: Dataset): Promise<void> {
    this.cache = data;
    return this.scheduleWrite();
  }

  async snapshot(now: number): Promise<SnapshotInfo | null> {
    await this.flush();
    if (!(await this.fs.exists(DATA))) return null;
    const text = await this.fs.readTextFile(DATA);
    await this.fs.mkdir(BACKUPS);
    const name = `data-${now}.json`;
    await this.fs.writeTextFile(`${BACKUPS}/${name}.tmp`, text);
    await this.fs.rename(`${BACKUPS}/${name}.tmp`, `${BACKUPS}/${name}`);
    const stale = (await this.snapshotNames()).slice(KEEP_SNAPSHOTS);
    for (const s of stale) await this.fs.remove(`${BACKUPS}/${s.name}`);
    return { id: String(now), takenAt: now, bytes: byteLength(text) };
  }

  /** Copies présentes, de la plus récente à la plus ancienne. */
  private async snapshotNames(): Promise<{ name: string; takenAt: number }[]> {
    if (!(await this.fs.exists(BACKUPS))) return [];
    return (await this.fs.readDir(BACKUPS))
      .filter((e) => e.isFile && SNAPSHOT_NAME.test(e.name))
      .map((e) => ({ name: e.name, takenAt: Number(SNAPSHOT_NAME.exec(e.name)![1]) }))
      .sort((a, b) => b.takenAt - a.takenAt);
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const out: SnapshotInfo[] = [];
    for (const s of await this.snapshotNames()) {
      const text = await this.fs.readTextFile(`${BACKUPS}/${s.name}`);
      out.push({ id: String(s.takenAt), takenAt: s.takenAt, bytes: byteLength(text) });
    }
    return out;
  }

  async readSnapshot(id: string): Promise<Dataset> {
    if (!/^\d+$/.test(id)) throw new Error(`Copie de sauvegarde introuvable : ${id}`);
    // Une copie prise par une version précédente est mise au format courant.
    return upgradeSchema(JSON.parse(await this.fs.readTextFile(`${BACKUPS}/data-${id}.json`)) as Dataset);
  }

  async getDevice(): Promise<DeviceState | null> {
    return (await this.kv.get<DeviceState>("device")) ?? null;
  }

  async setDevice(state: DeviceState): Promise<void> {
    await this.kv.set("device", state);
    await this.kv.save();
  }

  async requestPersistence(): Promise<boolean> {
    return true;
  }

  async flush(): Promise<void> {
    await this.writing;
  }

  async readRaw(): Promise<string | null> {
    await this.flush();
    return (await this.fs.exists(DATA)) ? this.fs.readTextFile(DATA) : null;
  }

  /** Copie data.json dans mis-de-cote/, sans y toucher : il n'est remplacé qu'ensuite, d'un seul renommage. */
  async setAside(now: number): Promise<SetAsideInfo | null> {
    const text = await this.readRaw();
    if (text === null) return null;
    await this.fs.mkdir(SET_ASIDE);
    const name = `data-${now}.json`;
    await this.fs.writeTextFile(`${SET_ASIDE}/${name}.tmp`, text);
    await this.fs.rename(`${SET_ASIDE}/${name}.tmp`, `${SET_ASIDE}/${name}`);
    return { id: String(now), setAsideAt: now, bytes: byteLength(text) };
  }

  async clear(): Promise<void> {
    await this.flush();
    if (await this.fs.exists(DATA)) await this.fs.remove(DATA);
    this.cache = null;
  }

  async listSetAside(): Promise<SetAsideInfo[]> {
    if (!(await this.fs.exists(SET_ASIDE))) return [];
    const out: SetAsideInfo[] = [];
    for (const entry of await this.fs.readDir(SET_ASIDE)) {
      const match = entry.isFile ? SET_ASIDE_NAME.exec(entry.name) : null;
      if (!match) continue;
      const text = await this.fs.readTextFile(`${SET_ASIDE}/${entry.name}`);
      out.push({ id: match[1]!, setAsideAt: Number(match[1]), bytes: byteLength(text) });
    }
    return out.sort((a, b) => b.setAsideAt - a.setAsideAt);
  }

  async readSetAside(id: string): Promise<string> {
    return this.fs.readTextFile(this.setAsidePath(id));
  }

  async removeSetAside(id: string): Promise<void> {
    await this.fs.remove(this.setAsidePath(id));
  }

  private setAsidePath(id: string): string {
    if (!/^\d+$/.test(id)) throw new Error(`Version mise de côté introuvable : ${id}`);
    return `${SET_ASIDE}/data-${id}.json`;
  }
}
