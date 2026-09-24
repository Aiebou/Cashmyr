import { formatCents, type Cents, type Day, type Month } from "@cashmyr/core";

/** Gros chiffres : sans décimales. */
export const money = (cents: Cents) => formatCents(cents, { decimals: 0 });
/** Listes : deux décimales. */
export const moneyExact = (cents: Cents) => formatCents(cents, { decimals: 2 });
export const moneySigned = (cents: Cents) => formatCents(cents, { decimals: 2, signed: true });

const utc = (day: Day) => new Date(`${day}T12:00:00Z`);
const monthDate = (month: Month) => new Date(`${month}-15T12:00:00Z`);

const longDay = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const longMonth = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const monthOnly = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" });
const weekdayDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortMonth = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** « 10 novembre 2026 », « 1er novembre 2026 » : Intl n'écrit pas l'ordinal du premier du mois. */
export const dayLong = (day: Day) => longDay.format(utc(day)).replace(/^1(\s)/, "1er$1");
/** « Vendredi 28 août », « Mardi 1er septembre » : intitulé d'une journée dans une liste. */
export const dayHeading = (day: Day) => capitalize(weekdayDay.format(utc(day)).replace(/(\s)1(\s)/, "$11er$2"));
/** « 10 nov. », « 1er nov. » */
export const dayShort = (day: Day) => shortDay.format(utc(day)).replace(/^1(\s)/, "1er$1");
/** « novembre 2026 » */
export const monthLong = (month: Month) => longMonth.format(monthDate(month));
/** « de novembre 2026 », « d'octobre 2026 » : élision devant avril, août et octobre. */
export const ofMonth = (month: Month) => {
  const text = monthLong(month);
  return /^[aeiou]/.test(text) ? `d'${text}` : `de ${text}`;
};
/** « Novembre 2026 », pour un titre. */
export const monthTitle = (month: Month) => capitalize(monthLong(month));
/** « nov. 2026 » */
export const monthShort = (month: Month) => shortMonth.format(monthDate(month));
/** « novembre » */
export const monthName = (month: Month) => monthOnly.format(monthDate(month));
/** « 23 sept. 2026, 12:00 » */
export const stamp = (ms: number) => dateTime.format(new Date(ms));
/** « 512 o », « 48 Ko » */
export const fileSize = (bytes: number) => (bytes < 1024 ? `${bytes} o` : `${Math.round(bytes / 1024)} Ko`);

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** « 6 mois et 13 jours », « 5 jours », « aujourd'hui » */
export function timeLeft(t: { months: number; days: number }): string {
  if (t.months === 0 && t.days === 0) return "aujourd'hui";
  const parts = [];
  if (t.months > 0) parts.push(`${t.months} mois`);
  if (t.days > 0) parts.push(plural(t.days, "jour", "jours"));
  return parts.join(" et ");
}

export const count = plural;

const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });
export const ratio = (r: number) => percent.format(r);

/** Capacité en mois, une décimale : « 6,0 » */
export const oneDecimal = (n: number) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
