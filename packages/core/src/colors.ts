import { setPreference } from "./dataset";
import type { Bucket, Category, Preferences, SeriesColor } from "./model";

/** Couleur d'une source de revenu, d'un usage de dépense, ou d'une série (compte, objectif, dette). */
export type ColorTarget =
  | { kind: "income"; category: Pick<Category, "id" | "color"> }
  | { kind: "bucket"; bucket: Bucket }
  | { kind: "series"; color: SeriesColor };

type ColorPrefs = Pick<Preferences, "categoryColors" | "bucketColors">;

export const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** Couleurs par défaut : variables CSS du thème, qui suivent le clair et le sombre. */
export const seriesColorVar = (color: SeriesColor): string => `var(--series-${color})`;
export const bucketColorVar = (bucket: Bucket): string => `var(--bucket-${bucket})`;

function customColor(prefs: ColorPrefs, target: ColorTarget): string | undefined {
  if (target.kind === "income") return prefs.categoryColors[target.category.id];
  if (target.kind === "bucket") return prefs.bucketColors[target.bucket];
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
  if (target.kind === "bucket") return bucketColorVar(target.bucket);
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

/** Choisit (ou, avec null, réinitialise) la couleur d'un usage de dépense. */
export function setBucketColor(prefs: Preferences, bucket: Bucket, color: string | null, now: number): Preferences {
  const value = checked(color);
  const next = { ...prefs.bucketColors };
  if (value === null) delete next[bucket];
  else next[bucket] = value;
  return setPreference(prefs, "bucketColors", next, now);
}
