import { SCHEMA_VERSION } from "../model";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Mises à niveau du format, d'une version à la suivante (décision 50). Elles ne font que la
 * structure : la validation passe après, comme pour des données du format courant.
 */
const STEPS: Record<number, (value: Obj) => Obj> = {
  // 1 → 2 (0.2.0) : collection des tags, vide. Le tag des opérations et des récurrences et
  // l'ordre des comptes sont des champs facultatifs : les lignes existantes restent telles quelles.
  1: (v) => ({
    ...v,
    schemaVersion: 2,
    collections: isObj(v.collections) ? { tags: [], ...v.collections } : v.collections,
  }),
};

/**
 * Porte au format courant un jeu de données, une sauvegarde ou un document de synchronisation
 * d'un format plus ancien. Toute autre valeur (format courant, plus récent ou inconnu) est rendue
 * telle quelle : c'est la validation qui la refusera.
 */
export function upgradeSchema<T>(value: T): T {
  if (!isObj(value)) return value;
  let current: Obj = value;
  while (typeof current.schemaVersion === "number" && current.schemaVersion < SCHEMA_VERSION) {
    const step = STEPS[current.schemaVersion];
    if (!step) break;
    current = step(current);
  }
  return current as T;
}

/** Vrai pour une valeur d'un format plus ancien que le format courant : à réécrire une fois mise à niveau. */
export const isOlderSchema = (value: unknown): boolean =>
  isObj(value) && typeof value.schemaVersion === "number" && value.schemaVersion < SCHEMA_VERSION;
