import type { Changes, Dataset, Preferences, Role, WorthMode } from "@cashmyr/core";
import type { ProfileEntry, ProfileRegistryStore } from "./profiles";

/** Choix d'affichage propres à l'appareil, jamais synchronisés (version 0.2.0). */
export type DisplayPrefs = {
  /** Total du bandeau des comptes (décision 42). */
  bannerTotal: WorthMode;
  /** Types de comptes montrés dans Mes comptes ; vide = tous. */
  accountRoles: Role[];
  /** Camemberts de l'écran Mois masqués. */
  hideMonthCharts: boolean;
  /**
   * Bureau : recherche d'une mise à jour au lancement (décision 46). Lu ici tant que l'appareil n'a
   * qu'un profil implicite ; ensuite, c'est le registre des profils qui le porte (décision 59).
   */
  checkUpdatesOnLaunch: boolean;
};

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
  /** Absent avant la version 0.2.0 : valeurs par défaut. */
  display?: Partial<DisplayPrefs>;
  /**
   * Tutoriel (décisions 65 à 67) : onglets déjà présentés sur cet appareil. Absent pour un profil
   * ouvert avant la 0.4.0, qui ne voit donc pas le tutoriel sans le demander.
   */
  tour?: { seen: string[] };
};

export type SnapshotInfo = { id: string; takenAt: number; bytes: number };

/** Version des données locales mise de côté par l'écran de secours (décision 40). */
export type SetAsideInfo = { id: string; setAsideAt: number; bytes: number };

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

  // Écran de secours (décisions 38 à 40) : données locales refusées à l'ouverture.
  /** Données locales telles qu'elles sont stockées, même illisibles ou invalides ; null s'il n'y en a pas. */
  readRaw(): Promise<string | null>;
  /**
   * Copie les données locales actuelles de côté, sans les retirer : si la suite échoue,
   * l'appareil reste dans l'état d'avant. Bureau : un fichier par incident ; web : la dernière seulement.
   */
  setAside(now: number): Promise<SetAsideInfo | null>;
  /** Retire les données locales : `load()` renvoie ensuite null (écran d'accueil). */
  clear(): Promise<void>;
  /** Versions mises de côté, de la plus récente à la plus ancienne. */
  listSetAside(): Promise<SetAsideInfo[]>;
  readSetAside(id: string): Promise<string>;
  removeSetAside(id: string): Promise<void>;
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

/** Nouvelle version de l'application, prête à être appliquée. */
export type AvailableUpdate = {
  /** Numéro de la nouvelle version, quand la plateforme le connaît (bureau). */
  version: string | null;
  /** « reload » : la PWA recharge la page ; « restart » : le bureau installe puis redémarre. */
  kind: "reload" | "restart";
  apply(): Promise<void>;
};

/** Mises à jour de l'application elle-même, jamais des données. */
export interface AppUpdates {
  /** Version en service. */
  readonly version: string;
  /** Une nouvelle version est prête. Rappelé aussitôt si elle l'était déjà. L'application propose, ne force jamais. */
  onAvailable(cb: (update: AvailableUpdate) => void): () => void;
  /** PWA : la coquille est en cache, l'application marche désormais hors ligne. Rappelé aussitôt si c'est déjà le cas. */
  onOfflineReady?: (cb: () => void) => () => void;
  /**
   * Bureau : vérification au lancement, sauf si l'appareil l'a désactivée, et sur demande
   * (décision 46, qui remplace la 17). Seul appel réseau de l'application. Une version trouvée
   * est aussi annoncée par `onAvailable`.
   */
  check?: () => Promise<"none" | "available">;
}

/** Tout ce qui diffère d'une cible à l'autre. Les écrans ne lisent que ces capacités. */
export interface Platform {
  /** Affichage seulement. */
  target: "web" | "desktop";
  deviceLabel: string;
  /** Stockage et synchronisation du profil ouvert. */
  local: LocalStore;
  sync: SyncFile;
  /** Nom proposé pour le fichier de synchronisation du profil ouvert. */
  syncFileName: string;
  files: FileIO;
  /** Service worker de la PWA, updater du bureau. Absent en test. */
  updates?: AppUpdates;
  shortcutHint: string | null;
}

/**
 * Les profils de l'appareil (§9) : ce que chaque point d'entrée assemble et passe à `startApp`.
 * `LocalStore` et `SyncFile` ne voient jamais qu'un profil ; l'hôte dit lesquels existent et
 * ouvre celui qui est choisi.
 */
export interface ProfileHost {
  registry: ProfileRegistryStore;
  /** Stockage, synchronisation et capacités du profil choisi. Bureau : le choisit aussi côté Rust. */
  open(profile: ProfileEntry): Promise<Platform>;
  /** Stockage local d'un profil, sans l'ouvrir : état de l'appareil, données pour une sauvegarde. */
  localOf(profileId: string): Promise<LocalStore>;
  /** Prépare le stockage d'un nouveau profil (bureau : son dossier). */
  prepare(profileId: string): Promise<void>;
  /** Retire tout le stockage local d'un profil, copies comprises. Son fichier de synchronisation n'est pas touché. */
  remove(profileId: string): Promise<void>;
  /** Profil à rouvrir sans repasser par le choix : noté pour la session, par un changement de profil ou un rechargement. */
  session: { get(): string | null; set(profileId: string | null): void };
  /** Service worker de la PWA, updater du bureau : ne dépendent d'aucun profil. */
  updates?: AppUpdates;
}
