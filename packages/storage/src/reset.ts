import type { LocalStore } from "./types";

/**
 * Remise à zéro de cet appareil (décision 45) : une copie de sauvegarde, puis les données locales
 * retirées. L'état de l'appareil repart de zéro (fichier de synchronisation, modifications en
 * attente, choix d'affichage) ; il garde son identifiant et son nom. Le fichier de synchronisation
 * doit avoir été oublié juste avant (`SyncEngine.disconnect`) ; au relancement, l'accueil revient.
 */
export async function resetDevice(local: LocalStore, now: number): Promise<void> {
  await local.snapshot(now);
  await local.clear();
  await local.flush();
  const device = await local.getDevice();
  if (!device) return;
  await local.setDevice({
    deviceId: device.deviceId,
    deviceLabel: device.deviceLabel,
    sync: { fileId: null, targetName: null, lastMergeAt: null, lastOfferAt: null, lastError: null },
    dirty: {},
  });
}
