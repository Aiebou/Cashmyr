import { latch } from "../latch";
import type { AppUpdates, AvailableUpdate } from "../types";

/** `check` de `@tauri-apps/plugin-updater` et `relaunch` de `@tauri-apps/plugin-process`. */
export type UpdaterLike = {
  check(): Promise<{ version: string; downloadAndInstall(): Promise<void> } | null>;
  relaunch(): Promise<void>;
};

/**
 * Updater du bureau. Il ne vérifie que sur demande (décision 17) : c'est le seul appel réseau
 * de l'application, fait côté Rust vers le `latest.json` de la dernière Release. Le paquet
 * téléchargé n'est installé que si sa signature correspond à la clé publique de `tauri.conf.json`.
 */
export function createTauriUpdates(updater: UpdaterLike, version: string): AppUpdates {
  const available = latch<AvailableUpdate>();
  return {
    version,
    onAvailable: available.on,
    check: async () => {
      const update = await updater.check();
      if (!update) return "none";
      available.fire({
        version: update.version,
        kind: "restart",
        apply: async () => {
          await update.downloadAndInstall();
          await updater.relaunch();
        },
      });
      return "available";
    },
  };
}
