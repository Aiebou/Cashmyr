import { deleteDB, openDB } from "idb";
import { isProfileId, parseProfileRegistry, PRINCIPAL, syncFileNameFor, type ProfileRegistryStore } from "../profiles";
import type { Platform, ProfileHost, SyncFile } from "../types";
import { createAssistedSync, createWebFileIO, type BrowserEnv } from "./assisted";
import { createFsAccessSync, type FsFileHandle, type FsPickers } from "./fs-access";
import { IndexedDbLocalStore } from "./indexeddb";

export { createAssistedSync, createWebFileIO, downloadText, pickTextFile, type BrowserEnv } from "./assisted";
export { createFsAccessSync, type FsFileHandle, type FsPickers, type HandleStore } from "./fs-access";
export { IndexedDbLocalStore } from "./indexeddb";
export { createPwaUpdates, type RegisterSW } from "./updates";

type WindowLike = {
  showOpenFilePicker?: unknown;
  showSaveFilePicker?: unknown;
  navigator: { userAgent: string; userAgentData?: { mobile?: boolean } };
};

/**
 * Accès direct au fichier seulement sur un Chromium de bureau. Tout mobile, Safari
 * et Firefox passent en synchronisation assistée, même si une API partielle existe.
 */
export function detectWebSyncMode(win: WindowLike): "fs-access" | "assisted" {
  const mobile = win.navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(win.navigator.userAgent);
  const hasPickers = typeof win.showOpenFilePicker === "function" && typeof win.showSaveFilePicker === "function";
  return hasPickers && !mobile ? "fs-access" : "assisted";
}

const SYNC_HANDLE_KEY = "syncHandle";
const REGISTRY_DB = "cashmyr-profils";
const REGISTRY_KEY = "registry";
const SESSION_KEY = "cashmyr.profil";

/** Base IndexedDB d'un profil : `cashmyr` pour le premier, qui reste où il était (décision 55). */
export const profileDbName = (profileId: string): string => (profileId === PRINCIPAL ? "cashmyr" : `cashmyr-${profileId}`);

/** Registre des profils de la PWA, dans sa propre base. Rien n'y est écrit tant qu'il n'y a qu'un profil. */
export function createIdbRegistryStore(name = REGISTRY_DB): ProfileRegistryStore {
  const open = () =>
    openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore(REGISTRY_KEY);
      },
    });
  return {
    async read() {
      const db = await open();
      try {
        const value: unknown = await db.get(REGISTRY_KEY, REGISTRY_KEY);
        return value === undefined ? null : parseProfileRegistry(value);
      } finally {
        db.close();
      }
    },
    async write(registry) {
      const db = await open();
      try {
        await db.put(REGISTRY_KEY, registry, REGISTRY_KEY);
      } finally {
        db.close();
      }
    },
  };
}

/** Mémo de la session : survit à un rechargement, pas à la fermeture de l'onglet. */
function sessionMemo(win: Window): ProfileHost["session"] {
  return {
    get: () => {
      try {
        return win.sessionStorage.getItem(SESSION_KEY);
      } catch {
        return null;
      }
    },
    set: (id) => {
      try {
        if (id === null) win.sessionStorage.removeItem(SESSION_KEY);
        else win.sessionStorage.setItem(SESSION_KEY, id);
      } catch {
        // Stockage de session refusé : le choix du profil sera redemandé au prochain lancement.
      }
    },
  };
}

/** Assemble les profils de la PWA. Appelé une seule fois, par le point d'entrée web. */
export function createWebProfileHost(
  win: Window & typeof globalThis,
  base: Pick<Platform, "target" | "deviceLabel" | "shortcutHint" | "updates">,
): ProfileHost {
  const env: BrowserEnv = {
    document: win.document,
    navigator: win.navigator,
    URL: win.URL,
    setTimeout: (fn, ms) => win.setTimeout(fn, ms),
  };
  const files = createWebFileIO(env);
  const fsAccess = detectWebSyncMode(win as unknown as WindowLike) === "fs-access";
  const localOf = (profileId: string) => {
    if (!isProfileId(profileId)) throw new Error("Identifiant de profil inutilisable.");
    return IndexedDbLocalStore.open(profileDbName(profileId));
  };
  return {
    registry: createIdbRegistryStore(),
    localOf,
    async open(profile) {
      const local = await localOf(profile.id);
      const syncFileName = syncFileNameFor(profile);
      const sync: SyncFile = fsAccess
        ? createFsAccessSync(
            win as unknown as FsPickers,
            {
              get: async () => (await local.getMeta<FsFileHandle>(SYNC_HANDLE_KEY)) ?? null,
              set: (handle) => local.setMeta(SYNC_HANDLE_KEY, handle),
            },
            syncFileName,
          )
        : createAssistedSync(env);
      return { ...base, local, sync, syncFileName, files };
    },
    async prepare() {},
    async remove(profileId) {
      if (!isProfileId(profileId)) throw new Error("Identifiant de profil inutilisable.");
      // Les connexions de cette version se ferment d'elles-mêmes (voir IndexedDbLocalStore.open). Un onglet
      // d'une version plus ancienne peut retenir la base : l'effacement aboutit quand il se ferme.
      await new Promise<void>((resolve, reject) => {
        deleteDB(profileDbName(profileId), {
          blocked: () =>
            reject(new Error("Ses données seront effacées de cet appareil une fois les autres onglets de Cashmyr fermés.")),
        }).then(resolve, reject);
      });
    },
    session: sessionMemo(win),
    ...(base.updates ? { updates: base.updates } : {}),
  };
}
