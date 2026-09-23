import type { Day, Month } from "./model";

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const pad2 = (n: number) => String(n).padStart(2, "0");

function parseMonth(month: Month): { y: number; m: number } {
  const match = MONTH_RE.exec(month);
  if (!match) throw new RangeError(`Mois invalide : ${month}`);
  return { y: Number(match[1]), m: Number(match[2]) };
}

export function isValidMonth(value: unknown): value is Month {
  if (typeof value !== "string") return false;
  const match = MONTH_RE.exec(value);
  if (!match) return false;
  const m = Number(match[2]);
  return m >= 1 && m <= 12;
}

export function isValidDay(value: unknown): value is Day {
  if (typeof value !== "string") return false;
  const match = DAY_RE.exec(value);
  if (!match) return false;
  const month = `${match[1]}-${match[2]}`;
  if (!isValidMonth(month)) return false;
  const d = Number(match[3]);
  return d >= 1 && d <= daysInMonth(month);
}

export function daysInMonth(month: Month): number {
  const { y, m } = parseMonth(month);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const monthOf = (day: Day): Month => day.slice(0, 7);
export const yearOf = (dayOrMonth: string): number => Number(dayOrMonth.slice(0, 4));
export const dayOfMonthOf = (day: Day): number => Number(day.slice(8, 10));

export function monthIndex(month: Month): number {
  const { y, m } = parseMonth(month);
  return y * 12 + (m - 1);
}

export function monthFromIndex(index: number): Month {
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return `${String(y).padStart(4, "0")}-${pad2(m)}`;
}

export const addMonths = (month: Month, k: number): Month => monthFromIndex(monthIndex(month) + k);

/** Mois de `from` à `to` inclus ; vide si from > to. */
export function monthRange(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let i = monthIndex(from), end = monthIndex(to); i <= end; i++) out.push(monthFromIndex(i));
  return out;
}

export const firstDayOf = (month: Month): Day => `${month}-01`;
export const lastDayOf = (month: Month): Day => `${month}-${pad2(daysInMonth(month))}`;

/** Jour `dayOfMonth` du mois, rabattu sur le dernier jour si le mois est plus court. */
export function clampedDay(month: Month, dayOfMonth: number): Day {
  return `${month}-${pad2(Math.min(Math.max(1, dayOfMonth), daysInMonth(month)))}`;
}

/** Même jour k mois plus tard, rabattu en fin de mois (31/01 + 1 mois = 28/02). */
export function addMonthsToDay(day: Day, k: number): Day {
  return clampedDay(addMonths(monthOf(day), k), dayOfMonthOf(day));
}

function dayToUtc(day: Day): number {
  const match = DAY_RE.exec(day);
  if (!match) throw new RangeError(`Jour invalide : ${day}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export const daysBetween = (from: Day, to: Day): number => Math.round((dayToUtc(to) - dayToUtc(from)) / MS_PER_DAY);

/** Plus grand k ≥ 0 tel que from + k mois ≤ to. Suppose from ≤ to. */
export function wholeMonthsBetween(from: Day, to: Day): number {
  let k = monthIndex(monthOf(to)) - monthIndex(monthOf(from));
  if (k > 0 && addMonthsToDay(from, k) > to) k -= 1;
  return Math.max(0, k);
}

/** Temps restant découpé en mois pleins puis jours. Suppose from ≤ to. */
export function monthsAndDaysBetween(from: Day, to: Day): { months: number; days: number } {
  const months = wholeMonthsBetween(from, to);
  return { months, days: daysBetween(addMonthsToDay(from, months), to) };
}

/** Jour civil local d'une date (et non UTC). */
export function toLocalDay(date: Date): Day {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export const minDay = (a: Day, b: Day): Day => (a <= b ? a : b);
export const maxMonth = (a: Month, b: Month): Month => (a >= b ? a : b);
export const minMonth = (a: Month, b: Month): Month => (a <= b ? a : b);
