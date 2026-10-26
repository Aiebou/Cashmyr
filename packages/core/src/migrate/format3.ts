import {
  BUCKETS,
  DEFAULTS_AT,
  FORMER_DEFAULT_IDS,
  PRECAUTION_TYPE_ID,
  RENAMED_AT,
  defaultBudgetId,
  defaultBudgets,
  defaultCategories,
  defaultTypes,
  legacyCategoryId,
} from "../defaults";
import type { Bucket, TypeObjective } from "../model";
import { nameKey } from "../names";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNat = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Les collections du format 2 : celles dont une ligne vivante rend un profil « non vide ». */
const FORMAT_2_COLLECTIONS = ["categories", "accounts", "operations", "goals", "goalSteps", "debts", "recurrences", "skips", "tags"];

const isBucket = (v: unknown): v is Bucket => BUCKETS.includes(v as Bucket);
/** Un usage connu devient l'identifiant de son budget ; tout autre valeur passe telle quelle, et la validation la refusera. */
const budgetOf = (bucket: unknown): unknown => (isBucket(bucket) ? defaultBudgetId(bucket) : bucket);

function renameKeys(value: unknown): unknown {
  if (!isObj(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [isBucket(k) ? defaultBudgetId(k) : k, v]));
}

/**
 * Format 2 → 3 (version 0.6.0, décisions 71 à 81). Une fonction pure des données : deux appareils
 * qui mettent à niveau les mêmes lignes obtiennent les mêmes lignes, horodatages compris.
 *
 * - Usages → budgets : chaque catégorie de dépense prend le budget de son usage ; la répartition et
 *   les couleurs passent des usages aux budgets, avec leur horodatage.
 * - Un profil non vide reçoit les trois budgets et les six types par défaut, horodatés `DEFAULTS_AT`.
 * - Catégories par défaut jamais modifiées (horodatées `RENAMED_AT` ou moins) : elles prennent leur
 *   forme du format 3 (nom, budget, type), ou deviennent des suppressions si elles ne sont plus dans la
 *   liste ; leurs opérations les gardent et comptent toujours dans leur budget (décision 73).
 * - Un profil qui a des catégories par défaut reçoit les nouvelles, sauf un nom qu'il porte déjà.
 * - La précaution : son réglage devient l'objectif du type « Épargne de précaution », avec l'horodatage
 *   du réglage s'il est plus récent ; les comptes cochés y sont rattachés, en type principal (décision 79).
 */
export function upgradeTo3(v: Obj): Obj {
  const collections = v.collections;
  const prefs = v.preferences;
  if (!isObj(collections) || !isObj(prefs)) return { ...v, schemaVersion: 3 };

  const list = (name: string): unknown[] => (Array.isArray(collections[name]) ? (collections[name] as unknown[]) : []);
  const nonEmpty = FORMAT_2_COLLECTIONS.some((name) => list(name).some((r) => isObj(r) && r.deletedAt === null));

  const fresh = new Map(defaultCategories().map((c) => [c.id, c]));
  const former = new Set(FORMER_DEFAULT_IDS.map(legacyCategoryId));
  const untouched = (c: Obj) => former.has(c.id as string) && isNat(c.updatedAt) && c.updatedAt <= RENAMED_AT && c.deletedAt === null;

  const categories = list("categories").map((c) => {
    if (!isObj(c)) return c;
    const { bucket, ...rest } = c;
    const converted: Obj = bucket === undefined ? rest : { ...rest, budgetId: budgetOf(bucket) };
    if (!untouched(c)) return converted;
    const next = fresh.get(c.id as string);
    return next ?? { ...converted, updatedAt: DEFAULTS_AT, deletedAt: DEFAULTS_AT };
  });

  const hadDefaults = list("categories").some((c) => isObj(c) && former.has(c.id as string));
  if (nonEmpty && hadDefaults) {
    const ids = new Set(categories.filter(isObj).map((c) => c.id));
    const names = new Set(
      categories.filter((c): c is Obj => isObj(c) && c.deletedAt === null && typeof c.name === "string").map((c) => `${String(c.kind)}:${nameKey(c.name as string)}`),
    );
    for (const c of fresh.values()) {
      if (ids.has(c.id) || names.has(`${c.kind}:${nameKey(c.name)}`)) continue;
      categories.push(c);
    }
  }

  const accounts = list("accounts").map((a) => {
    if (!isObj(a)) return a;
    const { safety, ...rest } = a;
    return safety === true ? { ...rest, typeIds: [PRECAUTION_TYPE_ID] } : safety === false ? rest : a;
  });

  const prefUpdatedAt = isObj(prefs.updatedAt) ? prefs.updatedAt : {};
  const { safety, bucketColors, splits, ...otherPrefs } = prefs;
  const { safety: safetyAt, bucketColors: colorsAt, ...otherAt } = prefUpdatedAt;

  let budgets: unknown[] = [];
  let types: unknown[] = [];
  if (nonEmpty) {
    budgets = defaultBudgets();
    const precaution = isObj(safety) ? (safety as TypeObjective) : undefined;
    types = defaultTypes(precaution).map((t) =>
      t.id === PRECAUTION_TYPE_ID && isNat(safetyAt) && safetyAt > DEFAULTS_AT ? { ...t, updatedAt: safetyAt } : t,
    );
  }

  return {
    ...v,
    schemaVersion: 3,
    collections: { ...collections, categories, accounts, budgets, types },
    preferences: {
      ...otherPrefs,
      splits: renameKeys(splits),
      budgetColors: bucketColors === undefined ? {} : renameKeys(bucketColors),
      updatedAt: { ...otherAt, budgetColors: colorsAt ?? 0 },
    },
  };
}
