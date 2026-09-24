import { latch } from "../latch";
import type { AppUpdates, AvailableUpdate } from "../types";

/** `registerSW` de `virtual:pwa-register` (vite-plugin-pwa), passé par le point d'entrée web. */
export type RegisterSW = (options: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}) => (reloadPage?: boolean) => Promise<void>;

/**
 * Service worker de la PWA, en mode « prompt ». Une nouvelle version se télécharge en
 * arrière-plan puis attend : l'application propose de recharger, sans jamais forcer.
 * Le navigateur vérifie de lui-même, à l'ouverture, si le service worker a changé.
 */
export function createPwaUpdates(register: RegisterSW, version: string): AppUpdates {
  const available = latch<AvailableUpdate>();
  const offline = latch<void>();
  const updateServiceWorker = register({
    // Le point d'entrée attend le stockage local avant d'arriver ici : `load` peut être déjà passé.
    immediate: true,
    onNeedRefresh: () => available.fire({ version: null, kind: "reload", apply: () => updateServiceWorker(true) }),
    onOfflineReady: () => offline.fire(),
  });
  return { version, onAvailable: available.on, onOfflineReady: offline.on };
}
