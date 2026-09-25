import { colorFor, indexOf, type Bucket, type Cents, type Dataset } from "@cashmyr/core";
import { categoryName } from "./data";

/** Part d'un camembert de l'écran Mois. « Autres » n'a pas de couleur : il est hachuré, et détaille ses postes. */
export type Slice = { key: string; label: string; value: Cents; color: string | null; details?: { key: string; label: string; value: Cents }[] };

/**
 * Cinq parts au plus : les quatre plus gros postes, puis « Autres ». Au-delà, deux postes d'un
 * même usage finissent par se confondre (nuances vérifiées au validateur de palettes, en clair
 * et en sombre, y compris la dernière part contre la première).
 */
export const MAX_SLICES = 5;
export const OTHERS_KEY = "autres";

/** Les plus gros postes, puis le reste regroupé ; `items` est trié du plus gros au plus petit. */
export function foldSlices<T>(items: readonly T[]): { kept: T[]; folded: T[] } {
  if (items.length <= MAX_SLICES) return { kept: [...items], folded: [] };
  return { kept: items.slice(0, MAX_SLICES - 1), folded: items.slice(MAX_SLICES - 1) };
}

const othersSlice = (folded: readonly { key: string; label: string; value: Cents }[]): Slice => ({
  key: OTHERS_KEY,
  label: `Autres (${folded.length} postes)`,
  value: folded.reduce((sum, i) => sum + i.value, 0),
  color: null,
  details: [...folded],
});

const BUCKET_ORDER: readonly (Bucket | undefined)[] = ["besoin", "envie", "invest", undefined];
/**
 * Nuances d'une couleur d'usage pour les postes d'un même usage, du plus gros au plus petit :
 * la couleur, puis alternativement vers le fond et vers l'encre, pour que deux parts voisines
 * tranchent toujours. Au plus quatre postes par usage (MAX_SLICES − 1).
 */
const shade = (color: string, rank: number) =>
  [color, `color-mix(in srgb, ${color} 50%, var(--panel))`, `color-mix(in srgb, ${color} 62%, var(--ink))`, `color-mix(in srgb, ${color} 30%, var(--panel))`][
    rank
  ] ?? color;

/**
 * Dépenses du mois par poste, toutes les dépenses (besoins, envies, épargne). Les parts sont
 * rangées par usage, comme la Répartition, et prennent la couleur de leur usage : du plus gros
 * poste au plus petit, de la nuance la plus soutenue à la plus claire.
 */
export function expenseSlices(data: Dataset, spending: readonly { categoryId: string; amount: Cents }[]): Slice[] {
  const ix = indexOf(data);
  const items = spending.map((s) => ({
    key: s.categoryId,
    label: categoryName(data, s.categoryId),
    value: s.amount,
    bucket: ix.categories.get(s.categoryId)?.bucket,
  }));
  const { kept, folded } = foldSlices(items);
  const slices: Slice[] = [];
  for (const bucket of BUCKET_ORDER) {
    // Catégorie introuvable : anomalie déjà signalée par l'écran, en gris foncé.
    const base = bucket ? colorFor(data.preferences, { kind: "bucket", bucket }) : "var(--ink-2)";
    kept
      .filter((i) => i.bucket === bucket)
      .forEach((i, rank) => slices.push({ key: i.key, label: i.label, value: i.value, color: bucket ? shade(base, rank) : base }));
  }
  if (folded.length > 0) slices.push(othersSlice(folded));
  return slices;
}

/** Revenus du mois par source, dans la couleur de chaque source (celle du bandeau des revenus). */
export function incomeSlices(data: Dataset, sources: readonly { categoryId: string; amount: Cents }[]): Slice[] {
  const ix = indexOf(data);
  const { kept, folded } = foldSlices(sources.map((s) => ({ key: s.categoryId, label: categoryName(data, s.categoryId), value: s.amount })));
  const slices = kept.map((s): Slice => {
    const c = ix.categories.get(s.key);
    return { ...s, color: c ? colorFor(data.preferences, { kind: "income", category: c }) : "var(--ink-2)" };
  });
  if (folded.length > 0) slices.push(othersSlice(folded));
  return slices;
}
