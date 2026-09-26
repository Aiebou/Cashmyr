import {
  applyChanges,
  assertValidDataset,
  COLLECTION_NAMES,
  dropRecords,
  emptyDataset,
  isOlderSchema,
  materializeRecurrences,
  mergeChanges,
  mergeDatasets,
  newId,
  PREF_KEYS,
  SCHEMA_VERSION,
  toLocalDay,
  upgradeSchema,
  validateDataset,
  ValidationError,
  type Changes,
  type Collections,
  type Dataset,
  type Day,
  type Preferences,
  type RecordRef,
} from "@cashmyr/core";
import type { DeviceState, LocalStore } from "./types";

export type ChangeReason = "local" | "sync" | "replace";
type Listener = (data: Dataset, reason: ChangeReason) => void;

export type RepositoryOptions = {
  local: LocalStore;
  deviceLabel: string;
  now?: () => number;
  today?: () => Day;
};

/** Clés des modifications en attente (`DeviceState.dirty`). */
export const recordKey = (collection: string, id: string) => `${collection}:${id}`;
export const prefKey = (key: string) => `pref:${key}`;

/**
 * Données locales refusées à l'ouverture : illisibles (JSON abîmé) ou invalides (refusées par
 * la validation). L'application affiche alors l'écran de secours au lieu de démarrer.
 */
export class LocalDataError extends Error {
  override name = "LocalDataError";
  constructor(
    readonly kind: "illisible" | "invalide",
    /** Message d'origine, affiché comme détail technique. */
    readonly detail: string,
  ) {
    super(
      kind === "illisible"
        ? "Les données de cet appareil sont illisibles."
        : "Les données de cet appareil contiennent des incohérences.",
    );
  }
}

/** État d'un appareil qui ouvre ce profil pour la première fois : le tutoriel l'attend (décision 65). */
function newDevice(label: string): DeviceState {
  return {
    deviceId: newId(),
    deviceLabel: label,
    sync: { fileId: null, targetName: null, lastMergeAt: null, lastOfferAt: null, lastError: null },
    dirty: {},
    tour: { seen: [] },
  };
}

/** Nombre de lignes, pierres tombales comprises. */
export const recordCount = (collections: Collections): number =>
  COLLECTION_NAMES.reduce((n, name) => n + collections[name].length, 0);

/**
 * Jeu de données de l'appareil : une seule porte d'entrée pour lire et écrire.
 * Chaque écriture est validée, matérialise les récurrences dues, est persistée
 * et comptée comme modification en attente de synchronisation.
 */
export class Repository {
  private listeners = new Set<Listener>();
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly local: LocalStore,
    private current: Dataset,
    private deviceState: DeviceState,
    private fresh: boolean,
    private readonly now: () => number,
    private readonly today: () => Day,
  ) {}

  /**
   * Ouvre le jeu local : copie de sauvegarde au démarrage, puis génération des
   * occurrences dues. Lève `LocalDataError` si les données locales sont illisibles ou
   * invalides ; aucune copie n'est alors prise, les précédentes restent bonnes.
   */
  static async open(options: RepositoryOptions): Promise<Repository> {
    const now = options.now ?? Date.now;
    const today = options.today ?? (() => toLocalDay(new Date()));
    let loaded: Dataset | null;
    try {
      loaded = await options.local.load();
    } catch (e) {
      if (e instanceof Error && e.name === "LocalFileCorruptedError") throw new LocalDataError("illisible", e.message);
      throw e;
    }
    if (loaded) {
      // Données d'une version plus récente : elles ne sont pas abîmées, l'application est en retard.
      // Pas d'écran de secours, qui les mettrait de côté.
      const version = (loaded as { schemaVersion?: unknown }).schemaVersion;
      if (typeof version === "number" && version > SCHEMA_VERSION) {
        throw new Error(
          "Les données de cet appareil viennent d'une version plus récente de Cashmyr. Mets l'application à jour : rien n'a été modifié.",
        );
      }
      // Données d'une version plus ancienne : mises au format courant, validées, puis réécrites (décision 50).
      const older = isOlderSchema(loaded);
      if (older) loaded = upgradeSchema(loaded);
      try {
        assertValidDataset(loaded);
      } catch (e) {
        if (e instanceof ValidationError) throw new LocalDataError("invalide", e.message);
        throw e;
      }
      if (older) await options.local.replace(loaded);
      await options.local.snapshot(now());
    }
    let device = await options.local.getDevice();
    if (!device) {
      device = newDevice(options.deviceLabel);
      await options.local.setDevice(device);
    }
    const repo = new Repository(options.local, loaded ?? emptyDataset(), device, loaded === null, now, today);
    await repo.refreshDay();
    return repo;
  }

  get data(): Dataset {
    return this.current;
  }

  get device(): DeviceState {
    return this.deviceState;
  }

  /** Vrai tant que rien n'a jamais été écrit sur cet appareil : écran d'accueil. */
  get isFresh(): boolean {
    return this.fresh;
  }

  /** Nombre de modifications locales pas encore confirmées dans le fichier de synchronisation. */
  get pending(): number {
    return Object.keys(this.deviceState.dirty).length;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(reason: ChangeReason): void {
    for (const l of this.listeners) l(this.current, reason);
  }

  /** Les écritures passent une par une, dans l'ordre d'arrivée. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private markDirty(changes: Changes, before: Preferences, after: Preferences): void {
    const dirty = { ...this.deviceState.dirty };
    for (const name of COLLECTION_NAMES) {
      for (const r of changes[name] ?? []) dirty[recordKey(name, r.id)] = r.updatedAt;
    }
    for (const key of PREF_KEYS) {
      if (after.updatedAt[key] !== before.updatedAt[key]) dirty[prefKey(key)] = after.updatedAt[key];
    }
    this.deviceState = { ...this.deviceState, dirty };
  }

  /** Ajoute les occurrences dues à un jeu en cours de construction. */
  private withOccurrences(next: Dataset, changes: Changes): { next: Dataset; changes: Changes } {
    const generated = materializeRecurrences(next, this.today(), this.now());
    if (generated.length === 0) return { next, changes };
    return {
      next: applyChanges(next, { operations: generated }),
      changes: mergeChanges(changes, { operations: generated }),
    };
  }

  /**
   * Écrit des lignes (et, si fournies, les préférences). Refuse tout le lot si le
   * résultat viole un invariant : rien n'est alors écrit.
   */
  apply(changes: Changes, preferences?: Preferences): Promise<void> {
    return this.serial(async () => {
      const before = this.current;
      let next = applyChanges(before, changes);
      if (preferences) next = { ...next, preferences };
      const built = this.withOccurrences(next, changes);
      const issues = validateDataset(built.next);
      if (issues.length > 0) throw new ValidationError(issues);
      // Premier enregistrement : les préférences partent avec, sinon le jeu ne se relirait pas.
      await this.local.apply(built.changes, preferences ?? (this.fresh ? built.next.preferences : undefined));
      this.markDirty(built.changes, before.preferences, built.next.preferences);
      await this.local.setDevice(this.deviceState);
      this.current = built.next;
      this.fresh = false;
      this.emit("local");
    });
  }

  /** Génère les occurrences devenues dues (lancement, retour au premier plan, changement de jour). */
  refreshDay(): Promise<void> {
    return this.serial(async () => {
      const built = this.withOccurrences(this.current, {});
      if (built.next === this.current) return;
      await this.local.apply(built.changes);
      this.markDirty(built.changes, this.current.preferences, built.next.preferences);
      await this.local.setDevice(this.deviceState);
      this.current = built.next;
      this.fresh = false;
      this.emit("local");
    });
  }

  /**
   * Adopte le résultat d'une fusion calculée à partir de `base`. Si le jeu a changé
   * entre-temps, les deux sont fusionnés : rien de ce qui a été saisi pendant la
   * synchronisation n'est perdu.
   */
  acceptMerge(merged: Dataset, base: Dataset): Promise<void> {
    return this.serial(async () => {
      const latest = this.current === base ? merged : mergeDatasets(this.current, merged).data;
      const built = this.withOccurrences(latest, {});
      assertValidDataset(built.next);
      await this.local.replace(built.next);
      this.markDirty(built.changes, built.next.preferences, built.next.preferences);
      await this.local.setDevice(this.deviceState);
      this.current = built.next;
      if (recordCount(built.next.collections) > 0) this.fresh = false;
      this.emit("sync");
    });
  }

  /** Remplace tout le jeu (import, restauration) ; tout devient à synchroniser. */
  replaceAll(data: Dataset): Promise<void> {
    return this.serial(async () => {
      const built = this.withOccurrences(data, {});
      assertValidDataset(built.next);
      await this.local.replace(built.next);
      const all: Changes = {};
      for (const name of COLLECTION_NAMES) (all as Record<string, unknown>)[name] = built.next.collections[name];
      this.markDirty(all, emptyDataset().preferences, built.next.preferences);
      await this.local.setDevice(this.deviceState);
      this.current = built.next;
      this.fresh = false;
      this.emit("replace");
    });
  }

  /** Retire des lignes (réponse « les écarter » quand un appareil évincé revient). */
  dropRecords(refs: RecordRef[]): Promise<void> {
    return this.serial(async () => {
      const next = dropRecords(this.current, refs);
      await this.local.replace(next);
      const dirty = { ...this.deviceState.dirty };
      for (const r of refs) delete dirty[recordKey(r.collection, r.id)];
      this.deviceState = { ...this.deviceState, dirty };
      await this.local.setDevice(this.deviceState);
      this.current = next;
      this.emit("sync");
    });
  }

  /**
   * Retire des modifications en attente celles que le fichier contient désormais,
   * dans leur version ou une plus récente.
   */
  confirmInFile(file: { collections: Collections; preferences: Preferences }): Promise<void> {
    return this.serial(async () => {
      const inFile = new Map<string, number>();
      for (const name of COLLECTION_NAMES) {
        for (const r of file.collections[name]) inFile.set(recordKey(name, r.id), r.updatedAt);
      }
      for (const key of PREF_KEYS) inFile.set(prefKey(key), file.preferences.updatedAt[key]);
      const here = new Set(PREF_KEYS.map(prefKey));
      for (const name of COLLECTION_NAMES) for (const r of this.current.collections[name]) here.add(recordKey(name, r.id));
      const dirty: Record<string, number> = {};
      for (const [key, stamp] of Object.entries(this.deviceState.dirty)) {
        // Une ligne purgée entre-temps n'a plus rien à envoyer.
        if (!here.has(key)) continue;
        const there = inFile.get(key);
        if (there === undefined || there < stamp) dirty[key] = stamp;
      }
      this.deviceState = { ...this.deviceState, dirty };
      await this.local.setDevice(this.deviceState);
    });
  }

  updateDevice(patch: Partial<Omit<DeviceState, "dirty" | "deviceId">>): Promise<void> {
    return this.serial(async () => {
      this.deviceState = { ...this.deviceState, ...patch };
      await this.local.setDevice(this.deviceState);
    });
  }

  /** Attend la fin des écritures en cours. */
  async flush(): Promise<void> {
    await this.queue;
    await this.local.flush();
  }
}
