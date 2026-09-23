import type { Platform } from "@cashmyr/storage";
import { createTauriPlatformParts } from "@cashmyr/storage/tauri";

/** Nom lisible de l'appareil pour le registre du fichier : le système seulement, jamais le nom de la machine. */
function system(ua: string): string {
  return /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "ordinateur";
}

export async function createDesktopPlatform(): Promise<Platform> {
  const parts = await createTauriPlatformParts();
  const mac = /Mac OS X|Macintosh/.test(navigator.userAgent);
  return {
    target: "desktop",
    deviceLabel: `Application de bureau · ${system(navigator.userAgent)}`,
    shortcutHint: mac ? "⌘N" : "Ctrl+N",
    ...parts,
  };
}
