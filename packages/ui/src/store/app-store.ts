import {
  eraseEverything,
  hasLiveRecords,
  monthOf,
  newId,
  serializeBackup,
  setPreference,
  ValidationError,
  yearOf,
  type Changes,
  type Dataset,
  type Day,
  type Month,
  type OpType,
  type PrefKey,
  type Preferences,
} from "@cashmyr/core";
import {
  addProfile,
  implicitRegistry,
  PRINCIPAL,
  ProfileError,
  removeProfile,
  renameProfile,
  resetDevice,
  type AvailableUpdate,
  type DeviceState,
  type DisplayPrefs,
  type Platform,
  type ProfileEntry,
  type ProfileHost,
  type ProfileRegistry,
  type Repository,
  type SyncEngine,
  type SyncOutcome,
  type SyncState,
} from "@cashmyr/storage";
import { createStore, type StoreApi } from "zustand/vanilla";

export const DEFAULT_DISPLAY: DisplayPrefs = {
  bannerTotal: "declared",
  accountRoles: [],
  hideMonthCharts: false,
  checkUpdatesOnLaunch: true,
};

/** Choix d'affichage de l'appareil, complétés par les valeurs par défaut. */
export const displayOf = (device: DeviceState): DisplayPrefs => ({ ...DEFAULT_DISPLAY, ...device.display });

export type Tab = "dashboard" | "month" | "goals" | "debts" | "accounts" | "operations" | "settings";

export const TABS: { id: Tab; label: string; period: "year" | "month" | null }[] = [
  { id: "dashboard", label: "Tableau de bord", period: "year" },
  { id: "month", label: "Mois", period: "month" },
  { id: "goals", label: "Objectifs", period: "year" },
  { id: "debts", label: "Dettes", period: "year" },
  { id: "accounts", label: "Mes comptes", period: "year" },
  { id: "operations", label: "Opérations", period: "month" },
  { id: "settings", label: "Paramètres", period: null },
];

export type Modal =
  | { kind: "operation"; type: OpType; editId?: string }
  | { kind: "create-goal" }
  | { kind: "create-debt" }
  | { kind: "create-account"; stay?: boolean }
  | { kind: "recurrence"; editId?: string }
  | { kind: "delete-category"; categoryId: string }
  | { kind: "create-profile" }
  | { kind: "delete-profile"; profileId: string; check: ProfileCheck }
  | null;

/** Question posée dans une fenêtre de l'application, à la place de window.confirm. */
export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  /** `null` : simple avis, un seul bouton. */
  cancelLabel?: string | null;
  danger?: boolean;
};

export type Toast = { id: number; message: string; tone: "info" | "error" };

/** Profils de l'appareil (§9). `registered` : le registre a été écrit ; sinon, un seul profil implicite. */
export type ProfilesState = {
  list: ProfileEntry[];
  current: ProfileEntry;
  registered: boolean;
  /** Réglage de l'appareil une fois le registre écrit (décision 59). */
  checkUpdatesOnLaunch: boolean;
};

/**
 * Ce qu'il faut savoir avant de supprimer un profil (décisions 56, 58 et 61) :
 * - `safe` : rien ne se perd (fichier à jour, ou profil vide) ;
 * - `pending` : un autre profil a des modifications pas encore dans son fichier ; l'ouvrir les enverra ;
 * - `unsafe` : sans fichier, ou modifications qui ne sont nulle part ailleurs : sauvegarde proposée, nom à taper.
 */
export type ProfileCheck =
  | { kind: "safe"; fileName: string | null }
  | { kind: "pending"; count: number }
  | { kind: "unsafe"; reason: "no-file" | "pending"; count: number };

export type AppState = {
  platform: Platform;
  data: Dataset;
  device: DeviceState;
  fresh: boolean;
  sync: SyncState;
  today: Day;
  tab: Tab;
  year: number;
  month: Month;
  modal: Modal;
  confirm: ConfirmRequest | null;
  toasts: Toast[];
  /** Nouvelle version de l'application prête à être appliquée ; `dismissed` : bandeau fermé pour cette session. */
  update: { available: AvailableUpdate; dismissed: boolean; applying: boolean } | null;
  profiles: ProfilesState;
  actions: AppActions;
};

export type AppActions = {
  /** Écrit un lot ; en cas de refus, affiche la raison et renvoie false. */
  apply(changes: Changes, preferences?: Preferences, confirmation?: string): Promise<boolean>;
  setPreference<K extends PrefKey>(key: K, value: Preferences[K]): Promise<boolean>;
  /** Choix d'affichage de cet appareil : jamais synchronisés, ils ne comptent pas comme modifications en attente. */
  setDisplay(patch: Partial<DisplayPrefs>): Promise<void>;
  setTab(tab: Tab): void;
  setYear(year: number): void;
  setMonth(month: Month): void;
  openModal(modal: Exclude<Modal, null>): void;
  closeModal(): void;
  toast(message: string, tone?: Toast["tone"]): void;
  /** Pose une question et attend la réponse : vrai pour confirmer. */
  ask(request: ConfirmRequest): Promise<boolean>;
  answer(confirmed: boolean): void;
  dismissToast(id: number): void;
  /** Retour au premier plan : jour courant, occurrences dues, relecture du fichier. */
  onFocus(): Promise<void>;
  sync: {
    now(): Promise<SyncOutcome>;
    connect(kind: "open" | "create"): Promise<SyncOutcome>;
    disconnect(): Promise<void>;
    requestPermission(): Promise<SyncOutcome>;
    offerMerged(): Promise<"shared" | "downloaded" | "cancelled" | null>;
    createAssistedFile(): Promise<SyncOutcome>;
  };
  /** Remise à zéro (décision 45). */
  reset: {
    /** Cet appareil : passage de synchronisation s'il reste des modifications, fichier oublié, copie, données retirées, relancement. */
    device(): Promise<void>;
    /** Partout : passage de synchronisation, copie, tout supprimé et réglages par défaut, puis passage aussitôt. */
    everywhere(): Promise<boolean>;
  };
  updates: {
    /** Bureau : vérification sur demande. Une erreur est renvoyée en texte, pour l'afficher. */
    check(): Promise<"none" | "available" | { error: string }>;
    /** Termine synchronisation et écritures en cours, puis recharge ou installe. */
    apply(): Promise<void>;
    dismiss(): void;
    /** Recherche au lancement : réglage de l'appareil (décision 59). */
    setCheckOnLaunch(on: boolean): Promise<void>;
  };
  /** Profils de l'appareil (§9). Les erreurs de nom sont renvoyées en texte, pour les afficher. */
  profiles: {
    /** Relance l'application sur ce profil, une fois envoyé ce qui attend (décision 54). */
    open(profileId: string): Promise<void>;
    /** Crée un profil et l'ouvre. `firstName` renomme « Mon budget » à la création du deuxième (décision 55). */
    create(name: string, firstName?: string): Promise<string | null>;
    rename(profileId: string, name: string): Promise<string | null>;
    /** Avant de supprimer : en synchronisation automatique, le profil ouvert envoie d'abord ce qui attend. */
    inspect(profileId: string): Promise<ProfileCheck>;
    /** Enregistre une sauvegarde JSON du profil, ouvert ou non. */
    backup(profileId: string): Promise<boolean>;
    /** Retire le profil de cet appareil (décision 56) ; le profil ouvert relance l'application. */
    remove(profileId: string): Promise<boolean>;
  };
};

export type AppStore = StoreApi<AppState>;

export type AppDeps = {
  platform: Platform;
  repository: Repository;
  engine: SyncEngine;
  /** Profils de l'appareil et profil ouvert. */
  host: ProfileHost;
  profiles: Omit<ProfilesState, "checkUpdatesOnLaunch"> & { registry: ProfileRegistry | null };
  /** La recherche de mise à jour au lancement est déjà partie (avant le choix du profil). */
  launchChecked?: boolean;
  now?: () => number;
  today: () => Day;
  /** Relance l'application (après une remise à zéro de l'appareil) ; par défaut, recharge la page. */
  restart?: () => void;
};

/** L'écran d'accueil : rien n'a jamais été écrit sur l'appareil, ou il ne reste aucune ligne vivante. */
const welcome = (repo: Repository) => repo.isFresh || !hasLiveRecords(repo.data);

let toastId = 0;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createAppStore(deps: AppDeps): AppStore {
  const now = deps.now ?? Date.now;
  const restart = deps.restart ?? (() => window.location.reload());
  const { repository: repo, engine, host } = deps;
  const today = deps.today();
  const current = deps.profiles.current;

  const store = createStore<AppState>()((set, get) => {
    const toast = (message: string, tone: Toast["tone"] = "info") => {
      const id = ++toastId;
      set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
      setTimeout(() => get().actions.dismissToast(id), tone === "error" ? 8000 : 3500);
    };

    // Une seule question à la fois : une nouvelle question annule la précédente.
    let pendingAnswer: ((confirmed: boolean) => void) | null = null;

    const report = async (outcome: Promise<SyncOutcome>) => {
      const result = await outcome;
      if (result.kind === "failed") toast(result.error, "error");
      return result;
    };

    const apply: AppActions["apply"] = async (changes, preferences, confirmation) => {
      try {
        await repo.apply(changes, preferences);
        if (confirmation) toast(confirmation);
        return true;
      } catch (e) {
        const message =
          e instanceof ValidationError ? `Enregistrement refusé : ${e.issues[0] ?? "données invalides"}` : String(e);
        toast(message, "error");
        return false;
      }
    };

    return {
      platform: deps.platform,
      data: repo.data,
      device: repo.device,
      fresh: welcome(repo),
      sync: engine.state,
      today,
      tab: "dashboard",
      year: yearOf(today),
      month: monthOf(today),
      modal: null,
      confirm: null,
      toasts: [],
      update: null,
      profiles: {
        list: deps.profiles.list,
        current,
        registered: deps.profiles.registry !== null,
        checkUpdatesOnLaunch: deps.profiles.registry?.checkUpdatesOnLaunch ?? displayOf(repo.device).checkUpdatesOnLaunch,
      },
      actions: {
        apply,
        setPreference: (key, value) =>
          apply({}, setPreference(get().data.preferences, key, value, now())),
        setDisplay: async (patch) => {
          await repo.updateDevice({ display: { ...repo.device.display, ...patch } });
          set({ device: repo.device });
        },
        setTab: (tab) => set({ tab }),
        setYear: (year) => set({ year }),
        setMonth: (month) => set({ month, year: yearOf(month) }),
        openModal: (modal) => set({ modal }),
        closeModal: () => set({ modal: null }),
        toast,
        dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
        ask: (request) =>
          new Promise<boolean>((resolve) => {
            pendingAnswer?.(false);
            pendingAnswer = resolve;
            set({ confirm: request });
          }),
        answer: (confirmed) => {
          const resolve = pendingAnswer;
          pendingAnswer = null;
          set({ confirm: null });
          resolve?.(confirmed);
        },
        onFocus: async () => {
          set({ today: deps.today() });
          await report(engine.onFocus().then((r) => r ?? { kind: "skipped", reason: "not-ready" }));
        },
        sync: {
          now: () => report(engine.syncNow()),
          connect: (kind) => report(engine.connect(kind)),
          disconnect: () => engine.disconnect(),
          requestPermission: () => report(engine.requestPermission()),
          offerMerged: () => engine.offerMerged(),
          createAssistedFile: () => report(engine.createAssistedFile()),
        },
        reset: {
          device: async () => {
            const sync = get().sync;
            // Ce qui a été saisi ici et attend encore part d'abord dans le fichier : rien ne se perd.
            if (sync.automatic && sync.status === "ready" && sync.pending > 0) await report(engine.syncNow());
            await engine.whenIdle();
            await engine.disconnect();
            await repo.flush();
            await resetDevice(get().platform.local, now());
            restart();
          },
          everywhere: async () => {
            // Un passage d'abord : l'effacement couvre aussi ce que les autres appareils ont écrit.
            const ready = () => get().sync.automatic && get().sync.status === "ready";
            if (ready()) await report(engine.syncNow());
            await get().platform.local.snapshot(now());
            const { changes, preferences } = eraseEverything(get().data, now());
            const ok = await apply(changes, preferences, "Tout est effacé");
            if (ok && ready()) await report(engine.syncNow());
            return ok;
          },
        },
        updates: {
          check: async () => {
            const check = get().platform.updates?.check;
            if (!check) return "none";
            try {
              return await check();
            } catch (e) {
              return { error: errorText(e) };
            }
          },
          apply: async () => {
            const update = get().update;
            if (!update || update.applying) return;
            set({ update: { ...update, applying: true } });
            try {
              // Rien ne reste en route : ce qui attend d'être synchronisé part d'abord, puis les écritures se terminent.
              const sync = get().sync;
              if (sync.automatic && sync.status === "ready" && sync.pending > 0) await engine.syncNow();
              await engine.whenIdle();
              await get().platform.local.flush();
              await update.available.apply();
            } catch (e) {
              toast(`La mise à jour n'a pas pu être appliquée : ${errorText(e)}`, "error");
              set((s) => ({ update: s.update && { ...s.update, applying: false } }));
            }
          },
          dismiss: () => set((s) => ({ update: s.update && { ...s.update, dismissed: true } })),
          setCheckOnLaunch: async (on) => {
            if (get().profiles.registered) await saveRegistry({ ...(await registry()), checkUpdatesOnLaunch: on });
            else await get().actions.setDisplay({ checkUpdatesOnLaunch: on });
            set((s) => ({ profiles: { ...s.profiles, checkUpdatesOnLaunch: on } }));
          },
        },
        profiles: {
          open: async (profileId) => {
            await settle();
            host.session.set(profileId);
            restart();
          },
          create: async (name, firstName) =>
            nameError(async () => {
              let reg = await registry();
              if (firstName !== undefined && !get().profiles.registered) reg = renameProfile(reg, PRINCIPAL, firstName);
              const id = newId();
              reg = addProfile(reg, { id, name }, now());
              await host.prepare(id);
              await saveRegistry(reg);
              await get().actions.profiles.open(id);
            }),
          rename: (profileId, name) => nameError(async () => saveRegistry(renameProfile(await registry(), profileId, name))),
          inspect: async (profileId) => {
            if (profileId === current.id) {
              const sync = get().sync;
              if (sync.automatic && sync.status === "ready" && sync.pending > 0) await report(engine.syncNow());
              const after = get().sync;
              if (!hasLiveRecords(get().data)) return { kind: "safe", fileName: after.targetName };
              if (repo.device.sync.fileId === null) return { kind: "unsafe", reason: "no-file", count: after.pending };
              if (after.pending > 0) return { kind: "unsafe", reason: "pending", count: after.pending };
              return { kind: "safe", fileName: after.targetName };
            }
            const local = await host.localOf(profileId);
            const device = await local.getDevice();
            const pending = Object.keys(device?.dirty ?? {}).length;
            let data: Dataset | null;
            try {
              data = await local.load();
            } catch {
              // Illisible : on ne sait pas ce qui serait perdu.
              return { kind: "unsafe", reason: device?.sync.fileId ? "pending" : "no-file", count: pending };
            }
            if (!data || !hasLiveRecords(data)) return { kind: "safe", fileName: device?.sync.targetName ?? null };
            if (!device?.sync.fileId) return { kind: "unsafe", reason: "no-file", count: pending };
            if (pending > 0) return { kind: "pending", count: pending };
            return { kind: "safe", fileName: device.sync.targetName };
          },
          backup: async (profileId) => {
            try {
              const data = profileId === current.id ? get().data : await (await host.localOf(profileId)).load();
              if (!data) return false;
              const saved = await get().platform.files.saveAs(`cashmyr-sauvegarde-${deps.today()}.json`, "application/json", serializeBackup(data));
              if (saved) toast("Sauvegarde exportée");
              return saved;
            } catch (e) {
              toast(`La sauvegarde n'a pas pu être enregistrée : ${errorText(e)}`, "error");
              return false;
            }
          },
          remove: async (profileId) => {
            const isCurrent = profileId === current.id;
            let reg: ProfileRegistry;
            try {
              reg = removeProfile(await registry(), profileId);
            } catch (e) {
              toast(errorText(e), "error");
              return false;
            }
            if (isCurrent) await settle();
            // Le registre d'abord : une panne au milieu laisse au pire des données orphelines, jamais un profil sans stockage.
            try {
              await saveRegistry(reg);
            } catch (e) {
              toast(`Le profil n'a pas pu être supprimé : ${errorText(e)}`, "error");
              return false;
            }
            if (isCurrent) engine.stop();
            try {
              await host.remove(profileId);
            } catch (e) {
              toast(`Profil retiré de la liste. ${errorText(e)}`, "error");
            }
            if (isCurrent) {
              host.session.set(null);
              restart();
            } else toast("Profil supprimé de cet appareil");
            return true;
          },
        },
      },
    };

    /** Ce qui attend part dans le fichier (synchronisation automatique), puis les écritures se terminent. */
    async function settle() {
      const sync = get().sync;
      if (sync.automatic && sync.status === "ready" && sync.pending > 0) await report(engine.syncNow());
      await engine.whenIdle();
      await repo.flush();
    }

    /** Le registre tel qu'il est sur l'appareil ; sans registre, le seul profil est celui qui est ouvert. */
    async function registry(): Promise<ProfileRegistry> {
      return (
        (await host.registry.read()) ??
        implicitRegistry({
          syncFileId: repo.device.sync.fileId,
          checkUpdatesOnLaunch: displayOf(repo.device).checkUpdatesOnLaunch,
        })
      );
    }

    async function saveRegistry(reg: ProfileRegistry) {
      await host.registry.write(reg);
      const mine = reg.profiles.find((p) => p.id === current.id);
      set((s) => ({
        profiles: { list: reg.profiles, current: mine ?? s.profiles.current, registered: true, checkUpdatesOnLaunch: reg.checkUpdatesOnLaunch },
      }));
    }

    /** Refus de nom (vide, déjà pris) : renvoyé en texte ; toute autre erreur aussi, sans rien écrire de plus. */
    async function nameError(task: () => Promise<void>): Promise<string | null> {
      try {
        await task();
        return null;
      } catch (e) {
        return e instanceof ProfileError ? e.message : `L'opération n'a pas abouti : ${errorText(e)}`;
      }
    }
  });

  const updates = deps.platform.updates;
  updates?.onAvailable((available) => store.setState({ update: { available, dismissed: false, applying: false } }));
  updates?.onOfflineReady?.(() => store.getState().actions.toast("Cashmyr est enregistrée sur cet appareil : elle fonctionne désormais hors ligne."));

  // Bureau : recherche au lancement, désactivable (décisions 46 et 59). Hors ligne, elle échoue sans rien dire.
  if (updates?.check && !deps.launchChecked && store.getState().profiles.checkUpdatesOnLaunch) void updates.check().catch(() => undefined);

  repo.subscribe((data) => store.setState({ data, device: repo.device, fresh: welcome(repo) }));
  engine.subscribe((sync) => store.setState({ sync, device: repo.device }));
  return store;
}
