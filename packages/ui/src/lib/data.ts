import {
  colorFor,
  indexOf,
  type Account,
  type Bucket,
  type Category,
  type Dataset,
  type Debt,
  type Goal,
  type Operation,
  type SeriesColor,
} from "@cashmyr/core";

export const BUCKET_LABELS: Record<Bucket, string> = {
  besoin: "Besoins",
  envie: "Envies",
  invest: "Mise de côté",
};

export const ROLE_LABELS: Record<Account["role"], string> = {
  courant: "Compte courant",
  epargne: "Épargne",
  invest: "Placement",
  autre: "Autre",
};

const deleted = (name: string) => `${name} (supprimé)`;

export const liveCategories = (data: Dataset, kind: "in" | "out"): Category[] =>
  data.collections.categories
    .filter((c) => c.deletedAt === null && c.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

/** Catégories de dépense groupées par usage, dans l'ordre Besoins, Envies, Mise de côté. */
export function expenseGroups(data: Dataset): { bucket: Bucket; label: string; categories: Category[] }[] {
  const all = liveCategories(data, "out");
  return (["besoin", "envie", "invest"] as Bucket[]).map((bucket) => ({
    bucket,
    label: BUCKET_LABELS[bucket],
    categories: all.filter((c) => c.bucket === bucket),
  }));
}

export const liveAccounts = (data: Dataset): Account[] => data.collections.accounts.filter((a) => a.deletedAt === null);

export const liveGoals = (data: Dataset): Goal[] =>
  data.collections.goals.filter((g) => g.deletedAt === null && !g.archived).sort((a, b) => a.position - b.position);

export const liveDebts = (data: Dataset): Debt[] =>
  data.collections.debts.filter((d) => d.deletedAt === null && !d.archived).sort((a, b) => a.position - b.position);

export function categoryName(data: Dataset, id: string | undefined): string {
  if (!id) return "Sans catégorie";
  const c = indexOf(data).categories.get(id);
  if (!c) return "Catégorie inconnue";
  return c.deletedAt === null ? c.name : deleted(c.name);
}

export function accountName(data: Dataset, id: string | undefined): string {
  if (!id) return "—";
  const a = indexOf(data).accounts.get(id);
  if (!a) return "Compte inconnu";
  return a.deletedAt === null ? a.name : deleted(a.name);
}

/** Libellé d'une opération dans une liste. */
export function operationLabel(data: Dataset, op: Operation): string {
  if (op.note.trim()) return op.note.trim();
  if (op.type === "tx") return `${accountName(data, op.fromAccountId)} → ${accountName(data, op.toAccountId)}`;
  return categoryName(data, op.categoryId);
}

/** Pastille d'une opération : source de revenu, usage de la dépense, ou neutre pour un transfert. */
export function operationColor(data: Dataset, op: Operation): string {
  const prefs = data.preferences;
  if (op.type === "tx") return "var(--ink-3)";
  const c = op.categoryId ? indexOf(data).categories.get(op.categoryId) : undefined;
  if (!c) return "var(--ink-3)";
  if (op.type === "in") return colorFor(prefs, { kind: "income", category: c });
  return c.bucket ? colorFor(prefs, { kind: "bucket", bucket: c.bucket }) : "var(--ink-3)";
}

/** Prochaine couleur de série : attribuée dans l'ordre de création. */
export const nextColor = (existing: readonly { color: SeriesColor }[]): SeriesColor =>
  (existing.length % 7) as SeriesColor;

/** Catégories par défaut : définies dans `core`, avec les identifiants de l'ancienne application. */
export { defaultCategories } from "@cashmyr/core";
