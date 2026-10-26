import { setPreference } from "./dataset";
import { BUCKETS, defaultBudgetId } from "./defaults";
import type { Bucket, Budget, Category, Preferences, SeriesColor } from "./model";

/** Couleur d'une source de revenu, d'un budget, ou d'une série (compte, objectif, dette). */
export type ColorTarget =
  | { kind: "income"; category: Pick<Category, "id" | "color"> }
  | { kind: "budget"; budget: Pick<Budget, "id" | "color"> }
  | { kind: "series"; color: SeriesColor };

type ColorPrefs = Pick<Preferences, "categoryColors" | "budgetColors">;

/** Les trois budgets par défaut gardent la couleur du thème de l'usage qu'ils remplacent (décision 76). */
const THEME_BUDGETS = new Map<string, Bucket>(BUCKETS.map((b) => [defaultBudgetId(b), b]));

export const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** Couleurs par défaut : variables CSS du thème, qui suivent le clair et le sombre. */
export const seriesColorVar = (color: SeriesColor): string => `var(--series-${color})`;
export const bucketColorVar = (bucket: Bucket): string => `var(--bucket-${bucket})`;

function customColor(prefs: ColorPrefs, target: ColorTarget): string | undefined {
  if (target.kind === "income") return prefs.categoryColors[target.category.id];
  if (target.kind === "budget") return prefs.budgetColors[target.budget.id];
  return undefined;
}

/**
 * Accesseur unique : la couleur choisie par l'utilisateur si elle existe,
 * sinon la variable CSS du thème.
 */
export function colorFor(prefs: ColorPrefs, target: ColorTarget): string {
  const custom = customColor(prefs, target);
  if (custom !== undefined) return custom;
  if (target.kind === "income") return seriesColorVar(target.category.color);
  if (target.kind === "budget") {
    const bucket = THEME_BUDGETS.get(target.budget.id);
    return bucket ? bucketColorVar(bucket) : seriesColorVar(target.budget.color);
  }
  return seriesColorVar(target.color);
}

/** Vrai si une couleur personnalisée est en place : afficher le bouton de retour à l'origine. */
export const hasCustomColor = (prefs: ColorPrefs, target: ColorTarget): boolean =>
  customColor(prefs, target) !== undefined;

function checked(color: string | null): string | null {
  if (color !== null && !isHexColor(color)) throw new RangeError(`Couleur invalide : ${color}`);
  return color === null ? null : color.toLowerCase();
}

/** Choisit (ou, avec null, réinitialise) la couleur d'une source de revenu. */
export function setIncomeColor(prefs: Preferences, categoryId: string, color: string | null, now: number): Preferences {
  const value = checked(color);
  const next = { ...prefs.categoryColors };
  if (value === null) delete next[categoryId];
  else next[categoryId] = value;
  return setPreference(prefs, "categoryColors", next, now);
}

/** Choisit (ou, avec null, réinitialise) la couleur d'un budget. */
export function setBudgetColor(prefs: Preferences, budgetId: string, color: string | null, now: number): Preferences {
  const value = checked(color);
  const next = { ...prefs.budgetColors };
  if (value === null) delete next[budgetId];
  else next[budgetId] = value;
  return setPreference(prefs, "budgetColors", next, now);
}
