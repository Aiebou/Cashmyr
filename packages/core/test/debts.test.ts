import { describe, expect, it } from "vitest";
import {
  applyChanges,
  completeSchedule,
  createDebtRecurrence,
  dashboardDebts,
  DebtActionError,
  debtPaid,
  debtRecurrenceId,
  debtSchedule,
  debtsByState,
  debtsOverview,
  debtTotal,
  debtView,
  materializeRecurrences,
  monthAggregates,
  monthlyDebtLoad,
  netWorth,
  newSyncDocument,
  plannedOccurrences,
  recordDebtPayment,
  removeDebtRecurrence,
  deleteDebt,
  syncWithDocument,
  tombstone,
  totalOwed,
  validateDataset,
  type Dataset,
  type Debt,
  type Operation,
} from "../src";
import { category, dataset, DAY, debt, eur, expense, income, NOW, recurrence, TODAY, transfer, world } from "./fixtures";

const { cats, accs } = world();
const credit = category("Crédit", "out", "besoin");
const repaid = category("Remboursements reçus", "in");
const courant = { ...accs.courant, opening: eur(5000) };

const loan = (extra: Partial<Debt> = {}) =>
  debt({ categoryId: credit.id, accountId: courant.id, ...extra });

function build(parts: { debts?: Debt[]; operations?: Operation[]; recurrences?: Dataset["collections"]["recurrences"] } = {}) {
  return dataset({
    categories: [...Object.values(cats), credit, repaid],
    accounts: [courant, accs.livret, accs.pea],
    debts: parts.debts ?? [],
    operations: parts.operations ?? [],
    recurrences: parts.recurrences ?? [],
  });
}

const pay = (d: Debt, date: string, amount: number) =>
  expense(date, eur(amount), credit.id, courant.id, { debtId: d.id });

/** Lancement de l'application : génération des occurrences, appliquée. */
const launch = (data: Dataset, today: string, now = NOW) =>
  applyChanges(data, { operations: materializeRecurrences(data, today, now) });

describe("montant total", () => {
  it("déduit du nombre et du montant des échéances lorsque le principal n'est pas saisi", () => {
    expect(debtTotal(loan())).toBe(eur(1000));
    expect(debtTotal(loan({ principal: eur(950) }))).toBe(eur(950));
    expect(debtTotal(loan({ mode: "free", installmentAmount: 0, installmentCount: 0 }))).toBe(0);
    expect(debtTotal(loan({ mode: "free", principal: eur(300) }))).toBe(eur(300));
  });
});

describe("montant réglé", () => {
  it("« je dois » : paidManual + dépenses et transferts − revenus rattachés", () => {
    const d = loan({ paidManual: eur(100) });
    const data = build({
      debts: [d],
      operations: [
        pay(d, "2026-09-01", 200),
        transfer("2026-09-02", eur(50), courant.id, accs.livret.id, { debtId: d.id }),
        income("2026-09-03", eur(30), cats.salaire.id, courant.id, { debtId: d.id }),
        expense("2026-09-04", eur(999), credit.id, courant.id),
        pay(d, "2026-09-30", 400),
      ],
    });
    expect(debtPaid(data, d, TODAY)).toBe(eur(100 + 200 + 50 - 30));
    // Un versement daté plus tard ne compte qu'à sa date.
    expect(debtPaid(data, d, "2026-09-30")).toBe(eur(720));
  });

  it("« on me doit » : paidManual + revenus − tout le reste", () => {
    const d = loan({ direction: "lent", categoryId: repaid.id, paidManual: eur(100) });
    const data = build({
      debts: [d],
      operations: [
        income("2026-09-01", eur(200), repaid.id, courant.id, { debtId: d.id }),
        expense("2026-09-02", eur(50), cats.resto.id, courant.id, { debtId: d.id }),
        transfer("2026-09-03", eur(20), courant.id, accs.livret.id, { debtId: d.id }),
      ],
    });
    expect(debtPaid(data, d, TODAY)).toBe(eur(100 + 200 - 50 - 20));
  });
});

describe("versement ponctuel", () => {
  // 1 000 € en 5 × 200 € (juillet → novembre), 600 € réglés.
  const d = loan({ startDate: "2026-07-10" });
  const before = build({ debts: [d], operations: [pay(d, "2026-07-10", 200), pay(d, "2026-08-10", 200), pay(d, "2026-09-10", 200)] });

  it("dans le budget : crée une vraie dépense, et laisse une dernière échéance réduite de 50 €", () => {
    const changes = recordDebtPayment(before, d.id, { amount: eur(350), date: TODAY, inBudget: true }, NOW, "op-versement");
    expect(changes.operations).toEqual([
      expect.objectContaining({
        id: "op-versement",
        type: "out",
        amount: eur(350),
        date: TODAY,
        note: "Versement — Prêt auto",
        categoryId: credit.id,
        accountId: courant.id,
        debtId: d.id,
      }),
    ]);
    const after = applyChanges(before, changes);
    const view = debtView(after, d, TODAY, TODAY);
    expect(view).toMatchObject({ paid: eur(950), remaining: eur(50), installmentsLeft: 1, lastAmount: eur(50), covered: 4 });
    expect(view.next).toMatchObject({ date: "2026-11-10", amount: eur(50), status: "upcoming" });
    expect(view.payoffDate).toBe("2026-11-10");
    // L'argent a quitté le compte : le budget du mois le reflète.
    expect(monthAggregates(after, "2026-09").needs).toBe(eur(200 + 350));
  });

  it("hors budget : incrémente paidManual sans créer d'opération", () => {
    const changes = recordDebtPayment(before, d.id, { amount: eur(350), date: TODAY, inBudget: false }, NOW);
    expect(changes.operations).toBeUndefined();
    expect(changes.debts).toEqual([expect.objectContaining({ id: d.id, paidManual: eur(350) })]);
    const after = applyChanges(before, changes);
    expect(debtView(after, after.collections.debts[0]!, TODAY, TODAY).remaining).toBe(eur(50));
    expect(monthAggregates(after, "2026-09").needs).toBe(eur(200));
  });

  it("« on me doit » : un remboursement reçu est un revenu", () => {
    const lent = loan({ direction: "lent", categoryId: repaid.id });
    const changes = recordDebtPayment(build({ debts: [lent] }), lent.id, { amount: eur(80), date: TODAY, inBudget: true }, NOW);
    expect(changes.operations?.[0]).toMatchObject({ type: "in", categoryId: repaid.id });
  });

  it("dette sans compte : il faut en choisir un, et la dette le retient", () => {
    const bare = debt({ categoryId: credit.id });
    const data = build({ debts: [bare] });
    expect(() => recordDebtPayment(data, bare.id, { amount: eur(10), date: TODAY, inBudget: true }, NOW)).toThrow(DebtActionError);
    const changes = recordDebtPayment(data, bare.id, { amount: eur(10), date: TODAY, inBudget: true, accountId: courant.id }, NOW);
    expect(changes.operations?.[0]).toMatchObject({ accountId: courant.id, categoryId: credit.id });
    expect(changes.debts).toEqual([expect.objectContaining({ accountId: courant.id, categoryId: credit.id })]);
  });

  it("un choix explicite vaut pour ce versement sans changer la dette", () => {
    const changes = recordDebtPayment(before, d.id, { amount: eur(10), date: TODAY, inBudget: true, categoryId: cats.courses.id }, NOW);
    expect(changes.operations?.[0]?.categoryId).toBe(cats.courses.id);
    expect(changes.debts).toBeUndefined();
  });
});

describe("échéancier", () => {
  it("une dette au 31 tombe le 28 en février 2026", () => {
    expect(debtSchedule(loan({ startDate: "2026-01-31", dayOfMonth: 31, installmentCount: 4 }))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("le jour choisi l'emporte sur celui de la première date", () => {
    expect(debtSchedule(loan({ startDate: "2026-10-01", dayOfMonth: 15, installmentCount: 2 }))).toEqual(["2026-10-15", "2026-11-15"]);
  });

  it("pas d'échéancier en mode libre", () => {
    const view = debtView(build(), loan({ mode: "free", principal: eur(500) }), TODAY, TODAY);
    expect(view).toMatchObject({ schedule: [], next: null, payoffDate: null, installmentsLeft: null, remaining: eur(500) });
  });
});

describe("prochaine échéance", () => {
  it("en retard si sa date est passée", () => {
    const d = loan({ startDate: "2026-09-10" });
    expect(debtView(build({ debts: [d] }), d, TODAY, TODAY).next).toMatchObject({
      date: "2026-09-10",
      status: "overdue",
      daysUntil: -13,
    });
  });

  it("« dans N jours » à moins de sept jours, y compris aujourd'hui", () => {
    const at = (startDate: string) => debtView(build(), loan({ startDate, dayOfMonth: Number(startDate.slice(8)) }), TODAY, TODAY).next;
    expect(at("2026-09-28")).toMatchObject({ status: "soon", daysUntil: 5 });
    expect(at(TODAY)).toMatchObject({ status: "soon", daysUntil: 0 });
    expect(at("2026-09-30")).toMatchObject({ status: "upcoming", daysUntil: 7 });
  });

  it("avance avec les paiements, même hors échéancier", () => {
    const d = loan({ startDate: "2026-09-10" });
    const data = build({ debts: [d], operations: [pay(d, "2026-09-10", 200), pay(d, "2026-09-15", 200)] });
    expect(debtView(data, d, TODAY, TODAY).next).toMatchObject({ date: "2026-11-10", index: 2 });
  });

  it("reste supérieur à l'échéancier : première date, dernière date, excédent signalé", () => {
    const d = loan();
    // Nouvel emprunt de 300 € sur la même dette : un revenu rattaché retranche du réglé.
    const data = build({ debts: [d], operations: [income("2026-09-20", eur(300), cats.salaire.id, courant.id, { debtId: d.id })] });
    const view = debtView(data, d, TODAY, TODAY);
    expect(view).toMatchObject({ remaining: eur(1300), installmentsLeft: 7, uncovered: eur(300), payoffDate: "2027-02-10" });
    expect(view.next).toMatchObject({ index: 0, date: "2026-10-10" });
  });
});

describe("charge mensuelle, total dû, patrimoine net", () => {
  const active = loan({ name: "Actif" });
  const settled = loan({ name: "Soldé", settled: true, settledAt: "2026-09-01" });
  const archived = loan({ name: "Archivé", archived: true });
  const lent = loan({ name: "Prêté", direction: "lent", categoryId: repaid.id });
  const free = loan({ name: "Libre", mode: "free", principal: eur(900), installmentAmount: eur(300) });
  const paidOff = loan({ name: "Remboursé", paidManual: eur(1000) });
  const data = build({ debts: [active, settled, archived, lent, free, paidOff] });

  it("charge mensuelle : sans les dettes soldées, archivées, prêtées, libres ou déjà remboursées", () => {
    expect(monthlyDebtLoad(data, TODAY)).toBe(eur(200));
  });

  it("total dû : restes des dettes « je dois » ni archivées ni soldées", () => {
    expect(totalOwed(data, TODAY)).toBe(eur(1000 + 900));
  });

  it("patrimoine net = total des comptes − total dû", () => {
    expect(netWorth(data, TODAY, TODAY)).toBe(eur(5000 - 1900));
  });

  it("bandeau : reste par dette et charge rapportée au revenu moyen", () => {
    const withIncome = applyChanges(data, {
      operations: ["2026-06-28", "2026-07-28", "2026-08-28"].map((d) => income(d, eur(2000), cats.salaire.id, courant.id)),
    });
    const o = debtsOverview({ ...withIncome, preferences: { ...withIncome.preferences, averageWindow: 3 } }, TODAY, TODAY);
    expect(o.byDebt.map((b) => [b.debt.name, b.remaining])).toEqual([
      ["Actif", eur(1000)],
      ["Libre", eur(900)],
    ]);
    expect(o).toMatchObject({ totalOwed: eur(1900), monthlyLoad: eur(200), averageIncome: eur(2000) });
    expect(o.loadRatio).toBeCloseTo(0.1, 10);
  });
});

describe("tableau de bord", () => {
  const normal = loan({ name: "Normale", position: 1 });
  const hidden = loan({ name: "Masquée", hidden: true, position: 2 });
  const archived = loan({ name: "Archivée", archived: true, position: 3 });
  const settled = loan({ name: "Soldée", settled: true, position: 4 });
  const settledPinned = loan({ name: "Soldée épinglée", settled: true, pinned: true, position: 6 });
  const pinned = loan({ name: "Épinglée", pinned: true, position: 5 });
  const deleted = tombstone(loan({ name: "Supprimée" }), 9);
  const data = build({ debts: [normal, hidden, archived, settled, settledPinned, pinned, deleted] });

  it("ni archivée, ni masquée, et non soldée ou épinglée ; les épinglées en tête", () => {
    expect(dashboardDebts(data).map((d) => d.name)).toEqual(["Épinglée", "Soldée épinglée", "Normale"]);
  });

  it("l'onglet Dettes range par état", () => {
    const s = debtsByState(data);
    expect(s.active.map((d) => d.name)).toEqual(["Épinglée", "Normale", "Masquée"]);
    expect(s.settled.map((d) => d.name)).toEqual(["Soldée épinglée", "Soldée"]);
    expect(s.archived.map((d) => d.name)).toEqual(["Archivée"]);
  });

  it("propose « marquer soldée » quand il ne reste rien", () => {
    const d = loan({ paidManual: eur(1000) });
    expect(debtView(build({ debts: [d] }), d, TODAY, TODAY).suggestSettled).toBe(true);
  });
});

describe("prélèvement automatique", () => {
  // 5 × 200 € de juillet à novembre ; juillet et août réglés.
  const d = loan({ startDate: "2026-07-10" });
  const base = build({ debts: [d], operations: [pay(d, "2026-07-10", 200), pay(d, "2026-08-10", 200)] });

  it("début au mois de la prochaine échéance, fin au mois de la dernière, debtId propagé", () => {
    const changes = createDebtRecurrence(base, d.id, TODAY, NOW);
    const [rec] = changes.recurrences!;
    expect(rec).toMatchObject({
      id: debtRecurrenceId(d.id),
      startMonth: "2026-09",
      endMonth: "2026-11",
      dayOfMonth: 10,
      amount: eur(200),
      type: "out",
      categoryId: credit.id,
      accountId: courant.id,
      debtId: d.id,
      active: true,
    });
    expect(changes.debts).toEqual([expect.objectContaining({ recurrenceId: rec!.id })]);

    let data = launch(applyChanges(base, changes), TODAY);
    const generated = data.collections.operations.filter((o) => o.recurrenceId === rec!.id);
    expect(generated.map((o) => [o.date, o.amount, o.debtId])).toEqual([["2026-09-10", eur(200), d.id]]);
    // Les occurrences font baisser le reste dû.
    expect(debtView(data, d, TODAY, TODAY).remaining).toBe(eur(400));
    data = launch(data, "2026-12-31");
    expect(debtView(data, d, "2026-12-31", "2026-12-31")).toMatchObject({ remaining: 0, suggestSettled: true });
    expect(data.collections.operations.filter((o) => o.debtId === d.id)).toHaveLength(5);
  });

  it("« on me doit » : les occurrences sont des revenus", () => {
    const lent = loan({ direction: "lent", categoryId: repaid.id });
    expect(createDebtRecurrence(build({ debts: [lent] }), lent.id, TODAY, NOW).recurrences?.[0]?.type).toBe("in");
  });

  it("refusé sans catégorie ni compte, en mode libre, ou s'il ne reste rien", () => {
    const cases = [debt(), loan({ mode: "free", principal: eur(100) }), loan({ paidManual: eur(1000) })];
    for (const c of cases) expect(() => createDebtRecurrence(build({ debts: [c] }), c.id, TODAY, NOW)).toThrow(DebtActionError);
  });

  it("le retirer ne touche pas aux opérations déjà générées", () => {
    let data = launch(applyChanges(base, createDebtRecurrence(base, d.id, TODAY, NOW)), TODAY);
    data = applyChanges(data, removeDebtRecurrence(data, d.id, NOW + 1));
    expect(data.collections.debts[0]?.recurrenceId).toBeNull();
    expect(data.collections.recurrences[0]?.deletedAt).not.toBeNull();
    expect(data.collections.operations.filter((o) => o.debtId === d.id && o.deletedAt === null)).toHaveLength(3);
    expect(materializeRecurrences(data, "2026-12-31", NOW + 2)).toEqual([]);
  });

  it("supprimer la dette arrête ses prélèvements, y compris une récurrence rattachée à la main", () => {
    const other = recurrence({ id: "rec-loyer", type: "out", amount: eur(700), dayOfMonth: 5, startMonth: "2026-01", categoryId: credit.id, accountId: courant.id });
    const tagged = recurrence({ id: "rec-tagged", type: "out", amount: eur(50), dayOfMonth: 20, startMonth: "2026-09", categoryId: credit.id, accountId: courant.id, debtId: d.id });
    let data = applyChanges(base, { recurrences: [other, tagged] });
    data = launch(applyChanges(data, createDebtRecurrence(data, d.id, TODAY, NOW)), TODAY);
    const generated = data.collections.operations.filter((o) => o.recurrenceId && o.deletedAt === null).map((o) => o.id);

    const changes = deleteDebt(data, d.id, NOW + 1);
    expect(changes.debts?.map((x) => [x.id, x.deletedAt])).toEqual([[d.id, NOW + 1]]);
    expect(changes.recurrences?.map((r) => r.id).sort()).toEqual([debtRecurrenceId(d.id), "rec-tagged"].sort());

    data = applyChanges(data, changes);
    // Les opérations déjà générées restent ; seul le loyer continue.
    expect(data.collections.operations.filter((o) => o.recurrenceId && o.deletedAt === null).map((o) => o.id)).toEqual(generated);
    expect(new Set(materializeRecurrences(data, "2026-12-31", NOW + 2).map((o) => o.recurrenceId))).toEqual(new Set(["rec-loyer"]));
    expect(validateDataset(data)).toEqual([]);
  });

  it("sans prélèvement, seule la dette est supprimée", () => {
    const changes = deleteDebt(base, d.id, NOW + 1);
    expect(changes.recurrences).toBeUndefined();
    expect(() => deleteDebt(applyChanges(base, changes), d.id, NOW + 2)).toThrow(DebtActionError);
  });
});

describe("prélèvement et versement ponctuel : les prélèvements suivent l'échéancier", () => {
  // 1 000 € en 5 × 200 € : 10/10, 10/11, 10/12, 10/01, 10/02.
  const d = loan();
  const start = build({ debts: [d] });
  const withRec = applyChanges(start, createDebtRecurrence(start, d.id, TODAY, NOW));
  const afterOctober = launch(withRec, "2026-10-10");
  const prepaid = applyChanges(
    afterOctober,
    recordDebtPayment(afterOctober, d.id, { amount: eur(350), date: "2026-10-20", inBudget: true }, NOW, "prepay"),
  );
  const debits = (data: Dataset) =>
    data.collections.operations
      .filter((o) => o.recurrenceId && o.deletedAt === null)
      .map((o) => [o.date, o.amount])
      .sort();

  it("rien le 10/11, 200 € le 10/12, 200 € le 10/01, 50 € le 10/02 : 1 000 € tout juste", () => {
    const end = launch(prepaid, "2027-02-28");
    expect(debits(end)).toEqual([
      ["2026-10-10", eur(200)],
      ["2026-12-10", eur(200)],
      ["2027-01-10", eur(200)],
      ["2027-02-10", eur(50)],
    ]);
    expect(debtView(end, d, "2027-02-28", "2027-02-28")).toMatchObject({ paid: eur(1000), remaining: 0 });
  });

  it("même résultat en lançant l'application chaque mois qu'en rattrapant d'un coup", () => {
    let data = prepaid;
    for (const day of ["2026-11-10", "2026-12-10", "2027-01-10", "2027-02-10"]) data = launch(data, day);
    expect(debits(data)).toEqual(debits(launch(prepaid, "2027-02-28")));
  });

  it("la fiche et les prélèvements prévus disent la même chose", () => {
    const view = debtView(prepaid, d, "2026-10-21", "2026-10-21");
    expect(view.next).toMatchObject({ date: "2026-12-10", amount: eur(200) });
    const planned = (month: string) => plannedOccurrences(prepaid, month, "2026-10-21").map((p) => [p.date, p.amount]);
    expect(planned("2026-11")).toEqual([]);
    expect(planned("2026-12")).toEqual([["2026-12-10", eur(200)]]);
    expect(planned("2027-02")).toEqual([["2027-02-10", eur(50)]]);
  });

  it("rien n'est prélevé sur une dette marquée soldée", () => {
    const settled = applyChanges(prepaid, { debts: [{ ...prepaid.collections.debts[0]!, settled: true, updatedAt: NOW + 5 }] });
    expect(materializeRecurrences(settled, "2027-02-28", NOW)).toEqual([]);
  });

  it("en mode libre, chaque prélèvement est plafonné au reste dû", () => {
    const free = loan({ mode: "free", principal: eur(500), installmentAmount: 0, installmentCount: 0 });
    const rec = {
      id: "rec-free",
      updatedAt: 1,
      deletedAt: null,
      label: "Remboursement",
      amount: eur(200),
      type: "out" as const,
      categoryId: credit.id,
      accountId: courant.id,
      debtId: free.id,
      dayOfMonth: 5,
      startMonth: "2026-06",
      endMonth: null,
      active: true,
    };
    const data = launch(build({ debts: [free], recurrences: [rec] }), TODAY);
    expect(debits(data)).toEqual([
      ["2026-06-05", eur(200)],
      ["2026-07-05", eur(200)],
      ["2026-08-05", eur(100)],
    ]);
  });
});

describe("intégrité", () => {
  it("valide les dettes et leurs références", () => {
    const ok = build({ debts: [loan()] });
    expect(validateDataset(ok)).toEqual([]);
    const wrongKind = build({ debts: [loan({ direction: "lent" })] });
    expect(validateDataset(wrongKind).join()).toMatch(/attend une catégorie « in »/);
    const noSchedule = build({ debts: [loan({ installmentAmount: 0 })] });
    expect(validateDataset(noSchedule).join()).toMatch(/un échéancier exige/);
    const tooBig = build({ debts: [loan({ principal: eur(1200) })] });
    expect(validateDataset(tooBig).join()).toMatch(/dépasse ce que couvrent les échéances/);
    const orphan = build({ operations: [expense(TODAY, eur(1), credit.id, courant.id, { debtId: "absente" })] });
    expect(validateDataset(orphan).join()).toMatch(/debtId : référence introuvable/);
  });

  it("une dette supprimée mais encore référencée n'est jamais purgée", () => {
    const d = loan();
    const data = build({ debts: [tombstone(d, NOW)], operations: [pay(d, "2026-09-01", 10)] });
    const r = syncWithDocument({ local: data, remote: newSyncDocument("f"), device: { id: "a", label: "A" }, now: NOW + 100 * DAY });
    expect(r.document.collections.debts.map((x) => x.id)).toEqual([d.id]);
  });
});

describe("calcul automatique de l'échéancier (décision 41)", () => {
  it("montant par échéance : total ÷ nombre, au centime supérieur", () => {
    expect(completeSchedule("installment", { total: 200_000, count: 5 })).toBe(40_000);
    // 1 000 € en 3 : 333,34 €, la dernière échéance réduite à 333,32 € par l'échéancier.
    expect(completeSchedule("installment", { total: 100_000, count: 3 })).toBe(33_334);
  });

  it("nombre d'échéances : total ÷ montant, à l'entier supérieur", () => {
    expect(completeSchedule("count", { total: 123_000, installment: 12_300 })).toBe(10);
    expect(completeSchedule("count", { total: 100_000, installment: 30_000 })).toBe(4);
  });

  it("montant total : montant × nombre", () => {
    expect(completeSchedule("total", { installment: 12_300, count: 10 })).toBe(123_000);
  });

  it("le total ne dépasse jamais ce que couvrent les échéances, et la dernière est réduite", () => {
    const debt = loan({ principal: 100_000, installmentAmount: completeSchedule("installment", { total: 100_000, count: 3 })!, installmentCount: 3 });
    expect(validateDataset(build({ debts: [debt] }))).toEqual([]);
    const view = debtView(build({ debts: [debt] }), debt, TODAY, TODAY);
    expect(view.installmentsLeft).toBe(3);
    expect(view.lastAmount).toBe(33_332);

    const byAmount = loan({ principal: 100_000, installmentAmount: 30_000, installmentCount: completeSchedule("count", { total: 100_000, installment: 30_000 })! });
    expect(debtView(build({ debts: [byAmount] }), byAmount, TODAY, TODAY).lastAmount).toBe(10_000);
  });

  it("rien quand le calcul n'a pas de sens", () => {
    expect(completeSchedule("installment", { total: 100_000, count: null })).toBeNull();
    expect(completeSchedule("installment", { total: 0, count: 3 })).toBeNull();
    expect(completeSchedule("count", { total: 100_000, installment: 0 })).toBeNull();
    // Plus de 1 200 échéances.
    expect(completeSchedule("count", { total: 1_000_000, installment: 1 })).toBeNull();
    expect(completeSchedule("total", { installment: 100, count: 1_201 })).toBeNull();
    expect(completeSchedule("total", { installment: Number.MAX_SAFE_INTEGER, count: 2 })).toBeNull();
  });
});
