import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import * as dialog from "@tauri-apps/plugin-dialog";
import * as fs from "@tauri-apps/plugin-fs";
import { relaunch } from "@tauri-apps/plugin-process";
import { load } from "@tauri-apps/plugin-store";
import { check } from "@tauri-apps/plugin-updater";
import { isProfileId, parseProfileRegistry, PRINCIPAL, ProfileError, syncFileNameFor, type ProfileRegistryStore } from "../profiles";
import type { LocalStore, Platform, ProfileHost } from "../types";
import { TauriFileLocalStore, type FsLike } from "./file-store";
import { createTauriFileIO, createTauriSync, type DialogLike } from "./sync";
import { createTauriUpdates } from "./updates";

export {
  LocalFileCorruptedError,
  TauriFileLocalStore,
  type FsLike,
  type KeyValueLike,
} from "./file-store";
export { createTauriFileIO, createTauriSync, SYNC_COMMANDS, type Invoke } from "./sync";
export { createTauriUpdates, type UpdaterLike } from "./updates";

const REGISTRY = "profils.json";
const REGISTRY_TMP = "profils.json.tmp";
const SESSION_KEY = "cashmyr.profil";

/**
 * Commandes Rust des profils (`apps/desktop/src-tauri/src/profiles.rs`) :
 * - `profile_select { id }` : les commandes de synchronisation agissent désormais sur ce profil ;
 * - `profile_remove { id }` : retire le stockage du profil, `sync-target.txt` compris.
 * Rust n'admet que `principal` ou un uuid v4.
 */
export const PROFILE_COMMANDS = { select: "profile_select", remove: "profile_remove" } as const;

/** Dossier d'un profil, relatif au répertoire de données : la racine pour le premier (décision 55). */
export const profileDir = (profileId: string): string => (profileId === PRINCIPAL ? "" : `profils/${profileId}`);

/** `plugin-fs` ramené à des chemins relatifs à un dossier du répertoire de données de l'application. */
async function appDataFs(dir = ""): Promise<FsLike> {
  const root = dir ? await join(await appDataDir(), dir) : await appDataDir();
  await fs.mkdir(root, { recursive: true });
  const at = (path: string) => join(root, path);
  return {
    exists: async (p) => fs.exists(await at(p)),
    readTextFile: async (p) => fs.readTextFile(await at(p)),
    writeTextFile: async (p, data) => fs.writeTextFile(await at(p), data),
    rename: async (from, to) => fs.rename(await at(from), await at(to)),
    mkdir: async (p) => fs.mkdir(await at(p), { recursive: true }),
    readDir: async (p) => (await fs.readDir(await at(p))).map((e) => ({ name: e.name, isFile: e.isFile })),
    remove: async (p) => fs.remove(await at(p)),
  };
}

/** Registre des profils du bureau : `profils.json`, écrit dans un temporaire puis renommé. */
export function createFileRegistryStore(files: FsLike): ProfileRegistryStore {
  return {
    async read() {
      if (!(await files.exists(REGISTRY))) return null;
      let value: unknown;
      try {
        value = JSON.parse(await files.readTextFile(REGISTRY));
      } catch {
        throw new ProfileError("Le registre des profils de cet appareil est illisible.");
      }
      return parseProfileRegistry(value);
    },
    async write(registry) {
      await files.writeTextFile(REGISTRY_TMP, JSON.stringify(registry));
      await files.rename(REGISTRY_TMP, REGISTRY);
    },
  };
}

function sessionMemo(): ProfileHost["session"] {
  return {
    get: () => {
      try {
        return window.sessionStorage.getItem(SESSION_KEY);
      } catch {
        return null;
      }
    },
    set: (id) => {
      try {
        if (id === null) window.sessionStorage.removeItem(SESSION_KEY);
        else window.sessionStorage.setItem(SESSION_KEY, id);
      } catch {
        // Le choix du profil sera redemandé au prochain lancement.
      }
    },
  };
}

/** Assemble les profils du bureau. Appelé une seule fois, par le point d'entrée Tauri. */
export async function createTauriProfileHost(
  base: Pick<Platform, "target" | "deviceLabel" | "shortcutHint">,
): Promise<ProfileHost> {
  const rootFs = await appDataFs();
  const dialogs: DialogLike = {
    save: (options) => dialog.save(options),
    open: async (options) => (await dialog.open(options)) as string | null,
  };
  const files = createTauriFileIO(dialogs, { readTextFile: (p) => fs.readTextFile(p), writeTextFile: (p, d) => fs.writeTextFile(p, d) });
  const updates = createTauriUpdates({ check: () => check(), relaunch: () => relaunch() }, await getVersion());

  const localOf = async (profileId: string): Promise<LocalStore> => {
    if (!isProfileId(profileId)) throw new Error("Identifiant de profil inutilisable.");
    const dir = profileDir(profileId);
    const store = await load(dir ? `${dir}/device.json` : "device.json", { autoSave: false, defaults: {} });
    return new TauriFileLocalStore(await appDataFs(dir), {
      get: <T>(key: string) => store.get<T>(key),
      set: (key, value) => store.set(key, value),
      save: () => store.save(),
    });
  };

  return {
    registry: createFileRegistryStore(rootFs),
    localOf,
    async open(profile) {
      const local = await localOf(profile.id);
      await invoke(PROFILE_COMMANDS.select, { id: profile.id });
      const syncFileName = syncFileNameFor(profile);
      return { ...base, local, sync: createTauriSync(invoke, syncFileName), syncFileName, files, updates };
    },
    async prepare(profileId) {
      if (!isProfileId(profileId)) throw new Error("Identifiant de profil inutilisable.");
      const dir = profileDir(profileId);
      if (dir) await rootFs.mkdir(dir);
    },
    remove: (profileId) => invoke<void>(PROFILE_COMMANDS.remove, { id: profileId }),
    session: sessionMemo(),
    updates,
  };
}
