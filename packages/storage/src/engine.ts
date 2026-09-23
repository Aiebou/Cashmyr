import {
  findPurgedElsewhere,
  newId,
  newSyncDocument,
  parseSyncDocument,
  serializeSyncDocument,
  SyncFileError,
  syncWithDocument,
  type RecordRef,
  type SyncDocument,
  type SyncReport,
} from "@cashmyr/core";
import { recordCount, type Repository } from "./repository";
import type { AssistedSyncFile, AutoSyncFile, SyncFile, SyncTargetStatus } from "./types";

export type SyncMode = "auto-tauri" | "auto-fs-access" | "assisted";

export type SyncState = {
  mode: SyncMode;
  /** Vrai si la synchronisation se fait d'elle-même ; faux en mode assisté, qui n'agit que sur demande. */
  automatic: boolean;
  status: SyncTargetStatus | "syncing" | "error";
  targetName: string | null;
  lastMergeAt: number | null;
  lastOfferAt: number | null;
  /** Modifications locales pas encore confirmées dans le fichier. */
  pending: number;
  /** Mode assisté : un fichier fusionné attend d'être enregistré à la place de l'original. */
  offerReady: boolean;
  lastError: string | null;
};

export type SyncOutcome =
  | { kind: "merged"; report: SyncReport; wrote: boolean; offerReady: boolean }
  | { kind: "skipped"; reason: "not-ready" | "cancelled" }
  | { kind: "failed"; error: string };

export type SyncHooks = {
  /**
   * Premier passage de cet appareil sur ce fichier, alors que les deux côtés ont
   * déjà des données : elles seront réunies. Vrai pour continuer.
   */
  confirmFirstJoin(info: { localRecords: number; fileRecords: number; fileName: string | null }): Promise<boolean>;
  /**
   * Appareil resté trop longtemps sans synchroniser : ces lignes ont sans doute été
   * supprimées ailleurs. Vrai pour les écarter, faux pour les garder.
   */
  confirmDropPurged(suspects: RecordRef[]): Promise<boolean>;
};

type Timers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type SyncEngineOptions = {
  repository: Repository;
  sync: SyncFile;
  hooks: SyncHooks;
  /** Délai entre une modification et l'écriture du fichier, en mode automatique. */
  debounceMs?: number;
  now?: () => number;
  newFileId?: () => string;
  timers?: Timers;
};

export const SYNC_FILE_NAME = "finances-sync.json";

const message = (e: unknown): string =>
  e instanceof SyncFileError || e instanceof Error ? e.message : String(e);

/**
 * Orchestration de la synchronisation : lire le fichier, fusionner, adopter le
 * résultat localement, écrire le fichier fusionné. Jamais d'écriture à l'aveugle :
 * chaque écriture suit une lecture et une fusion. Les passages sont sérialisés.
 */
export class SyncEngine {
  private readonly repo: Repository;
  private readonly sync: SyncFile;
  private readonly hooks: SyncHooks;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private readonly newFileId: () => string;
  private readonly timers: Timers;
  private listeners = new Set<(s: SyncState) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private timer: unknown = null;
  private unsubscribe: (() => void) | null = null;
  private current: SyncState;
  private pendingOffer: { content: string; name: string } | null = null;

  constructor(options: SyncEngineOptions) {
    this.repo = options.repository;
    this.sync = options.sync;
    this.hooks = options.hooks;
    this.debounceMs = options.debounceMs ?? 2000;
    this.now = options.now ?? Date.now;
    this.newFileId = options.newFileId ?? newId;
    this.timers = options.timers ?? {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    const device = this.repo.device;
    this.current = {
      mode: this.sync.mode === "assisted" ? "assisted" : this.sync.via === "tauri" ? "auto-tauri" : "auto-fs-access",
      automatic: this.sync.mode === "auto",
      status: this.sync.mode === "assisted" && device.sync.fileId ? "ready" : "unconfigured",
      targetName: device.sync.targetName,
      lastMergeAt: device.sync.lastMergeAt,
      lastOfferAt: device.sync.lastOfferAt,
      pending: this.repo.pending,
      offerReady: false,
      lastError: device.sync.lastError,
    };
  }

  get state(): SyncState {
    return this.current;
  }

  subscribe(listener: (s: SyncState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<SyncState>): void {
    this.current = { ...this.current, ...patch, pending: this.repo.pending };
    for (const l of this.listeners) l(this.current);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Au lancement : suit les modifications locales et, en mode automatique, synchronise. */
  async start(): Promise<SyncOutcome | null> {
    // Les fusions du moteur lui-même ne relancent pas de passage.
    this.unsubscribe ??= this.repo.subscribe((_, reason) => {
      if (reason !== "sync") this.notifyLocalChange();
    });
    if (this.sync.mode !== "auto") return null;
    const status = await this.sync.status();
    this.set({ status, targetName: (await this.sync.targetName()) ?? this.current.targetName });
    return status === "ready" ? this.syncNow() : null;
  }

  /** Résout une fois les passages en cours terminés (tests, fermeture de l'application). */
  async whenIdle(): Promise<void> {
    await this.queue;
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Après chaque modification : mode automatique, écriture différée ; mode assisté, compteur seulement. */
  notifyLocalChange(): void {
    this.set({});
    if (this.sync.mode !== "auto" || this.current.status === "unconfigured") return;
    if (this.repo.pending === 0) return;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, this.debounceMs);
  }

  /** Retour au premier plan : occurrences du jour, puis relecture du fichier en mode automatique. */
  async onFocus(): Promise<SyncOutcome | null> {
    await this.repo.refreshDay();
    if (this.sync.mode !== "auto" || this.current.status === "unconfigured") return null;
    return this.syncNow();
  }

  /** Synchronise maintenant. En mode assisté, ouvre le sélecteur de fichiers. */
  syncNow(): Promise<SyncOutcome> {
    return this.serial(() => (this.sync.mode === "auto" ? this.runAuto(this.sync) : this.runAssisted(this.sync)));
  }

  /** Mode automatique : choisit le fichier (existant ou nouveau), puis synchronise. */
  connect(kind: "open" | "create"): Promise<SyncOutcome> {
    return this.serial(async () => {
      const sync = this.sync;
      if (sync.mode !== "auto") throw new Error("connect() est réservé au mode automatique.");
      const chosen = await sync.choose(kind);
      if (!chosen) return { kind: "skipped", reason: "cancelled" } as const;
      await this.repo.updateDevice({ sync: { ...this.repo.device.sync, targetName: chosen.name, lastError: null } });
      this.set({ status: "ready", targetName: chosen.name, lastError: null });
      return this.runAuto(sync, kind === "create");
    });
  }

  /** Mode automatique : oublie le fichier. Les données locales restent intactes. */
  disconnect(): Promise<void> {
    return this.serial(async () => {
      if (this.sync.mode === "auto") await this.sync.forget();
      await this.repo.updateDevice({
        sync: { fileId: null, targetName: null, lastMergeAt: null, lastOfferAt: null, lastError: null },
      });
      if (this.timer !== null) this.timers.clearTimeout(this.timer);
      this.timer = null;
      this.set({ status: "unconfigured", targetName: null, lastMergeAt: null, lastOfferAt: null, lastError: null });
    });
  }

  /** Chromium : redemande l'accès au fichier (geste de l'utilisateur), puis synchronise. */
  requestPermission(): Promise<SyncOutcome> {
    return this.serial(async () => {
      if (this.sync.mode !== "auto") return { kind: "skipped", reason: "not-ready" } as const;
      const granted = await this.sync.requestPermission();
      if (!granted) {
        this.set({ status: "needs-permission" });
        return { kind: "skipped", reason: "not-ready" } as const;
      }
      return this.runAuto(this.sync);
    });
  }

  /** Mode assisté, premier appareil : propose un nouveau fichier de synchronisation à enregistrer. */
  createAssistedFile(): Promise<SyncOutcome> {
    return this.serial(async () => {
      if (this.sync.mode !== "assisted") throw new Error("createAssistedFile() est réservé au mode assisté.");
      return this.mergeWith(newSyncDocument(this.newFileId()), SYNC_FILE_NAME, this.sync);
    });
  }

  /**
   * Mode assisté : propose le fichier fusionné (partage natif ou téléchargement).
   * À appeler depuis un geste de l'utilisateur : iOS refuse le partage sinon.
   */
  offerMerged(): Promise<"shared" | "downloaded" | "cancelled" | null> {
    return this.serial(async () => {
      if (this.sync.mode !== "assisted" || !this.pendingOffer) return null;
      const result = await this.sync.offer(this.pendingOffer.content, this.pendingOffer.name);
      if (result === "cancelled") return result;
      this.pendingOffer = null;
      const lastOfferAt = this.now();
      await this.repo.updateDevice({ sync: { ...this.repo.device.sync, lastOfferAt } });
      this.set({ offerReady: false, lastOfferAt });
      return result;
    });
  }

  private async runAuto(sync: AutoSyncFile, creating = false): Promise<SyncOutcome> {
    try {
      const status = await sync.status();
      if (status !== "ready") {
        this.set({ status });
        return { kind: "skipped", reason: "not-ready" };
      }
      this.set({ status: "syncing" });
      const text = await sync.read();
      if (text === null && !creating) {
        this.set({ status: "missing" });
        return { kind: "skipped", reason: "not-ready" };
      }
      const name = await sync.targetName();
      let doc: SyncDocument;
      if (text === null || (creating && text.trim() === "")) doc = newSyncDocument(this.newFileId());
      else {
        try {
          doc = parseSyncDocument(text);
        } catch (e) {
          // Un fichier choisi « à créer » qui n'est pas un fichier Cashmyr est remplacé ;
          // tout autre fichier illisible est laissé intact.
          if (!(creating && e instanceof SyncFileError && e.code === "not-a-sync-file")) throw e;
          doc = newSyncDocument(this.newFileId());
        }
      }
      return await this.mergeWith(doc, name, sync);
    } catch (e) {
      return this.fail(e);
    }
  }

  private async runAssisted(sync: AssistedSyncFile): Promise<SyncOutcome> {
    try {
      const picked = await sync.pickAndRead();
      if (!picked) return { kind: "skipped", reason: "cancelled" };
      this.set({ status: "syncing" });
      return await this.mergeWith(parseSyncDocument(picked.content), picked.name, sync);
    } catch (e) {
      return this.fail(e);
    }
  }

  private async fail(e: unknown): Promise<SyncOutcome> {
    const error = message(e);
    await this.repo.updateDevice({ sync: { ...this.repo.device.sync, lastError: error } });
    this.set({ status: "error", lastError: error });
    return { kind: "failed", error };
  }

  private restoreStatus(): void {
    this.set({ status: this.sync.mode === "auto" || this.repo.device.sync.fileId ? "ready" : "unconfigured" });
  }

  private async mergeWith(doc: SyncDocument, fileName: string | null, sync: SyncFile): Promise<SyncOutcome> {
    const device = this.repo.device;
    if (device.sync.fileId !== doc.fileId) {
      const localRecords = recordCount(this.repo.data.collections);
      const fileRecords = recordCount(doc.collections);
      if (localRecords > 0 && fileRecords > 0) {
        const ok = await this.hooks.confirmFirstJoin({ localRecords, fileRecords, fileName });
        if (!ok) {
          this.restoreStatus();
          return { kind: "skipped", reason: "cancelled" };
        }
      }
    }
    const suspects = findPurgedElsewhere(this.repo.data, doc, {
      id: device.deviceId,
      knownFileId: device.sync.fileId,
      lastMergeAt: device.sync.lastMergeAt,
    });
    if (suspects.length > 0 && (await this.hooks.confirmDropPurged(suspects))) {
      await this.repo.dropRecords(suspects);
    }

    const base = this.repo.data;
    const now = this.now();
    const result = syncWithDocument({
      local: base,
      remote: doc,
      device: { id: device.deviceId, label: device.deviceLabel },
      now,
    });
    await this.repo.acceptMerge(result.dataset, base);
    // Ce que le fichier contient déjà est confirmé, quoi qu'il arrive ensuite.
    await this.repo.confirmInFile(doc);

    let wrote = false;
    const content = serializeSyncDocument(result.document);
    if (sync.mode === "auto") {
      if (result.report.needsWrite) {
        await sync.writeAtomic(content);
        wrote = true;
        await this.repo.confirmInFile(result.document);
      }
    } else {
      this.pendingOffer = { content, name: fileName ?? SYNC_FILE_NAME };
    }

    const lastOfferAt = device.sync.lastOfferAt;
    await this.repo.updateDevice({
      sync: { fileId: doc.fileId, targetName: fileName, lastMergeAt: now, lastOfferAt, lastError: null },
    });
    const offerReady = this.pendingOffer !== null;
    this.set({ status: "ready", targetName: fileName, lastMergeAt: now, lastOfferAt, lastError: null, offerReady });
    // Des occurrences ont pu être générées à l'issue de la fusion : elles partiront au prochain passage.
    if (sync.mode === "auto" && this.repo.pending > 0) this.notifyLocalChange();
    return { kind: "merged", report: result.report, wrote, offerReady };
  }
}
