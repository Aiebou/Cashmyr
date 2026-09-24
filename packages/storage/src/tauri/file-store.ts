import { applyChanges, emptyDataset, type Changes, type Dataset, type Preferences } from "@cashmyr/core";
import type { DeviceState, LocalStore, SnapshotInfo } from "../types";

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

const byteLength = (text: string) => new TextEncoder().encode(text).length;

export class LocalFileCorruptedError extends Error {
  override name = "LocalFileCorruptedError";
}

/**
 * Marche à suivre quand `data.json` est illisible ou invalide au démarrage. L'application ne
 * s'ouvre pas : Paramètres → Sauvegardes est hors d'atteinte. Les fichiers de `backups/` sont des
 * copies exactes de `data.json`, prises à chaque ouverture réussie, et jamais à partir d'un
 * fichier refusé : la plus récente est donc bonne.
 */
export function localRecoverySteps(dataDir: string): string[] {
  const sep = dataDir.includes("\\") ? "\\" : "/";
  return [
    "Quitte Cashmyr.",
    `Ouvre le dossier ${dataDir} (sur Mac : Finder, menu Aller → Aller au dossier…, puis colle ce chemin).`,
    `Renomme ${DATA} en data-illisible.json : il reste là, rien n'est effacé.`,
    `Dans le sous-dossier ${dataDir}${sep}${BACKUPS}, copie le fichier data-….json au plus grand numéro : c'est la copie la plus récente. Colle-la dans le dossier de l'étape 2 et renomme-la ${DATA}.`,
    "Relance Cashmyr : tu retrouves tes données telles qu'à la dernière ouverture réussie. Si la synchronisation est en place, " +
      "ce qui avait été synchronisé depuis revient à la synchronisation suivante. Si Cashmyr refuse encore de démarrer, " +
      "recommence avec la copie précédente.",
  ];
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
      // Rien n'est écrit ni copié : les copies de sauvegarde restent intactes (voir localRecoverySteps).
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
    return JSON.parse(await this.fs.readTextFile(`${BACKUPS}/data-${id}.json`)) as Dataset;
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
}
