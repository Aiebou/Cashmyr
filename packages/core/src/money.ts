import type { Cents } from "./model";

export function isCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function roundDivBig(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError("Division par zéro");
  const q = n / d;
  const r = n % d;
  if (r === 0n) return q;
  const absR = r < 0n ? -r : r;
  const absD = d < 0n ? -d : d;
  if (absR * 2n < absD) return q;
  return (n < 0n) !== (d < 0n) ? q - 1n : q + 1n;
}

function toSafe(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError("Montant hors limites");
  return n;
}

/**
 * Division entière arrondie au plus proche, demi loin de zéro.
 * Exacte : calculée en BigInt, aucun flottant intermédiaire.
 */
export function roundDiv(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new RangeError("roundDiv attend des entiers");
  }
  return toSafe(roundDivBig(BigInt(numerator), BigInt(denominator)));
}

/** round(a × b ÷ d), même règle d'arrondi, sans dépassement. */
export function mulDiv(a: number, b: number, d: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(d)) {
    throw new RangeError("mulDiv attend des entiers");
  }
  return toSafe(roundDivBig(BigInt(a) * BigInt(b), BigInt(d)));
}

/** Part d'un montant exprimée en points de base (5000 = 50 %). */
export function applyBasisPoints(cents: Cents, basisPoints: number): Cents {
  return mulDiv(cents, basisPoints, 10_000);
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  if (!Number.isSafeInteger(total)) throw new RangeError("Somme hors limites");
  return total;
}

const SPACES = /[\s  ]/g;
const AMOUNT = /^(\d+)(?:[.,](\d{0,2}))?$/;

/**
 * Lit une saisie en euros : « 12,5 », « 12.50 », « 1 234,56 », « 12 € ».
 * Un seul séparateur décimal, deux décimales au plus : « 1.234 » est refusé
 * plutôt que deviné. Renvoie null si la saisie n'est pas un montant.
 */
export function parseAmount(input: string, options: { allowNegative?: boolean } = {}): Cents | null {
  let text = input.replace(SPACES, "").replace(/€$/, "").replace(/^€/, "");
  let sign = 1;
  if (/^[-−]/.test(text)) {
    if (!options.allowNegative) return null;
    sign = -1;
    text = text.slice(1);
  }
  const match = AMOUNT.exec(text);
  if (!match) return null;
  const units = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = BigInt(units) * 100n + BigInt(fraction);
  const value = Number(cents) * sign;
  if (!Number.isSafeInteger(value)) return null;
  return value === 0 ? 0 : value;
}

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(decimals: 0 | 2, signed: boolean): Intl.NumberFormat {
  const key = `${decimals}:${signed}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      signDisplay: signed ? "exceptZero" : "auto",
    });
    formatters.set(key, f);
  }
  return f;
}

/**
 * Affichage en euros. `decimals: 0` pour les gros chiffres, `2` pour les listes.
 * La division par 100 n'a lieu qu'ici, pour l'affichage.
 */
export function formatCents(cents: Cents, options: { decimals?: 0 | 2; signed?: boolean } = {}): string {
  const decimals = options.decimals ?? 2;
  const shown = decimals === 0 ? roundDiv(cents, 100) : cents / 100;
  return formatter(decimals, options.signed ?? false).format(shown);
}

/** Valeur à pré-remplir dans un champ de saisie : 1250 → « 12,50 ». */
export function centsToInput(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const units = Math.trunc(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${sign}${units},${fraction}`;
}
