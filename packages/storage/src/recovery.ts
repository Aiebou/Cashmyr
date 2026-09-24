import { assertValidDataset, COLLECTION_NAMES, PREF_KEYS, type Dataset } from "@cashmyr/core";
import { prefKey, recordKey } from "./repository";
import type { LocalStore, SetAsideInfo, SnapshotInfo } from "./types";

/** Copie de sauvegarde vue de l'écran de secours : `usable` si elle passe la validation du démarrage. */
export type RecoveryCopy = SnapshotInfo & { usable: boolean };

/** Copies de l'appareil, de la plus récente à la plus ancienne, chacune vérifiée comme au démarrage. */
export async function recoveryCopies(local: LocalStore): Promise<RecoveryCopy[]> {
  const copies: RecoveryCopy[] = [];
  for (const info of await local.listSnapshots()) {
    let usable = false;
    try {
      assertValidDataset(await local.readSnapshot(info.id));
      usable = true;
    } catch {
      // Copie abîmée elle aussi : listée, mais pas restaurable.
    }
    copies.push({ ...info, usable });
  }
  return copies;
}

/**
 * Écran de secours : repart d'une copie de sauvegarde (`copyId`) ou de zéro (`null`).
 *
 * - Décision 40 : la version refusée est d'abord copiée de côté, sans être retirée.
 * - Décision 38 : la copie reprend sa place telle quelle, avec ses dates d'origine. La
 *   synchronisation suivante ramène ce qui est plus récent dans le fichier ; seul ce qui
 *   n'avait été saisi que sur cet appareil après la copie est perdu.
 * - Décision 39 : sans copie, l'appareil repart vide (écran d'accueil) et la synchronisation
 *   ramène ce qui avait été synchronisé.
 *
 * La copie remplace les données en une seule écriture atomique : si quoi que ce soit échoue
 * avant, l'appareil reste tel quel et l'écran de secours revient au prochain lancement.
 * L'état de l'appareil (fichier de synchronisation choisi) est gardé ; les modifications en
 * attente sont ramenées à ce que contient la copie.
 */
export async function recoverLocalData(local: LocalStore, copyId: string | null, now: number): Promise<SetAsideInfo | null> {
  const copy = copyId === null ? null : await local.readSnapshot(copyId);
  if (copy) assertValidDataset(copy);
  const setAside = await local.setAside(now);
  if (copy) await local.replace(copy);
  else await local.clear();
  await local.flush();
  const device = await local.getDevice();
  if (device) await local.setDevice({ ...device, dirty: pendingIn(device.dirty, copy) });
  return setAside;
}

/**
 * Modifications en attente qui existent encore après la restauration. Une ligne absente de la
 * copie n'a plus rien à envoyer ; une ligne plus ancienne dans la copie reste à envoyer dans
 * cette version, que le moteur retire dès que le fichier la contient.
 */
function pendingIn(dirty: Record<string, number>, copy: Dataset | null): Record<string, number> {
  if (!copy) return {};
  const versions = new Map<string, number>();
  for (const name of COLLECTION_NAMES) for (const r of copy.collections[name]) versions.set(recordKey(name, r.id), r.updatedAt);
  for (const key of PREF_KEYS) versions.set(prefKey(key), copy.preferences.updatedAt[key]);
  const pending: Record<string, number> = {};
  for (const [key, stamp] of Object.entries(dirty)) {
    const version = versions.get(key);
    if (version !== undefined) pending[key] = Math.min(stamp, version);
  }
  return pending;
}
