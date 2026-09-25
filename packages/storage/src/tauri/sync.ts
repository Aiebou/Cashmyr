import { SYNC_FILE_NAME } from "../profiles";
import type { AutoSyncFile, FileIO, SyncTargetStatus } from "../types";

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * Commandes Rust de `apps/desktop/src-tauri/src/sync_file.rs`. Elles n'agissent que sur
 * le chemin choisi par l'utilisateur dans le dialogue natif, mémorisé côté Rust :
 * le front ne peut pas leur passer un autre chemin.
 *
 * - `sync_choose { kind: "open" | "create", suggestedName }` → `{ name } | null` : ouvre le dialogue, mémorise
 *   le chemin ; en création, propose `suggestedName` (Rust n'admet que `finances-sync[-nom].json`) et crée un
 *   fichier vide s'il n'existe pas (comme le fait `showSaveFilePicker`).
 * - `sync_status` → `"unconfigured" | "ready" | "missing"`.
 * - `sync_target_name` → `string | null`.
 * - `sync_read` → `string | null` (null si le fichier a disparu).
 * - `sync_write_atomic { content }` : écrit `<fichier>.tmp-<aléa>` dans le même dossier,
 *   `fsync`, puis renomme par-dessus l'original.
 * - `sync_forget` : oublie le chemin.
 *
 * Toutes agissent sur le profil choisi par `profile_select` (voir `./index.ts`).
 */
export const SYNC_COMMANDS = {
  choose: "sync_choose",
  status: "sync_status",
  targetName: "sync_target_name",
  read: "sync_read",
  writeAtomic: "sync_write_atomic",
  forget: "sync_forget",
} as const;

/** Bureau : accès complet au fichier choisi une fois pour toutes. */
export function createTauriSync(invoke: Invoke, suggestedName = SYNC_FILE_NAME): AutoSyncFile {
  return {
    mode: "auto",
    via: "tauri",
    choose: (kind) => invoke<{ name: string } | null>(SYNC_COMMANDS.choose, { kind, suggestedName }),
    status: () => invoke<SyncTargetStatus>(SYNC_COMMANDS.status),
    requestPermission: async () => true,
    targetName: () => invoke<string | null>(SYNC_COMMANDS.targetName),
    read: () => invoke<string | null>(SYNC_COMMANDS.read),
    writeAtomic: (content) => invoke<void>(SYNC_COMMANDS.writeAtomic, { content }),
    forget: () => invoke<void>(SYNC_COMMANDS.forget),
  };
}

export type DialogLike = {
  save(options: { defaultPath: string; filters: { name: string; extensions: string[] }[] }): Promise<string | null>;
  open(options: {
    multiple: false;
    directory: false;
    filters: { name: string; extensions: string[] }[];
  }): Promise<string | null>;
};

export type AbsoluteFsLike = {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
};

const extensionOf = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Exports et imports sur le bureau : dialogues natifs, fichiers écrits là où l'utilisateur l'a choisi. */
export function createTauriFileIO(dialog: DialogLike, fs: AbsoluteFsLike): FileIO {
  return {
    async saveAs(name, _mime, content) {
      const ext = extensionOf(name);
      const path = await dialog.save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
      if (!path) return false;
      await fs.writeTextFile(path, content);
      return true;
    },
    async openText(accept) {
      const extensions = accept.filter((a) => a.startsWith(".")).map((a) => a.slice(1));
      const path = await dialog.open({
        multiple: false,
        directory: false,
        filters: [{ name: extensions.join(", ").toUpperCase(), extensions }],
      });
      if (!path) return null;
      return { name: baseName(path), content: await fs.readTextFile(path) };
    },
  };
}
