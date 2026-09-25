import type { ProfileHost } from "@cashmyr/storage";
import { createTauriProfileHost } from "@cashmyr/storage/tauri";

/** Nom lisible de l'appareil pour le registre du fichier : le système seulement, jamais le nom de la machine. */
function system(ua: string): string {
  return /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "ordinateur";
}

export function createDesktopHost(): Promise<ProfileHost> {
  const mac = /Mac OS X|Macintosh/.test(navigator.userAgent);
  return createTauriProfileHost({
    target: "desktop",
    deviceLabel: `Application de bureau · ${system(navigator.userAgent)}`,
    shortcutHint: mac ? "⌘N" : "Ctrl+N",
  });
}
