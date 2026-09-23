import type { Changes, Dataset, Preferences } from "@cashmyr/core";

/** État propre à l'appareil, jamais synchronisé. */
export type DeviceState = {
  /** Aléatoire, jamais un nom de machine. */
  deviceId: string;
  /** « Mac », « Safari iPhone »… affiché dans le registre du fichier. */
  deviceLabel: string;
  sync: {
    /** Fichier de synchronisation avec lequel cet appareil a fusionné pour la dernière fois. */
    fileId: string | null;
    targetName: string | null;
    /** Dernière fusion réussie. */
    lastMergeAt: number | null;
    /** Mode assisté : dernier fichier fusionné proposé à l'enregistrement. */
    lastOfferAt: number | null;
    lastError: string | null;
  };
  /**
   * Modifications locales pas encore confirmées dans le fichier :
   * "collection:id" ou "pref:clé" → updatedAt de la version modifiée.
   */
  dirty: Record<string, number>;
};

export type SnapshotInfo = { id: string; takenAt: number; bytes: number };

/** Source de vérité locale de l'appareil. */
export interface LocalStore {
  readonly kind: "indexeddb" | "file";
  /** null au premier lancement. */
  load(): Promise<Dataset | null>;
  /** Écriture incrémentale des lignes et, le cas échéant, des préférences. */
  apply(changes: Changes, preferences?: Preferences): Promise<void>;
  /** Remplacement complet, après une fusion ou un import. */
  replace(data: Dataset): Promise<void>;
  /** Copie de sauvegarde du jeu actuel ; les cinq plus récentes sont conservées. */
  snapshot(now: number): Promise<SnapshotInfo | null>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  readSnapshot(id: string): Promise<Dataset>;
  getDevice(): Promise<DeviceState | null>;
  setDevice(state: DeviceState): Promise<void>;
  /** Web : demande de stockage persistant ; bureau : toujours vrai. */
  requestPersistence(): Promise<boolean>;
  /** Attend la fin des écritures en cours. */
  flush(): Promise<void>;
}

export type SyncTargetStatus = "unconfigured" | "ready" | "needs-permission" | "missing";

/** Accès direct au fichier : bureau Tauri, Chromium de bureau. */
export interface AutoSyncFile {
  readonly mode: "auto";
  readonly via: "tauri" | "fs-access";
  /** Sélecteur natif ; null si l'utilisateur annule. Doit suivre un geste de l'utilisateur. */
  choose(kind: "open" | "create"): Promise<{ name: string } | null>;
  status(): Promise<SyncTargetStatus>;
  /** fs-access : redemande la permission (geste de l'utilisateur requis) ; tauri : toujours vrai. */
  requestPermission(): Promise<boolean>;
  targetName(): Promise<string | null>;
  /** Contenu brut ; null si le fichier a disparu. */
  read(): Promise<string | null>;
  /** Écriture complète et atomique : l'original n'est remplacé qu'une fois la copie terminée. */
  writeAtomic(content: string): Promise<void>;
  forget(): Promise<void>;
}

/** Synchronisation assistée : l'utilisateur apporte le fichier, puis enregistre le fichier fusionné. */
export interface AssistedSyncFile {
  readonly mode: "assisted";
  /** Ouvre le sélecteur de fichiers ; null si l'utilisateur annule. */
  pickAndRead(): Promise<{ name: string; content: string } | null>;
  /** Propose le fichier fusionné (partage natif ou téléchargement). */
  offer(content: string, name: string): Promise<"shared" | "downloaded" | "cancelled">;
}

export type SyncFile = AutoSyncFile | AssistedSyncFile;

/** Exports CSV / JSON et import JSON, hors synchronisation. */
export interface FileIO {
  saveAs(name: string, mime: string, content: string): Promise<boolean>;
  openText(accept: readonly string[]): Promise<{ name: string; content: string } | null>;
}

export interface AppUpdates {
  /** Une nouvelle version est prête : l'application propose de recharger. */
  onAvailable(cb: (apply: () => Promise<void>) => void): () => void;
  /** Bureau : vérification sur demande seulement. */
  check?: () => Promise<"none" | "available">;
}

/** Tout ce qui diffère d'une cible à l'autre. Les écrans ne lisent que ces capacités. */
export interface Platform {
  /** Affichage seulement. */
  target: "web" | "desktop";
  deviceLabel: string;
  local: LocalStore;
  sync: SyncFile;
  files: FileIO;
  /** Branché avec le service worker et l'updater (étape 6). */
  updates?: AppUpdates;
  shortcutHint: string | null;
}
