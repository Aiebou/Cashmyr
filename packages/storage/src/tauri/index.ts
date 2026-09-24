import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import * as dialog from "@tauri-apps/plugin-dialog";
import * as fs from "@tauri-apps/plugin-fs";
import { relaunch } from "@tauri-apps/plugin-process";
import { load } from "@tauri-apps/plugin-store";
import { check } from "@tauri-apps/plugin-updater";
import type { AppUpdates, FileIO, LocalStore, SyncFile } from "../types";
import { TauriFileLocalStore, type FsLike } from "./file-store";
import { createTauriFileIO, createTauriSync, type DialogLike } from "./sync";
import { createTauriUpdates } from "./updates";

export {
  LocalFileCorruptedError,
  localRecoverySteps,
  TauriFileLocalStore,
  type FsLike,
  type KeyValueLike,
} from "./file-store";
export { createTauriFileIO, createTauriSync, SYNC_COMMANDS, type Invoke } from "./sync";
export { createTauriUpdates, type UpdaterLike } from "./updates";

/** `plugin-fs` ramené à des chemins relatifs au répertoire de données de l'application. */
async function appDataFs(): Promise<FsLike> {
  const root = await appDataDir();
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

/** Assemble les adaptateurs du bureau. Appelé une seule fois, par le point d'entrée Tauri. */
export async function createTauriPlatformParts(): Promise<{
  local: LocalStore;
  sync: SyncFile;
  files: FileIO;
  updates: AppUpdates;
}> {
  const store = await load("device.json", { autoSave: false, defaults: {} });
  const local = new TauriFileLocalStore(await appDataFs(), {
    get: <T>(key: string) => store.get<T>(key),
    set: (key, value) => store.set(key, value),
    save: () => store.save(),
  });
  const dialogs: DialogLike = {
    save: (options) => dialog.save(options),
    open: async (options) => (await dialog.open(options)) as string | null,
  };
  return {
    local,
    sync: createTauriSync(invoke),
    files: createTauriFileIO(dialogs, { readTextFile: (p) => fs.readTextFile(p), writeTextFile: (p, d) => fs.writeTextFile(p, d) }),
    updates: createTauriUpdates({ check: () => check(), relaunch: () => relaunch() }, await getVersion()),
  };
}
