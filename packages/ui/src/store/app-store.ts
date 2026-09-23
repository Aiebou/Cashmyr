import {
  monthOf,
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
import type { DeviceState, Platform, Repository, SyncEngine, SyncOutcome, SyncState } from "@cashmyr/storage";
import { createStore, type StoreApi } from "zustand/vanilla";

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
  actions: AppActions;
};

export type AppActions = {
  /** Écrit un lot ; en cas de refus, affiche la raison et renvoie false. */
  apply(changes: Changes, preferences?: Preferences, confirmation?: string): Promise<boolean>;
  setPreference<K extends PrefKey>(key: K, value: Preferences[K]): Promise<boolean>;
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
};

export type AppStore = StoreApi<AppState>;

export type AppDeps = {
  platform: Platform;
  repository: Repository;
  engine: SyncEngine;
  now?: () => number;
  today: () => Day;
};

let toastId = 0;

export function createAppStore(deps: AppDeps): AppStore {
  const now = deps.now ?? Date.now;
  const { repository: repo, engine } = deps;
  const today = deps.today();

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
      fresh: repo.isFresh,
      sync: engine.state,
      today,
      tab: "dashboard",
      year: yearOf(today),
      month: monthOf(today),
      modal: null,
      confirm: null,
      toasts: [],
      actions: {
        apply,
        setPreference: (key, value) =>
          apply({}, setPreference(get().data.preferences, key, value, now())),
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
      },
    };
  });

  repo.subscribe((data) => store.setState({ data, device: repo.device, fresh: repo.isFresh }));
  engine.subscribe((sync) => store.setState({ sync, device: repo.device }));
  return store;
}
