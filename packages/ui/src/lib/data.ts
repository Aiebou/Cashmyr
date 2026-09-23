import {
  colorFor,
  derivedId,
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

/** Catégories par défaut, reprises de l'application d'origine. Identifiants dérivés : deux appareils qui les créent n'en font qu'un jeu. */
const DEFAULTS: { name: string; kind: "in" | "out"; bucket?: Bucket }[] = [
  { name: "Salaire", kind: "in" },
  { name: "Service et pourboires", kind: "in" },
  { name: "Missions freelance", kind: "in" },
  { name: "Primes", kind: "in" },
  { name: "Revenus de trading", kind: "in" },
  { name: "Aides et remboursements", kind: "in" },
  { name: "Autre revenu", kind: "in" },
  { name: "Loyer et charges", kind: "out", bucket: "besoin" },
  { name: "Énergie et eau", kind: "out", bucket: "besoin" },
  { name: "Internet et téléphone", kind: "out", bucket: "besoin" },
  { name: "Assurances", kind: "out", bucket: "besoin" },
  { name: "Courses", kind: "out", bucket: "besoin" },
  { name: "Transport", kind: "out", bucket: "besoin" },
  { name: "Santé", kind: "out", bucket: "besoin" },
  { name: "Impôts", kind: "out", bucket: "besoin" },
  { name: "Crédit", kind: "out", bucket: "besoin" },
  { name: "Frais bancaires", kind: "out", bucket: "besoin" },
  { name: "Restaurants et bars", kind: "out", bucket: "envie" },
  { name: "Sorties et loisirs", kind: "out", bucket: "envie" },
  { name: "Abonnements", kind: "out", bucket: "envie" },
  { name: "Vêtements", kind: "out", bucket: "envie" },
  { name: "Voyages", kind: "out", bucket: "envie" },
  { name: "Cadeaux", kind: "out", bucket: "envie" },
  { name: "Équipement", kind: "out", bucket: "envie" },
  { name: "Épargne de précaution", kind: "out", bucket: "invest" },
  { name: "PEA et ETF", kind: "out", bucket: "invest" },
  { name: "Assurance-vie", kind: "out", bucket: "invest" },
  { name: "PER", kind: "out", bucket: "invest" },
  { name: "Compte de trading", kind: "out", bucket: "invest" },
  { name: "Crypto", kind: "out", bucket: "invest" },
];

export function defaultCategories(): Category[] {
  let income = 0;
  return DEFAULTS.map((d) => ({
    id: derivedId("seed-category", d.name),
    updatedAt: 0,
    deletedAt: null,
    name: d.name,
    kind: d.kind,
    ...(d.bucket ? { bucket: d.bucket } : {}),
    color: (d.kind === "in" ? income++ % 7 : 0) as SeriesColor,
  }));
}
