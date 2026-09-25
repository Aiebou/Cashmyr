import { defaultPreferences, indexOf, setPreference } from "./dataset";
import { defaultCategories } from "./defaults";
import { COLLECTION_NAMES, PREF_KEYS, type Category, type Changes, type Dataset, type Preferences } from "./model";
import { revive, tombstone } from "./records";

/**
 * Remise à zéro partout (décision 45) : chaque ligne vivante devient une suppression, et chaque
 * réglage reprend sa valeur par défaut, horodaté maintenant. La synchronisation porte l'effacement
 * à tous les appareils ; selon la décision 1, une ligne modifiée ailleurs après l'effacement revient.
 */
export function eraseEverything(data: Dataset, now: number): { changes: Changes; preferences: Preferences } {
  const changes: Changes = {};
  for (const name of COLLECTION_NAMES) {
    const erased = data.collections[name].filter((r) => r.deletedAt === null).map((r) => tombstone(r, now));
    if (erased.length > 0) (changes as Record<string, unknown>)[name] = erased;
  }
  const defaults = defaultPreferences();
  let preferences = data.preferences;
  for (const key of PREF_KEYS) preferences = setPreference(preferences, key, defaults[key], now);
  return { changes, preferences };
}

/**
 * Catégories par défaut pour l'écran d'accueil. Horodatées 0, pour que la moindre version écrite
 * ailleurs l'emporte ; sauf celles dont l'appareil connaît la suppression (après une remise à zéro
 * partout) : elles reviennent avec un horodatage plus récent, sans quoi la suppression gagnerait.
 */
export function startingCategories(data: Dataset, now: number): Category[] {
  const known = indexOf(data).categories;
  return defaultCategories().map((c) => {
    const previous = known.get(c.id);
    if (!previous || previous.deletedAt === null) return c;
    const { id: _id, updatedAt: _u, deletedAt: _d, ...fields } = c;
    return revive(previous, fields, now);
  });
}

/** Vrai s'il ne reste aucune ligne vivante : l'écran d'accueil revient. */
export const hasLiveRecords = (data: Dataset): boolean =>
  COLLECTION_NAMES.some((name) => data.collections[name].some((r) => r.deletedAt === null));
