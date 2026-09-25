import { SYNC_FILE_NAME } from "../profiles";
import type { AutoSyncFile, SyncTargetStatus } from "../types";

type Permission = "granted" | "denied" | "prompt";
type Mode = { mode: "readwrite" };

/** Sous-ensemble de FileSystemFileHandle utilisé ici (les méthodes de permission ne sont pas typées par le DOM). */
export interface FsFileHandle {
  readonly name: string;
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
    abort?(reason?: unknown): Promise<void>;
  }>;
  queryPermission?(descriptor: Mode): Promise<Permission>;
  requestPermission?(descriptor: Mode): Promise<Permission>;
}

type PickerTypes = { description: string; accept: Record<string, string[]> }[];

export interface FsPickers {
  showOpenFilePicker(options: { types: PickerTypes; multiple: false; excludeAcceptAllOption?: boolean }): Promise<FsFileHandle[]>;
  showSaveFilePicker(options: { types: PickerTypes; suggestedName: string }): Promise<FsFileHandle>;
}

/** Où garder le handle entre deux sessions : IndexedDB, qui sait le cloner. */
export interface HandleStore {
  get(): Promise<FsFileHandle | null>;
  set(handle: FsFileHandle | null): Promise<void>;
}

const TYPES: PickerTypes = [
  { description: "Fichier de synchronisation Cashmyr", accept: { "application/json": [".json"] } },
];

const errorName = (e: unknown) => (typeof e === "object" && e !== null ? (e as { name?: string }).name : undefined);

/**
 * Chromium de bureau : accès direct au fichier via la File System Access API.
 * Le handle est conservé dans IndexedDB ; la permission est redemandée si elle a expiré.
 * `createWritable()` écrit dans un fichier d'échange que le navigateur ne substitue
 * à l'original qu'à `close()` : c'est le seul mécanisme atomique qu'offre l'API web.
 */
export function createFsAccessSync(pickers: FsPickers, store: HandleStore, suggestedName = SYNC_FILE_NAME): AutoSyncFile {
  let cached: FsFileHandle | null | undefined;
  const handle = async () => {
    if (cached === undefined) cached = await store.get();
    return cached;
  };

  return {
    mode: "auto",
    via: "fs-access",

    async choose(kind) {
      let picked: FsFileHandle | undefined;
      try {
        picked =
          kind === "open"
            ? (await pickers.showOpenFilePicker({ types: TYPES, multiple: false }))[0]
            : await pickers.showSaveFilePicker({ types: TYPES, suggestedName });
      } catch (e) {
        if (errorName(e) === "AbortError") return null;
        throw e;
      }
      if (!picked) return null;
      cached = picked;
      await store.set(picked);
      return { name: picked.name };
    },

    async status(): Promise<SyncTargetStatus> {
      const h = await handle();
      if (!h) return "unconfigured";
      const permission = (await h.queryPermission?.({ mode: "readwrite" })) ?? "granted";
      if (permission !== "granted") return "needs-permission";
      try {
        await h.getFile();
        return "ready";
      } catch (e) {
        if (errorName(e) === "NotFoundError") return "missing";
        if (errorName(e) === "NotAllowedError") return "needs-permission";
        throw e;
      }
    },

    async requestPermission() {
      const h = await handle();
      if (!h) return false;
      return ((await h.requestPermission?.({ mode: "readwrite" })) ?? "granted") === "granted";
    },

    async targetName() {
      return (await handle())?.name ?? null;
    },

    async read() {
      const h = await handle();
      if (!h) return null;
      try {
        return await (await h.getFile()).text();
      } catch (e) {
        if (errorName(e) === "NotFoundError") return null;
        throw e;
      }
    },

    async writeAtomic(content) {
      const h = await handle();
      if (!h) throw new Error("Aucun fichier de synchronisation choisi.");
      const writable = await h.createWritable();
      try {
        await writable.write(content);
        await writable.close();
      } catch (e) {
        await writable.abort?.(e).catch(() => undefined);
        throw e;
      }
    },

    async forget() {
      cached = null;
      await store.set(null);
    },
  };
}
