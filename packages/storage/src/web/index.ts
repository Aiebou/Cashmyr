import type { FileIO, LocalStore, SyncFile } from "../types";
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

/** Assemble les adaptateurs de la PWA. Appelé une seule fois, par le point d'entrée web. */
export async function createWebPlatformParts(
  win: Window & typeof globalThis = window,
): Promise<{ local: LocalStore; sync: SyncFile; files: FileIO }> {
  const local = await IndexedDbLocalStore.open();
  const env: BrowserEnv = {
    document: win.document,
    navigator: win.navigator,
    URL: win.URL,
    setTimeout: (fn, ms) => win.setTimeout(fn, ms),
  };
  const sync =
    detectWebSyncMode(win as unknown as WindowLike) === "fs-access"
      ? createFsAccessSync(win as unknown as FsPickers, {
          get: async () => (await local.getMeta<FsFileHandle>(SYNC_HANDLE_KEY)) ?? null,
          set: (handle) => local.setMeta(SYNC_HANDLE_KEY, handle),
        })
      : createAssistedSync(env);
  return { local, sync, files: createWebFileIO(env) };
}
