import { describe, expect, it } from "vitest";
import {
  addMonths,
  addMonthsToDay,
  applyBasisPoints,
  centsToInput,
  clampedDay,
  formatCents,
  isValidDay,
  monthRange,
  monthsAndDaysBetween,
  parseAmount,
  roundDiv,
  wholeMonthsBetween,
} from "../src";

const spaces = (s: string) => s.replace(/[  ]/g, " ");

describe("saisie des montants", () => {
  it.each([
    ["12,50", 1250],
    ["12.5", 1250],
    ["12,", 1200],
    ["0,1", 10],
    ["1 234,56", 123456],
    ["1 234,56", 123456],
    ["1 234", 123400],
    ["12 €", 1200],
    ["  7  ", 700],
  ])("« %s » → %i centimes", (input, cents) => {
    expect(parseAmount(input)).toBe(cents);
  });

  it.each(["", "abc", "12,345", "1.234", ",5", "1,2,3", "-3"])("refuse « %s »", (input) => {
    expect(parseAmount(input)).toBeNull();
  });

  it("accepte un signe moins seulement si on le demande", () => {
    expect(parseAmount("-3,5", { allowNegative: true })).toBe(-350);
    expect(parseAmount("−10", { allowNegative: true })).toBe(-1000);
  });

  it("pré-remplit un champ avec une virgule", () => {
    expect(centsToInput(1250)).toBe("12,50");
    expect(centsToInput(-5)).toBe("-0,05");
  });
});

describe("arrondis", () => {
  it("arrondit au centime le plus proche, demi loin de zéro", () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(1, 3)).toBe(0);
    expect(roundDiv(2, 3)).toBe(1);
    expect(roundDiv(500_000, 3)).toBe(166_667);
  });

  it("applique une répartition en points de base sans flottant", () => {
    expect(applyBasisPoints(333_333, 3000)).toBe(100_000);
    expect(applyBasisPoints(1, 5000)).toBe(1);
    expect(applyBasisPoints(9_000_000_000_000, 5000)).toBe(4_500_000_000_000);
  });
});

describe("affichage des montants", () => {
  it("deux décimales dans les listes", () => {
    expect(spaces(formatCents(123456))).toBe("1 234,56 €");
  });
  it("aucune décimale dans les gros chiffres, arrondi demi vers le haut", () => {
    expect(spaces(formatCents(123450, { decimals: 0 }))).toBe("1 235 €");
    expect(spaces(formatCents(123449, { decimals: 0 }))).toBe("1 234 €");
  });
  it("signe explicite sur demande", () => {
    expect(spaces(formatCents(5000, { decimals: 0, signed: true }))).toBe("+50 €");
  });
});

describe("dates", () => {
  it("rabat le 31 sur le dernier jour des mois courts", () => {
    expect(clampedDay("2026-02", 31)).toBe("2026-02-28");
    expect(clampedDay("2028-02", 31)).toBe("2028-02-29");
    expect(clampedDay("2026-04", 31)).toBe("2026-04-30");
    expect(addMonthsToDay("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("valide le calendrier", () => {
    expect(isValidDay("2026-02-29")).toBe(false);
    expect(isValidDay("2028-02-29")).toBe(true);
    expect(isValidDay("2026-13-01")).toBe(false);
  });

  it("parcourt les mois", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthRange("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthRange("2026-03", "2026-02")).toEqual([]);
  });

  it("compte les mois pleins et les jours restants", () => {
    expect(wholeMonthsBetween("2026-09-23", "2027-04-05")).toBe(6);
    expect(monthsAndDaysBetween("2026-09-23", "2027-04-05")).toEqual({ months: 6, days: 13 });
    expect(wholeMonthsBetween("2026-09-23", "2026-10-22")).toBe(0);
    expect(wholeMonthsBetween("2026-09-23", "2026-10-23")).toBe(1);
  });
});
