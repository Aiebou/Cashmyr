import { derivedId, legacyId } from "./ids";
import type { Bucket, Budget, BudgetNature, BudgetType, Category, SeriesColor, TypeObjective } from "./model";

/**
 * Horodatage des budgets, des types et des catégories par défaut du format 3 (décisions 71 à 73).
 * Une catégorie par défaut jamais modifiée (horodatée 0 ou 2, ou reprise de l'ancien fichier à 1)
 * prend sa nouvelle forme ; une modification de l'utilisateur, horodatée à l'heure, gagne toujours.
 * Deux appareils qui passent au format 3 chacun de leur côté produisent les mêmes lignes.
 */
export const DEFAULTS_AT = 3;

/** Décision 68 : horodatage des quatre noms remplacés en 0.4.1. Au-dessous ou égal : jamais modifiée. */
export const RENAMED_AT = 2;

/** Identifiant d'un budget par défaut, déduit de l'usage du format 2 qu'il remplace. */
export const defaultBudgetId = (bucket: Bucket): string => derivedId("budget", bucket);
/** Identifiant d'un type par défaut. */
export const defaultTypeId = (key: DefaultTypeKey): string => derivedId("type", key);
/** Identifiant d'une catégorie de l'ancienne application. */
export const legacyCategoryId = (id: string): string => legacyId("category", id);
/** Identifiant d'une catégorie par défaut apparue avec le format 3. */
const newCategoryId = (key: string): string => derivedId("category", key);

export const BUCKETS: readonly Bucket[] = ["besoin", "envie", "invest"];

export const DEFAULT_BUDGETS: readonly { bucket: Bucket; name: string; nature: BudgetNature }[] = [
  { bucket: "besoin", name: "Dépenses courantes", nature: "spend" },
  { bucket: "envie", name: "Loisirs", nature: "spend" },
  { bucket: "invest", name: "Épargne", nature: "save" },
];

export type DefaultTypeKey = "charges-fixes" | "quotidien" | "charge-ponctuelle" | "precaution" | "placement" | "projet";

export const DEFAULT_TYPES: readonly { key: DefaultTypeKey; bucket: Bucket; name: string }[] = [
  { key: "charges-fixes", bucket: "besoin", name: "Charges fixes" },
  { key: "quotidien", bucket: "besoin", name: "Quotidien" },
  { key: "charge-ponctuelle", bucket: "besoin", name: "Charge ponctuelle" },
  { key: "precaution", bucket: "invest", name: "Épargne de précaution" },
  { key: "placement", bucket: "invest", name: "Placement" },
  { key: "projet", bucket: "invest", name: "Projet" },
];

/** Le type qui porte l'épargne de précaution (décision 79). */
export const PRECAUTION_TYPE_ID = defaultTypeId("precaution");

/** Objectif de précaution par défaut : celui de l'ancien réglage. */
export const defaultPrecautionObjective = (): TypeObjective => ({ mode: "months", months: 4, amount: 0, hidden: false, pinned: true });

type DefaultCategory = {
  /** Identifiant de l'ancienne application (`r1`…), ou clé d'une catégorie apparue avec le format 3. */
  legacy?: string;
  key?: string;
  name: string;
  kind: "in" | "out";
  bucket?: Bucket;
  type?: DefaultTypeKey;
  /** Couleur de série d'une source de revenu : celle qu'elle avait, pour une catégorie gardée. */
  color: SeriesColor;
};

/** Les catégories par défaut du format 3 (liste du 25/10/2026, décision 73), dans l'ordre d'affichage. */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  { key: "aides", name: "Aides", kind: "in", color: 5 },
  { legacy: "r7", name: "Autre revenu", kind: "in", color: 6 },
  { key: "remboursement-creance", name: "Remboursement et créance", kind: "in", color: 1 },
  { legacy: "r1", name: "Salaire", kind: "in", color: 0 },
  { key: "alimentaire", name: "Alimentaire", kind: "out", bucket: "besoin", type: "charges-fixes", color: 0 },
  { legacy: "d11", name: "Assurance", kind: "out", bucket: "besoin", type: "charges-fixes", color: 0 },
  { legacy: "d9", name: "Énergie et eau", kind: "out", bucket: "besoin", type: "charges-fixes", color: 0 },
  { legacy: "d15", name: "Impôt", kind: "out", bucket: "besoin", type: "charges-fixes", color: 0 },
  { legacy: "d8", name: "Loyer et charges", kind: "out", bucket: "besoin", type: "charges-fixes", color: 0 },
  { legacy: "d13", name: "Transport", kind: "out", bucket: "besoin", type: "charges-fixes", color: 0 },
  { legacy: "d12", name: "Courses", kind: "out", bucket: "besoin", type: "quotidien", color: 0 },
  { key: "remboursement-dettes", name: "Remboursement de dettes", kind: "out", bucket: "besoin", type: "charge-ponctuelle", color: 0 },
  { legacy: "d14", name: "Santé", kind: "out", bucket: "besoin", type: "charge-ponctuelle", color: 0 },
  { legacy: "d25", name: "Épargne de précaution", kind: "out", bucket: "invest", type: "precaution", color: 0 },
  { key: "placement", name: "Placement", kind: "out", bucket: "invest", type: "placement", color: 0 },
  { legacy: "d27", name: "Assurance-vie", kind: "out", bucket: "invest", type: "placement", color: 0 },
  { legacy: "d20", name: "Abonnement", kind: "out", bucket: "envie", color: 0 },
  { legacy: "d23", name: "Cadeaux", kind: "out", bucket: "envie", color: 0 },
  { key: "consommable", name: "Consommable", kind: "out", bucket: "envie", color: 0 },
  { legacy: "d24", name: "Équipement", kind: "out", bucket: "envie", color: 0 },
  { legacy: "d19", name: "Sorties", kind: "out", bucket: "envie", color: 0 },
  { legacy: "d21", name: "Vêtement", kind: "out", bucket: "envie", color: 0 },
  { legacy: "d22", name: "Voyages", kind: "out", bucket: "envie", color: 0 },
];

/**
 * Les catégories par défaut des versions 0.1 à 0.5, par identifiant de l'ancienne application.
 * Celles qui ne sont plus dans `DEFAULT_CATEGORIES` disparaissent des profils qui ne les ont jamais
 * modifiées (décision 73).
 */
export const FORMER_DEFAULT_IDS: readonly string[] = [
  "r1", "r2", "r3", "r4", "r5", "r6", "r7",
  ...Array.from({ length: 23 }, (_, i) => `d${i + 8}`),
];

const categoryIdOf = (d: DefaultCategory): string => (d.legacy ? legacyCategoryId(d.legacy) : newCategoryId(d.key!));

/** Budgets par défaut, horodatés `DEFAULTS_AT`. */
export function defaultBudgets(): Budget[] {
  return DEFAULT_BUDGETS.map((b, i) => ({
    id: defaultBudgetId(b.bucket),
    updatedAt: DEFAULTS_AT,
    deletedAt: null,
    name: b.name,
    nature: b.nature,
    position: i + 1,
    color: 0,
  }));
}

/** Types par défaut, horodatés `DEFAULTS_AT` ; la précaution porte l'objectif donné. */
export function defaultTypes(precaution: TypeObjective = defaultPrecautionObjective()): BudgetType[] {
  const positions = new Map<Bucket, number>();
  return DEFAULT_TYPES.map((t) => {
    const position = (positions.get(t.bucket) ?? 0) + 1;
    positions.set(t.bucket, position);
    return {
      id: defaultTypeId(t.key),
      updatedAt: DEFAULTS_AT,
      deletedAt: null,
      budgetId: defaultBudgetId(t.bucket),
      name: t.name,
      position,
      objective: t.key === "precaution" ? precaution : null,
    };
  });
}

/** Catégories par défaut, horodatées `DEFAULTS_AT`. */
export function defaultCategories(): Category[] {
  return DEFAULT_CATEGORIES.map((d) => ({
    id: categoryIdOf(d),
    updatedAt: DEFAULTS_AT,
    deletedAt: null,
    name: d.name,
    kind: d.kind,
    ...(d.bucket ? { budgetId: defaultBudgetId(d.bucket) } : {}),
    ...(d.type ? { typeId: defaultTypeId(d.type) } : {}),
    color: d.color,
  }));
}

/** Couleur de série d'une catégorie : les sources de revenu dans l'ordre, 0 pour les dépenses. */
export function categoryColors(kinds: readonly ("in" | "out")[]): SeriesColor[] {
  let income = 0;
  return kinds.map((kind) => (kind === "in" ? income++ % 7 : 0) as SeriesColor);
}
