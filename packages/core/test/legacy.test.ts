import { describe, expect, it } from "vitest";
import {
  applyChanges,
  defaultCategories,
  emptyDataset,
  goalProgress,
  goalTarget,
  importBackup,
  importLegacy,
  LEGACY_STAMP,
  legacyCategoryId,
  legacyId,
  LegacyImportError,
  materializeRecurrences,
  monthAggregates,
  occurrenceId,
  parseImport,
  readLegacyExport,
  serializeBackup,
  setPreference,
  skipId,
  tombstone,
  touch,
  validateDataset,
  type Dataset,
} from "../src";
import { crossCheckLegacy } from "../src/migrate/legacy-check";
import { NOW } from "./fixtures";
import { legacyExport, type LegacyFixture } from "./legacy-fixture";

const rec = (legacy: string) => legacyId("recurrence", legacy);
/** Identifiant attendu d'une opération de la fixture : celui de l'occurrence de son mois si elle est générée. */
function expectedId(legacy: string): string {
  for (const [month, m] of Object.entries(legacyExport().months)) {
    const it = m.items.find((x) => x.id === legacy);
    if (it) return typeof it.rec === "string" ? occurrenceId(rec(it.rec), month) : legacyId("operation", legacy);
  }
  throw new Error(`opération ${legacy} absente de la fixture`);
}
const op = (data: Dataset, legacy: string) => data.collections.operations.find((o) => o.id === expectedId(legacy))!;
const acc = (legacy: string) => legacyId("account", legacy);
const july = (f: LegacyFixture) => f.months["2026-07"]!.items;

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
    const { data, counts, checked, deadLinks, clearedDebtCategories } = importLegacy(legacyExport());
    expect(validateDataset(data)).toEqual([]);
    expect(counts).toEqual({ categories: 31, accounts: 4, goals: 2, debts: 3, recurrences: 3, operations: 17, months: 2, skips: 1 });
    expect(checked).toEqual({ months: 3, accounts: 4, goals: 2, debts: 3 });
    expect(deadLinks).toBe(0);

    for (const list of Object.values(data.collections)) {
      for (const r of list) expect(r).toMatchObject({ updatedAt: LEGACY_STAMP, deletedAt: null });
    }
    expect(op(data, "o3")).toMatchObject({
      date: "2026-07-09",
      type: "out",
      amount: 6490,
      note: "Marché",
      categoryId: legacyCategoryId("d12"),
      accountId: acc("a1"),
    });
    expect(op(data, "o4").amount).toBe(10);
    expect(data.collections.accounts.map((a) => [a.name, a.opening, a.declaredValue])).toEqual([
      ["Compte courant", 152035, undefined],
      ["Livret A", 300000, 310050],
      ["PEA", 0, undefined],
      ["Compte joint", -12010, undefined],
    ]);
    expect(clearedDebtCategories).toEqual(["Dépannage"]);
  });

  it("transferts, rattachements, récurrences et mois annulés, tels que l'ancienne application les écrit", () => {
    const { data } = importLegacy(legacyExport());
    const g = legacyId("goal", "g8f2kqz0v1ta");
    const d = legacyId("debt", "dx1r8m2k0qwe");
    expect(op(data, "o8")).toEqual(
      expect.objectContaining({ type: "tx", fromAccountId: acc("a1"), toAccountId: acc("a2"), goalId: g, recurrenceId: rec("rc3") }),
    );
    expect(op(data, "o8").categoryId).toBeUndefined();
    expect(op(data, "o9")).toMatchObject({ debtId: d, recurrenceId: rec("rc2") });
    expect(op(data, "o16")).toMatchObject({ debtId: d });
    expect(op(data, "o16").recurrenceId).toBeUndefined();

    const [loyer, pret, epargne] = data.collections.recurrences;
    expect(loyer).toMatchObject({ id: rec("rc1"), label: "Loyer", amount: 85000, type: "out", dayOfMonth: 3, startMonth: "2026-07", endMonth: null, active: true });
    expect(pret).toMatchObject({ debtId: d, endMonth: "2028-05", amount: 18025 });
    expect(epargne).toMatchObject({ type: "tx", fromAccountId: acc("a1"), toAccountId: acc("a2"), goalId: g, active: true });
    expect(data.collections.skips).toEqual([
      { id: skipId(rec("rc1"), "2026-08"), updatedAt: LEGACY_STAMP, deletedAt: null, month: "2026-08", recurrenceId: rec("rc1") },
    ]);

    // Les occurrences reprises portent l'identifiant de l'occurrence de leur mois : Cashmyr
    // ne recrée ni ce qui existe déjà, ni le loyer annulé d'août.
    expect(op(data, "o2").id).toBe(occurrenceId(rec("rc1"), "2026-07"));
    expect(materializeRecurrences(data, "2026-08-31", NOW)).toEqual([]);
    // En septembre, seul le mois qui manque au fichier est généré. Le prélèvement du prêt suit
    // l'échéancier restant (décision 24) : avec le versement d'août, la prochaine échéance est en octobre.
    expect(materializeRecurrences(data, "2026-09-30", NOW).map((o) => [o.note, o.date])).toEqual([
      ["Loyer", "2026-09-03"],
      ["Épargne", "2026-09-05"],
    ]);
  });

  it("une occurrence déplacée dans un mois qui a déjà la sienne reste une opération rattachée", () => {
    const file = legacyExport();
    // Loyer de juillet déplacé en août par l'ancienne application : août en a alors deux.
    file.months["2026-08"]!.items.push({ id: "o50", d: "2026-08-04", t: "out", amt: 850, cat: "d8", acc: "a1", note: "Loyer", rec: "rc1" });
    file.months["2026-08"]!.items.push({ id: "o51", d: "2026-08-03", t: "out", amt: 850, cat: "d8", acc: "a1", note: "Loyer", rec: "rc1" });
    const { data } = importLegacy(file);
    const august = data.collections.operations.filter((o) => o.recurrenceId === rec("rc1") && o.date.startsWith("2026-08"));
    expect(august.map((o) => o.id)).toEqual([occurrenceId(rec("rc1"), "2026-08"), legacyId("operation", "o51")]);
  });

  it("objectifs à postes, dettes soldées, prélèvement, couleurs et réglages", () => {
    const { data } = importLegacy(legacyExport());
    const [voyage, apport] = data.collections.goals;
    expect(voyage).toMatchObject({ targetMode: "steps", pinned: true, due: null, position: 0 });
    expect(data.collections.goalSteps.map((s) => [s.label, s.amount, s.done, s.position, s.goalId])).toEqual([
      ["Billets", 90000, true, 0, voyage!.id],
      ["Hôtel", 65050, false, 1, voyage!.id],
    ]);
    expect(goalTarget(data, voyage!)).toBe(155050);
    // Ancien objectif : champs récents à leur valeur par défaut (§7).
    expect(apport).toMatchObject({
      target: 2500050,
      targetMode: "manual",
      source: "account",
      hidden: true,
      pinned: false,
      done: false,
      doneAt: null,
      archived: false,
      accountIds: [acc("a2"), acc("a3")],
    });

    const [loan, advance, rescue] = data.collections.debts;
    expect(loan).toMatchObject({
      principal: 432600,
      paidManual: 36050,
      installmentAmount: 18025,
      categoryId: legacyCategoryId("d16"),
      recurrenceId: rec("rc2"),
      settledAt: null,
    });
    expect(advance).toMatchObject({ direction: "lent", mode: "free", categoryId: null, accountId: null, pinned: true });
    // Décision 35 : catégorie de dépense sur une dette « on me doit », non reprise.
    expect(rescue).toMatchObject({ direction: "lent", categoryId: null, settled: true, settledAt: "2026-08-20", archived: true });

    const p = data.preferences;
    expect(p.splits).toEqual({ besoin: 5000, envie: 3000, invest: 2000 });
    expect(p.safety).toEqual({ mode: "months", months: 3, amount: 0, hidden: false, pinned: false });
    expect(p.categoryColors).toEqual({ [legacyCategoryId("r1")]: "#336699" });
    expect(p.bucketColors).toEqual({ envie: "#aa5500" });
    // Le thème n'existait pas : il ne remplace rien.
    expect(p.updatedAt.theme).toBe(0);
    expect(p.updatedAt.categoryColors).toBe(LEGACY_STAMP);
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

  it("vérification croisée : les calculs de l'ancienne application, au centime, et le moindre écart", () => {
    const file = legacyExport();
    const { data } = importLegacy(file);
    const legacy = readLegacyExport(file);
    expect(crossCheckLegacy(legacy, data).issues).toEqual([]);
    // Un retrait du livret vers le courant baisse la mise de côté d'août.
    expect(monthAggregates(data, "2026-08")).toMatchObject({ saved: 30000 + 15000 - 8000 });
    // Voyage : dépense en placement + deux transferts vers le livret.
    expect(goalProgress(data, data.collections.goals[0]!, "9999-12-31")).toBe(45000);

    const o2 = op(data, "o2");
    const tampered = applyChanges(data, { operations: [{ ...o2, amount: o2.amount + 1 }] });
    expect(crossCheckLegacy(legacy, tampered).issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/les besoins de 2026-07 vaut/),
        expect.stringMatching(/le solde du compte « Compte courant »/),
      ]),
    );
    const step = data.collections.goalSteps[1]!;
    const steps = applyChanges(data, { goalSteps: [{ ...step, amount: step.amount - 50 }] });
    expect(crossCheckLegacy(legacy, steps).issues).toEqual([expect.stringMatching(/la cible de l'objectif « Voyage »/)]);
  });

  it("décision 37 : un transfert entre deux comptes d'épargne rattaché à un objectif fait refuser la reprise", () => {
    const issues = issuesOf((f) =>
      july(f).push({ id: "o99", d: "2026-07-28", t: "tx", amt: 40, from: "a2", to: "a3", note: "", goal: "g8f2kqz0v1ta" }),
    );
    expect(issues).toEqual([expect.stringMatching(/transfert entre deux comptes d'épargne rattaché à l'objectif « Voyage »/)]);
    // Sans rattachement, le même transfert passe.
    expect(issuesOf((f) => july(f).push({ id: "o99", d: "2026-07-28", t: "tx", amt: 40, from: "a2", to: "a3", note: "" }))).toBe("accepté");
  });

  it("décision 36 : les liens vers un élément supprimé sont écartés et comptés, sans rien changer aux totaux", () => {
    const file = legacyExport();
    july(file)[2]!.goal = "objectif-supprime";
    july(file)[3]!.debt = "dette-supprimee";
    july(file)[4]!.rec = "recurrence-supprimee";
    file.months["2026-07"]!.skips.push("recurrence-supprimee");
    file.settings.recurring[0]!.debt = "dette-supprimee";
    file.settings.debts[1]!.recurrenceId = "recurrence-supprimee";
    file.settings.catColors["categorie-supprimee"] = "#123456";
    const { data, deadLinks } = importLegacy(file);
    expect(deadLinks).toBe(7);
    expect(op(data, "o3").goalId).toBeUndefined();
    expect(op(data, "o4").debtId).toBeUndefined();
    expect(op(data, "o5").recurrenceId).toBeUndefined();
    expect(data.collections.skips).toHaveLength(1);
    expect(data.collections.debts[1]!.recurrenceId).toBeNull();
  });

  it("refuse tout le fichier au moindre champ ou cas inconnu, en disant où", () => {
    const cases: [string, (f: LegacyFixture) => void, RegExp][] = [
      ["champ en trop à la racine", (f) => Object.assign(f, { exportedAt: 1 }), /^fichier\.exportedAt : champ inconnu/],
      ["version inconnue", (f) => (f.settings.v = 3), /version 3/],
      ["champ inconnu sur une opération", (f) => (july(f)[0]!.tag = "x"), /items\[0\]\.tag : champ inconnu/],
      ["champ manquant", (f) => delete july(f)[0]!.note, /items\[0\]\.note : champ manquant/],
      ["compte d'une dépense sur un transfert", (f) => (july(f)[7]!.acc = "a1"), /items\[7\]\.acc : champ inconnu/],
      ["type inconnu", (f) => (july(f)[0]!.t = "xx"), /items\[0\]\.t : valeur inconnue "xx"/],
      ["trois décimales", (f) => (july(f)[2]!.amt = 12.345), /plus de deux décimales/],
      ["montant négatif", (f) => (july(f)[2]!.amt = -5), /strictement positif/],
      ["opération rangée dans un autre mois", (f) => (july(f)[1]!.d = "2026-08-03"), /rangé dans le mois 2026-07/],
      ["catégorie introuvable", (f) => (july(f)[1]!.cat = "d99"), /catégorie "d99" introuvable/],
      ["catégorie d'un autre type", (f) => (july(f)[0]!.cat = "d8"), /d'un autre type/],
      ["compte introuvable", (f) => (july(f)[0]!.acc = "a9"), /compte "a9" introuvable/],
      ["transfert vers le même compte", (f) => (july(f)[7]!.to = "a1"), /transfert d'un compte vers lui-même/],
      ["identifiants en double", (f) => (july(f)[1]!.id = "o1"), /"o1" en double/],
      ["répartition différente de 100 %", (f) => (f.settings.splits.invest = 0.3), /ne fait pas 100 %/],
      ["bloc inconnu du tableau de bord", (f) => f.settings.dashOrder.push("news"), /dashOrder\[6\] : valeur inconnue/],
      ["rôle de compte inconnu", (f) => (f.settings.accounts[0]!.role = "joint"), /accounts\[0\]\.role : valeur inconnue/],
      ["champ inconnu sur une récurrence", (f) => (f.settings.recurring[0]!.color = 2), /recurring\[0\]\.color : champ inconnu/],
      ["mois de récurrence invalide", (f) => (f.settings.recurring[0]!.start = "juillet"), /recurring\[0\]\.start : mois AAAA-MM attendu/],
      ["couleur mal écrite", (f) => (f.settings.catColors.r1 = "bleu"), /catColors\.r1 : couleur #rrggbb attendue/],
      ["usage de couleur inconnu", (f) => (f.settings.bucketColors.loisirs = "#123456"), /bucketColors\.loisirs : champ inconnu/],
      ["mois annulé mal écrit", (f) => f.months["2026-08"]!.skips.push({ rec: "rc1" }), /skips\[1\] : identifiant non vide attendu/],
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
    expect(after.collections.operations).toHaveLength(17);

    // Depuis, dans Cashmyr : une opération modifiée, une supprimée, un réglage changé.
    const edited = applyChanges(
      { ...after, preferences: setPreference(after.preferences, "averageWindow", 12, NOW) },
      { operations: [touch(op(after, "o3"), { amount: 7000 }, NOW), tombstone(op(after, "o12"), NOW)] },
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
