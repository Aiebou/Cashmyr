import { describe, expect, it } from "vitest";
import {
  applyChanges,
  defaultCategories,
  emptyDataset,
  importBackup,
  importLegacy,
  LEGACY_STAMP,
  legacyCategoryId,
  legacyId,
  LegacyImportError,
  parseImport,
  readLegacyExport,
  serializeBackup,
  setPreference,
  tombstone,
  touch,
  validateDataset,
  type Dataset,
} from "../src";
import { crossCheckLegacy } from "../src/migrate/legacy-check";
import { NOW } from "./fixtures";
import { legacyExport, type LegacyFixture } from "./legacy-fixture";

const op = (data: Dataset, legacy: string) => data.collections.operations.find((o) => o.id === legacyId("operation", legacy))!;

/** Les problèmes relevés, ou « accepté » si la reprise passe. */
function issuesOf(mutate: (file: LegacyFixture) => void): string[] | "accepté" {
  const file = legacyExport();
  mutate(file);
  try {
    importLegacy(file);
    return "accepté";
  } catch (e) {
    if (e instanceof LegacyImportError) return e.issues;
    throw e;
  }
}

describe("reprise de l'ancienne application (§7)", () => {
  it("convertit en centimes, avec des identifiants dérivés et l'horodatage de reprise", () => {
    const { data, counts, checked } = importLegacy(legacyExport());
    expect(validateDataset(data)).toEqual([]);
    expect(counts).toEqual({ categories: 31, accounts: 4, goals: 2, debts: 2, operations: 11, months: 2 });
    expect(checked).toEqual({ months: 3, accounts: 4, goals: 2, debts: 2 });

    for (const list of Object.values(data.collections)) {
      for (const r of list) expect(r).toMatchObject({ updatedAt: LEGACY_STAMP, deletedAt: null });
    }
    expect(op(data, "o3")).toMatchObject({
      date: "2026-07-09",
      type: "out",
      amount: 6490,
      note: "Marché",
      categoryId: legacyCategoryId("d12"),
      accountId: legacyId("account", "a1"),
    });
    expect(op(data, "o4").amount).toBe(10);
    expect(data.collections.accounts.map((a) => [a.name, a.opening])).toEqual([
      ["Compte courant", 152035],
      ["Livret A", 300000],
      ["PEA", 0],
      ["Compte joint", -12010],
    ]);

    const [voyage, apport] = data.collections.goals;
    expect(voyage).toMatchObject({ target: 300000, targetMode: "manual", pinned: false, done: false, doneAt: null, archived: false, position: 0 });
    expect(apport).toMatchObject({
      target: 2500050,
      source: "account",
      hidden: true,
      accountIds: [legacyId("account", "a2"), legacyId("account", "a3")],
      position: 1,
    });

    const [loan, advance] = data.collections.debts;
    expect(loan).toMatchObject({
      principal: 432600,
      paidManual: 36050,
      installmentAmount: 18025,
      installmentCount: 24,
      categoryId: legacyCategoryId("d16"),
      accountId: legacyId("account", "a1"),
      recurrenceId: null,
      settledAt: null,
    });
    expect(advance).toMatchObject({ direction: "lent", mode: "free", categoryId: null, accountId: null, pinned: true });

    const p = data.preferences;
    expect(p.splits).toEqual({ besoin: 5000, envie: 3000, invest: 2000 });
    expect(p.basis).toBe("month");
    expect(p.safety).toEqual({ mode: "months", months: 3, amount: 0, hidden: false, pinned: true });
    // Le thème n'existait pas : il ne remplace rien.
    expect(p.updatedAt.theme).toBe(0);
    expect(p.updatedAt.splits).toBe(LEGACY_STAMP);
  });

  it("catégories par défaut et catégories reprises partagent leurs identifiants", () => {
    const { data } = importLegacy(legacyExport());
    const imported = new Map(data.collections.categories.map((c) => [c.id, c]));
    for (const seed of defaultCategories()) {
      // Même ligne, seule la version change : la reprise l'emporte sur le jeu de départ jamais modifié.
      expect(imported.get(seed.id)).toEqual({ ...seed, updatedAt: LEGACY_STAMP });
    }
    expect(imported.has(legacyCategoryId("k3x9pw2mzq1a"))).toBe(true);
  });

  it("vérification croisée : identique au centime, et elle voit le moindre écart", () => {
    const file = legacyExport();
    const { data } = importLegacy(file);
    const legacy = readLegacyExport(file);
    expect(crossCheckLegacy(legacy, data).issues).toEqual([]);

    const o2 = op(data, "o2");
    const tampered = applyChanges(data, { operations: [{ ...o2, amount: o2.amount + 1 }] });
    expect(crossCheckLegacy(legacy, tampered).issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/les besoins de 2026-07 vaut/),
        expect.stringMatching(/le solde du compte « Compte courant »/),
      ]),
    );

    const loan = data.collections.debts[0]!;
    const moved = applyChanges(data, { debts: [{ ...loan, paidManual: 0 }] });
    expect(crossCheckLegacy(legacy, moved).issues).toEqual([expect.stringMatching(/réglé de la dette « Prêt auto »/)]);
  });

  it("refuse tout le fichier au moindre champ ou cas inconnu, en disant où", () => {
    const july = (f: LegacyFixture) => f.months["2026-07"]!.items;
    const cases: [string, (f: LegacyFixture) => void, RegExp][] = [
      ["champ en trop à la racine", (f) => Object.assign(f, { exportedAt: 1 }), /^fichier\.exportedAt : champ inconnu/],
      ["version inconnue", (f) => (f.settings.v = 3), /version 3/],
      ["champ inconnu sur une opération", (f) => (july(f)[0]!.tag = "x"), /items\[0\]\.tag : champ inconnu/],
      ["champ manquant", (f) => delete july(f)[0]!.note, /items\[0\]\.note : champ manquant/],
      ["trois décimales", (f) => (july(f)[2]!.amt = 12.345), /plus de deux décimales/],
      ["montant négatif", (f) => (july(f)[2]!.amt = -5), /strictement positif/],
      ["opération rangée dans un autre mois", (f) => (july(f)[1]!.d = "2026-08-03"), /rangé dans le mois 2026-07/],
      ["catégorie introuvable", (f) => (july(f)[1]!.cat = "d99"), /catégorie "d99" introuvable/],
      ["catégorie d'un autre type", (f) => (july(f)[0]!.cat = "d8"), /d'un autre type/],
      ["compte introuvable", (f) => (july(f)[0]!.acc = "a9"), /compte "a9" introuvable/],
      ["identifiants en double", (f) => (july(f)[1]!.id = "o1"), /"o1" en double/],
      ["répartition différente de 100 %", (f) => (f.settings.splits.invest = 0.3), /ne fait pas 100 %/],
      ["bloc inconnu du tableau de bord", (f) => f.settings.dashOrder.push("news"), /dashOrder\[6\] : valeur inconnue/],
      ["rôle de compte inconnu", (f) => (f.settings.accounts[0]!.role = "joint"), /accounts\[0\]\.role : valeur inconnue/],
      // Cas connus de l'ancienne application, format pas encore vu dans un export.
      ["transfert", (f) => (july(f)[0]!.t = "tx"), /transfert, format pas encore pris en charge/],
      ["rattachement à un objectif", (f) => (july(f)[0]!.goal = "g8f2kqz0v1ta"), /rattachement à un objectif/],
      ["rattachement à une dette", (f) => (july(f)[1]!.debt = "dx1r8m2k0qwe"), /rattachement à une dette/],
      ["récurrence", (f) => f.settings.recurring.push({}), /récurrences, format pas encore/],
      ["mois annulé", (f) => f.months["2026-07"]!.skips.push({}), /mois annulés de récurrences/],
      ["couleur choisie", (f) => (f.settings.catColors.r1 = "#336699"), /catColors : couleurs choisies/],
      ["prélèvement d'une dette", (f) => (f.settings.debts[0]!.recurrenceId = "rx1"), /prélèvement associé/],
    ];
    for (const [label, mutate, expected] of cases) {
      const issues = issuesOf(mutate);
      expect(issues, label).not.toBe("accepté");
      expect(issues, label).toEqual(expect.arrayContaining([expect.stringMatching(expected)]));
    }
    expect(() => importLegacy({ settings: {}, months: {} })).toThrow(/Reprise refusée, rien n'a été écrit/);
  });

  it("Cashmyr gagne : réimporter n'ajoute que ce qui manque, sans rien écraser (décision 34)", () => {
    const { data: imported } = importLegacy(legacyExport());
    const first = importBackup(emptyDataset(), imported);
    const after = applyChanges({ ...emptyDataset(), preferences: first.preferences }, first.changes);
    expect(after.collections.operations).toHaveLength(11);

    // Depuis, dans Cashmyr : une opération modifiée, une supprimée, un réglage changé.
    const edited = applyChanges(
      { ...after, preferences: setPreference(after.preferences, "averageWindow", 12, NOW) },
      { operations: [touch(op(after, "o3"), { amount: 7000 }, NOW), tombstone(op(after, "o10"), NOW)] },
    );
    const again = importBackup(edited, importLegacy(legacyExport()).data);
    expect(again.rows).toBe(0);
    expect(again.preferencesChanged).toEqual([]);

    // Deux appareils qui importent le même fichier produisent les mêmes lignes.
    expect(importLegacy(legacyExport()).data).toEqual(imported);
  });

  it("après « Commencer avec les catégories par défaut », la reprise ne duplique aucune catégorie", () => {
    const seeded = applyChanges(emptyDataset(), { categories: defaultCategories() });
    const result = importBackup(seeded, importLegacy(legacyExport()).data);
    const after = applyChanges({ ...seeded, preferences: result.preferences }, result.changes);
    expect(after.collections.categories).toHaveLength(31);
    expect(validateDataset(after)).toEqual([]);
  });

  it("un seul point d'entrée pour importer : sauvegarde Cashmyr ou ancien fichier", () => {
    expect(parseImport(JSON.stringify(legacyExport())).kind).toBe("legacy");
    expect(parseImport(serializeBackup(emptyDataset())).kind).toBe("backup");
    const broken = legacyExport();
    broken.settings.v = 1;
    expect(() => parseImport(JSON.stringify(broken))).toThrow(LegacyImportError);
  });
});
