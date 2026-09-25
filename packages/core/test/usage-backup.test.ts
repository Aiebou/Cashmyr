import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  accountUsage,
  applyChanges,
  BackupError,
  deleteAccount,
  deleteCategory,
  importBackup,
  mergeDatasets,
  monthAggregates,
  newSyncDocument,
  parseBackup,
  restoreEverywhere,
  serializeBackup,
  serializeSyncDocument,
  setPreference,
  tombstone,
  touch,
  UsageError,
  validateDataset,
  type Category,
} from "../src";
import { category, debt, eur, expense, goal, income, NOW, recurrence, transfer, world } from "./fixtures";

describe("suppression d'un compte (décision 30)", () => {
  const { cats, accs, build } = world();

  it("refusée tant qu'une opération, une récurrence, une dette ou un objectif l'utilise", () => {
    const cases = [
      build({ operations: [transfer("2026-09-01", eur(10), accs.courant.id, accs.especes.id)] }),
      build({ recurrences: [recurrence({ type: "out", amount: eur(5), dayOfMonth: 1, startMonth: "2026-09", categoryId: cats.courses.id, accountId: accs.especes.id })] }),
      build({ debts: [debt({ accountId: accs.especes.id })] }),
      build({ goals: [goal("Voyage", { source: "account", accountIds: [accs.especes.id] })] }),
    ];
    for (const data of cases) expect(() => deleteAccount(data, accs.especes.id, NOW)).toThrow(UsageError);
    expect(accountUsage(cases[0]!, accs.especes.id)).toEqual({ operations: 1, recurrences: 0, debts: 0, goals: 0 });
  });

  it("possible une fois les opérations supprimées ; seules les lignes vivantes comptent", () => {
    const op = transfer("2026-09-01", eur(10), accs.courant.id, accs.especes.id);
    const data = build({ operations: [tombstone(op, NOW)] });
    const changes = deleteAccount(data, accs.especes.id, NOW + 1);
    expect(changes.accounts?.[0]).toMatchObject({ id: accs.especes.id, deletedAt: NOW + 1 });
  });
});

describe("suppression d'une catégorie (décision 31)", () => {
  const { cats, accs, build } = world();
  const shop = expense("2026-09-05", eur(80), cats.courses.id, accs.courant.id);
  const rec = recurrence({ type: "out", amount: eur(30), dayOfMonth: 3, startMonth: "2026-10", categoryId: cats.courses.id, accountId: accs.courant.id });
  const loan = debt({ categoryId: cats.courses.id, accountId: accs.courant.id });
  const data = build({ operations: [shop], recurrences: [rec], debts: [loan] });

  it("inutilisée : supprimée directement", () => {
    expect(deleteCategory(data, cats.voyage.id, NOW)).toEqual({ categories: [expect.objectContaining({ id: cats.voyage.id, deletedAt: NOW })] });
  });

  it("utilisée : refusée sans remplaçante, ou avec une remplaçante d'autre nature", () => {
    expect(() => deleteCategory(data, cats.courses.id, NOW)).toThrow(UsageError);
    expect(() => deleteCategory(data, cats.courses.id, NOW, cats.salaire.id)).toThrow(/même nature/);
    expect(() => deleteCategory(data, cats.courses.id, NOW, cats.courses.id)).toThrow(UsageError);
  });

  it("réaffecte opérations, récurrences et dettes vers une catégorie existante ; l'usage suit la remplaçante", () => {
    const changes = deleteCategory(data, cats.courses.id, NOW, cats.resto.id);
    const after = applyChanges(data, changes);
    expect(validateDataset(after)).toEqual([]);
    expect(after.collections.operations[0]?.categoryId).toBe(cats.resto.id);
    expect(after.collections.recurrences[0]?.categoryId).toBe(cats.resto.id);
    expect(after.collections.debts[0]?.categoryId).toBe(cats.resto.id);
    // Besoins → Envies : le mois passé change, comme l'écran l'annonce.
    expect(monthAggregates(data, "2026-09")).toMatchObject({ needs: eur(80), wants: 0 });
    expect(monthAggregates(after, "2026-09")).toMatchObject({ needs: 0, wants: eur(80) });
  });

  it("ou vers une catégorie créée pour l'occasion, écrite dans le même lot", () => {
    const fresh: Category = { ...category("Alimentation", "out", "besoin"), updatedAt: NOW };
    const changes = deleteCategory(data, cats.courses.id, NOW, fresh);
    expect(changes.categories?.map((c) => c.id)).toEqual([cats.courses.id, fresh.id]);
    const after = applyChanges(data, changes);
    expect(validateDataset(after)).toEqual([]);
    expect(after.collections.operations[0]?.categoryId).toBe(fresh.id);
    expect(monthAggregates(after, "2026-09").needs).toBe(eur(80));
  });
});

describe("export et import JSON (décision 32)", () => {
  const { cats, accs, build } = world();
  const base = build({ operations: [income("2026-09-01", eur(2400), cats.salaire.id, accs.courant.id)] });

  it("l'export se relit à l'identique", () => {
    expect(parseBackup(serializeBackup(base))).toEqual(base);
  });

  it("un fichier de synchronisation se lit aussi", () => {
    const doc = { ...newSyncDocument("file-1"), collections: base.collections, preferences: base.preferences };
    expect(parseBackup(serializeSyncDocument(doc)).collections).toEqual(base.collections);
  });

  it("refuse bruyamment : JSON illisible, ancienne application, version plus récente, contenu invalide, autre chose", () => {
    const code = (text: string) => {
      try {
        parseBackup(text);
      } catch (e) {
        return e instanceof BackupError ? e.code : "autre";
      }
      return "accepté";
    };
    expect(code("{ tronqué")).toBe("unreadable");
    expect(code(JSON.stringify({ settings: {}, months: {} }))).toBe("legacy");
    expect(code(JSON.stringify({ ...base, schemaVersion: SCHEMA_VERSION + 1 }))).toBe("newer-schema");
    const broken = { ...base, collections: { ...base.collections, operations: [{ ...base.collections.operations[0], amount: 12.5 }] } };
    expect(code(JSON.stringify(broken))).toBe("invalid");
    expect(code(JSON.stringify([1, 2]))).toBe("unknown");
  });

  it("fusionne : la version la plus récente gagne, ligne à ligne, préférences comprises", () => {
    const op = base.collections.operations[0]!;
    const edited = touch(op, { amount: eur(2500) }, NOW);
    const newer = { ...base, collections: { ...base.collections, operations: [edited] } };
    // Un import plus ancien ne change rien.
    expect(importBackup(newer, base).rows).toBe(0);
    // Un import plus récent apporte sa version, et ce qui manque.
    const extra = expense("2026-09-05", eur(50), cats.courses.id, accs.courant.id);
    const incoming = {
      ...newer,
      collections: { ...newer.collections, operations: [touch(edited, { note: "Paie" }, NOW + 5), extra] },
      preferences: setPreference(newer.preferences, "averageWindow", 12, NOW),
    };
    const result = importBackup(base, incoming);
    expect(result.rows).toBe(2);
    expect(result.preferencesChanged).toEqual(["averageWindow"]);
    const after = applyChanges({ ...base, preferences: result.preferences }, result.changes);
    expect(after).toEqual(mergeDatasets(base, incoming).data);
  });
});

describe("restauration d'une copie (décision 33)", () => {
  const { cats, accs, build } = world();
  const kept = expense("2026-09-05", eur(80), cats.courses.id, accs.courant.id);
  const doomed = expense("2026-09-06", eur(20), cats.courses.id, accs.courant.id);
  const snapshot = build({ operations: [kept, doomed] });

  // Depuis la copie : une opération modifiée, une supprimée, une ajoutée, une préférence changée.
  const later = applyChanges(
    { ...snapshot, preferences: setPreference(snapshot.preferences, "averageWindow", 3, NOW - 10) },
    {
      operations: [
        touch(kept, { amount: eur(95) }, NOW - 10),
        tombstone(doomed, NOW - 10),
        expense("2026-09-10", eur(12), cats.resto.id, accs.courant.id, { updatedAt: NOW - 10 }),
      ],
    },
  );

  it("la copie l'emporte : modifiée rétablie, supprimée ressuscitée, ajoutée supprimée", () => {
    const r = restoreEverywhere(later, snapshot, NOW);
    expect({ restored: r.restored, removed: r.removed, prefs: r.preferencesChanged }).toEqual({ restored: 2, removed: 1, prefs: ["averageWindow"] });
    const after = applyChanges({ ...later, preferences: r.preferences }, r.changes);
    expect(validateDataset(after)).toEqual([]);
    const live = after.collections.operations.filter((o) => o.deletedAt === null);
    expect(live.map((o) => [o.id, o.amount]).sort()).toEqual([
      [doomed.id, eur(20)],
      [kept.id, eur(80)],
    ].sort());
    expect(after.preferences.averageWindow).toBe(snapshot.preferences.averageWindow);
  });

  it("et gagne aussi à la fusion contre un autre appareil resté sur l'état d'avant", () => {
    const r = restoreEverywhere(later, snapshot, NOW);
    const restored = applyChanges({ ...later, preferences: r.preferences }, r.changes);
    const merged = mergeDatasets(later, restored).data;
    expect(merged.collections.operations.filter((o) => o.deletedAt === null).map((o) => o.amount).sort()).toEqual([eur(20), eur(80)].sort());
    expect(merged.preferences.averageWindow).toBe(snapshot.preferences.averageWindow);
  });
});
