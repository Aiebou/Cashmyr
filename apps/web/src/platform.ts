import type { Platform } from "@cashmyr/storage";
import { createPwaUpdates, createWebPlatformParts } from "@cashmyr/storage/web";
import { registerSW } from "virtual:pwa-register";

const mobile = () =>
  (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile ??
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/** Nom lisible de l'appareil pour le registre du fichier : navigateur et système, jamais de nom de machine. */
function deviceLabel(ua: string): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
  const system = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "appareil";
  return `${browser} · ${system}`;
}

export async function createWebPlatform(): Promise<Platform> {
  const parts = await createWebPlatformParts(window);
  return {
    target: "web",
    deviceLabel: deviceLabel(navigator.userAgent),
    shortcutHint: mobile() ? null : "N",
    ...parts,
    updates: createPwaUpdates(registerSW, __APP_VERSION__),
  };
}
