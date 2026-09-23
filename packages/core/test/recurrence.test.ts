import { describe, expect, it } from "vitest";
import {
  applyChanges,
  cancelOccurrence,
  deleteOperation,
  materializeRecurrences,
  mergeDatasets,
  occurrenceId,
  pauseRecurrence,
  plannedOccurrences,
  restoreOccurrence,
  resumeRecurrence,
  skippedInMonth,
  tombstone,
  touch,
  type Dataset,
} from "../src";
import { eur, NOW, recurrence, TODAY, world } from "./fixtures";

const { cats, accs, build } = world();

const rent = recurrence({
  label: "Loyer",
  type: "out",
  amount: eur(800),
  dayOfMonth: 28,
  startMonth: "2026-06",
  categoryId: cats.loyer.id,
  accountId: accs.courant.id,
});

/** Matérialise et applique, comme au lancement. */
function launch(data: Dataset, today = TODAY, now = NOW): Dataset {
  return applyChanges(data, { operations: materializeRecurrences(data, today, now) });
}

const liveDates = (data: Dataset) =>
  data.collections.operations
    .filter((o) => o.deletedAt === null)
    .map((o) => o.date)
    .sort();

describe("génération des occurrences", () => {
  it("de startMonth au mois en cours, seulement une fois le jour venu", () => {
    const data = launch(build({ recurrences: [rent] }));
    // Le 23/09, le loyer du 28 n'existe pas encore.
    expect(liveDates(data)).toEqual(["2026-06-28", "2026-07-28", "2026-08-28"]);
    expect(data.collections.operations[0]).toMatchObject({
      id: occurrenceId(rent.id, "2026-06"),
      type: "out",
      amount: eur(800),
      note: "Loyer",
      categoryId: cats.loyer.id,
      accountId: accs.courant.id,
      recurrenceId: rent.id,
    });
    expect(liveDates(launch(data, "2026-09-28"))).toContain("2026-09-28");
  });

  it("strictement idempotente : dix lancements ne changent rien", () => {
    let data = launch(build({ recurrences: [rent] }));
    const snapshot = JSON.stringify(data);
    for (let i = 0; i < 10; i++) {
      expect(materializeRecurrences(data, TODAY, NOW + i)).toEqual([]);
      data = launch(data, TODAY, NOW + i);
    }
    expect(JSON.stringify(data)).toBe(snapshot);
  });

  it("une récurrence au 31 tombe le 28 en février 2026", () => {
    const r = recurrence({ type: "in", amount: eur(100), dayOfMonth: 31, startMonth: "2026-01", categoryId: cats.salaire.id, accountId: accs.courant.id });
    expect(liveDates(launch(build({ recurrences: [r] }), "2026-03-15"))).toEqual(["2026-01-31", "2026-02-28"]);
  });

  it("bornée par endMonth, jamais pour un mois futur", () => {
    expect(liveDates(launch(build({ recurrences: [{ ...rent, endMonth: "2026-07" }] })))).toEqual(["2026-06-28", "2026-07-28"]);
    expect(liveDates(launch(build({ recurrences: [{ ...rent, startMonth: "2026-11" }] })))).toEqual([]);
  });

  it("en pause : rien n'est généré", () => {
    expect(liveDates(launch(build({ recurrences: [{ ...rent, active: false }] })))).toEqual([]);
  });

  it("génère aussi les transferts", () => {
    const r = recurrence({ type: "tx", amount: eur(200), dayOfMonth: 2, startMonth: "2026-09", fromAccountId: accs.courant.id, toAccountId: accs.livret.id });
    const [op] = materializeRecurrences(build({ recurrences: [r] }), TODAY, NOW);
    expect(op).toMatchObject({ type: "tx", fromAccountId: accs.courant.id, toAccountId: accs.livret.id, date: "2026-09-02" });
    expect(op).not.toHaveProperty("categoryId");
  });

  it("modifier une récurrence ne touche pas aux occurrences déjà créées", () => {
    const before = launch(build({ recurrences: [rent] }));
    const edited = applyChanges(before, { recurrences: [touch(rent, { amount: eur(850) }, NOW + 1)] });
    const after = launch(edited, "2026-09-28", NOW + 2);
    const amounts = after.collections.operations.map((o) => [o.date, o.amount]).sort();
    expect(amounts).toEqual([
      ["2026-06-28", eur(800)],
      ["2026-07-28", eur(800)],
      ["2026-08-28", eur(800)],
      ["2026-09-28", eur(850)],
    ]);
  });

  it("supprimer une récurrence conserve l'historique généré", () => {
    const before = launch(build({ recurrences: [rent] }));
    const after = launch(applyChanges(before, { recurrences: [tombstone(rent, NOW + 1)] }), "2026-12-31");
    expect(liveDates(after)).toEqual(["2026-06-28", "2026-07-28", "2026-08-28"]);
  });
});

describe("annulation et rétablissement", () => {
  const generated = launch(build({ recurrences: [rent] }));

  it("annuler supprime l'opération et crée un Skip ; la génération la respecte", () => {
    const cancelled = applyChanges(generated, cancelOccurrence(generated, rent.id, "2026-07", NOW + 1));
    expect(liveDates(cancelled)).toEqual(["2026-06-28", "2026-08-28"]);
    expect(materializeRecurrences(cancelled, TODAY, NOW + 2)).toEqual([]);
    expect(skippedInMonth(cancelled, "2026-07").map((s) => s.recurrence?.id)).toEqual([rent.id]);
  });

  it("rétablir supprime le Skip et régénère avec les valeurs actuelles de la récurrence", () => {
    let data = applyChanges(generated, cancelOccurrence(generated, rent.id, "2026-07", NOW + 1));
    data = applyChanges(data, { recurrences: [touch(rent, { amount: eur(900) }, NOW + 2)] });
    data = applyChanges(data, restoreOccurrence(data, rent.id, "2026-07", TODAY, NOW + 3));
    const july = data.collections.operations.find((o) => o.id === occurrenceId(rent.id, "2026-07"));
    expect(july).toMatchObject({ deletedAt: null, amount: eur(900) });
    expect(skippedInMonth(data, "2026-07")).toEqual([]);
    expect(materializeRecurrences(data, TODAY, NOW + 4)).toEqual([]);
    // Annuler puis rétablir encore : toujours idempotent.
    data = applyChanges(data, cancelOccurrence(data, rent.id, "2026-07", NOW + 5));
    data = applyChanges(data, restoreOccurrence(data, rent.id, "2026-07", TODAY, NOW + 6));
    expect(liveDates(data)).toEqual(["2026-06-28", "2026-07-28", "2026-08-28"]);
    expect(data.collections.skips.every((s) => s.deletedAt !== null)).toBe(true);
  });

  it("supprimer à la main une opération générée l'annule, sinon elle reviendrait", () => {
    const id = occurrenceId(rent.id, "2026-08");
    const data = applyChanges(generated, deleteOperation(generated, id, NOW + 1));
    expect(skippedInMonth(data, "2026-08")).toHaveLength(1);
    expect(liveDates(launch(data, TODAY, NOW + 2))).toEqual(["2026-06-28", "2026-07-28"]);
  });

  it("retrouve le mois d'origine même si la date a été déplacée", () => {
    const id = occurrenceId(rent.id, "2026-08");
    const op = generated.collections.operations.find((o) => o.id === id)!;
    const moved = applyChanges(generated, { operations: [touch(op, { date: "2026-09-02" }, NOW + 1)] });
    expect(materializeRecurrences(moved, TODAY, NOW + 2)).toEqual([]);
    const data = applyChanges(moved, deleteOperation(moved, id, NOW + 3));
    expect(skippedInMonth(data, "2026-08")).toHaveLength(1);
    expect(skippedInMonth(data, "2026-09")).toHaveLength(0);
  });

  it("annuler d'avance une occurrence pas encore venue", () => {
    const data = applyChanges(generated, cancelOccurrence(generated, rent.id, "2026-09", NOW + 1));
    expect(liveDates(launch(data, "2026-09-30"))).not.toContain("2026-09-28");
  });
});

describe("prévisions", () => {
  const generated = launch(build({ recurrences: [rent] }));

  it("la suite du mois en cours et les mois futurs, en lecture seule", () => {
    expect(plannedOccurrences(generated, "2026-09", TODAY).map((p) => p.date)).toEqual(["2026-09-28"]);
    expect(plannedOccurrences(generated, "2027-01", TODAY).map((p) => p.date)).toEqual(["2027-01-28"]);
    expect(plannedOccurrences(generated, "2026-08", TODAY)).toEqual([]);
    expect(plannedOccurrences(build({ recurrences: [{ ...rent, endMonth: "2026-12" }] }), "2027-01", TODAY)).toEqual([]);
  });
});

describe("deux appareils hors ligne", () => {
  it("génèrent la même occurrence avec le même identifiant : aucun doublon après fusion", () => {
    const shared = build({ recurrences: [rent] });
    const phone = launch(shared, TODAY, NOW);
    const laptop = launch(shared, TODAY, NOW + 3_600_000);
    const { data } = mergeDatasets(phone, laptop);
    expect(liveDates(data)).toEqual(["2026-06-28", "2026-07-28", "2026-08-28"]);
    expect(data.collections.operations).toHaveLength(3);
  });

  it("une annulation l'emporte sur une génération faite plus tard par l'autre appareil", () => {
    const shared = build({ recurrences: [rent] });
    const generated = launch(shared, TODAY, NOW);
    const phone = applyChanges(generated, cancelOccurrence(generated, rent.id, "2026-07", NOW + 10));
    // L'ordinateur, hors ligne, ne génère qu'une heure après l'annulation.
    const laptop = launch(shared, TODAY, NOW + 3_600_000);
    for (const [a, b] of [[phone, laptop], [laptop, phone]] as const) {
      const { data } = mergeDatasets(a, b);
      expect(liveDates(data)).toEqual(["2026-06-28", "2026-08-28"]);
      expect(materializeRecurrences(data, TODAY, NOW + 3_600_001)).toEqual([]);
    }
  });

  it("une modification faite sur une occurrence l'emporte sur sa génération par l'autre appareil", () => {
    const shared = build({ recurrences: [rent] });
    const phone = launch(shared, TODAY, NOW);
    const id = occurrenceId(rent.id, "2026-08");
    const op = phone.collections.operations.find((o) => o.id === id)!;
    const edited = applyChanges(phone, { operations: [touch(op, { amount: eur(812) }, NOW + 10)] });
    const laptop = launch(shared, TODAY, NOW + 3_600_000);
    expect(mergeDatasets(laptop, edited).data.collections.operations.find((o) => o.id === id)?.amount).toBe(eur(812));
  });
});

describe("pause et reprise", () => {
  it("les mois de pause ne sont pas rattrapés : ils sont marqués ignorés, rétablissables un par un", () => {
    let data = launch(build({ recurrences: [rent] }), "2026-06-30");
    data = applyChanges(data, pauseRecurrence(data, rent.id, NOW));
    expect(materializeRecurrences(data, TODAY, NOW)).toEqual([]);

    data = applyChanges(data, resumeRecurrence(data, rent.id, TODAY, NOW + 1));
    expect(data.collections.recurrences[0]?.active).toBe(true);
    expect(skippedInMonth(data, "2026-07")).toHaveLength(1);
    expect(skippedInMonth(data, "2026-08")).toHaveLength(1);
    // Le loyer du 28 septembre n'est pas encore passé : il viendra le jour venu.
    expect(skippedInMonth(data, "2026-09")).toHaveLength(0);
    expect(materializeRecurrences(data, TODAY, NOW + 2)).toEqual([]);
    expect(liveDates(launch(data, "2026-09-28", NOW + 3))).toEqual(["2026-06-28", "2026-09-28"]);

    data = applyChanges(data, restoreOccurrence(data, rent.id, "2026-07", TODAY, NOW + 4));
    expect(liveDates(data)).toEqual(["2026-06-28", "2026-07-28"]);
  });

  it("reprendre une récurrence déjà active ne change rien", () => {
    const data = build({ recurrences: [rent] });
    expect(resumeRecurrence(data, rent.id, TODAY, NOW)).toEqual({});
  });
});
