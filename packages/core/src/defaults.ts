import { legacyId } from "./ids";
import type { Bucket, Category, SeriesColor } from "./model";

/**
 * Catégories par défaut, telles que l'ancien fichier les contient, avec leurs identifiants
 * (`r1`… pour les revenus, `d8`… pour les dépenses). Leurs identifiants dérivent de ceux-là,
 * comme à l'import : un appareil qui a commencé avec elles puis reprend l'ancien fichier
 * n'en a qu'un jeu, et deux appareils qui les créent aussi. La dernière version du code de
 * l'ancienne application ne crée plus que `r1`… `d24` et nomme `r5` « Gains de trading » :
 * un fichier qui en viendrait garde ses noms, qui l'emportent à la reprise.
 */
export const DEFAULT_CATEGORIES: readonly { legacy: string; name: string; kind: "in" | "out"; bucket?: Bucket }[] = [
  { legacy: "r1", name: "Salaire", kind: "in" },
  { legacy: "r2", name: "Service et pourboires", kind: "in" },
  { legacy: "r3", name: "Missions freelance", kind: "in" },
  { legacy: "r4", name: "Primes", kind: "in" },
  { legacy: "r5", name: "Revenus de trading", kind: "in" },
  { legacy: "r6", name: "Aides et remboursements", kind: "in" },
  { legacy: "r7", name: "Autre revenu", kind: "in" },
  { legacy: "d8", name: "Loyer et charges", kind: "out", bucket: "besoin" },
  { legacy: "d9", name: "Énergie et eau", kind: "out", bucket: "besoin" },
  { legacy: "d10", name: "Internet et téléphone", kind: "out", bucket: "besoin" },
  { legacy: "d11", name: "Assurances", kind: "out", bucket: "besoin" },
  { legacy: "d12", name: "Courses", kind: "out", bucket: "besoin" },
  { legacy: "d13", name: "Transport", kind: "out", bucket: "besoin" },
  { legacy: "d14", name: "Santé", kind: "out", bucket: "besoin" },
  { legacy: "d15", name: "Impôts", kind: "out", bucket: "besoin" },
  { legacy: "d16", name: "Crédit", kind: "out", bucket: "besoin" },
  { legacy: "d17", name: "Frais bancaires", kind: "out", bucket: "besoin" },
  { legacy: "d18", name: "Restaurants et bars", kind: "out", bucket: "envie" },
  { legacy: "d19", name: "Sorties et loisirs", kind: "out", bucket: "envie" },
  { legacy: "d20", name: "Abonnements", kind: "out", bucket: "envie" },
  { legacy: "d21", name: "Vêtements", kind: "out", bucket: "envie" },
  { legacy: "d22", name: "Voyages", kind: "out", bucket: "envie" },
  { legacy: "d23", name: "Cadeaux", kind: "out", bucket: "envie" },
  { legacy: "d24", name: "Équipement", kind: "out", bucket: "envie" },
  { legacy: "d25", name: "Épargne de précaution", kind: "out", bucket: "invest" },
  { legacy: "d26", name: "PEA et ETF", kind: "out", bucket: "invest" },
  { legacy: "d27", name: "Assurance-vie", kind: "out", bucket: "invest" },
  { legacy: "d28", name: "PER", kind: "out", bucket: "invest" },
  { legacy: "d29", name: "Compte de trading", kind: "out", bucket: "invest" },
  { legacy: "d30", name: "Crypto", kind: "out", bucket: "invest" },
];

/** Identifiant Cashmyr d'une catégorie de l'ancienne application. */
export const legacyCategoryId = (id: string): string => legacyId("category", id);

/** Couleur de série d'une catégorie : les sources de revenu dans l'ordre, 0 pour les dépenses. */
export function categoryColors(kinds: readonly ("in" | "out")[]): SeriesColor[] {
  let income = 0;
  return kinds.map((kind) => (kind === "in" ? income++ % 7 : 0) as SeriesColor);
}

/** Jeu de départ, horodaté 0 : la moindre version écrite ailleurs l'emporte. */
export function defaultCategories(): Category[] {
  const colors = categoryColors(DEFAULT_CATEGORIES.map((d) => d.kind));
  return DEFAULT_CATEGORIES.map((d, i) => ({
    id: legacyCategoryId(d.legacy),
    updatedAt: 0,
    deletedAt: null,
    name: d.name,
    kind: d.kind,
    ...(d.bucket ? { bucket: d.bucket } : {}),
    color: colors[i]!,
  }));
}
