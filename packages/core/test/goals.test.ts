import { describe, expect, it } from "vitest";
import {
  dashboardGoals,
  goalDeadline,
  goalProgress,
  goalsByState,
  goalTarget,
  goalView,
  monthsLeft,
  stepSummary,
  tombstone,
} from "../src";
import { eur, expense, goal, income, step, TODAY, transfer, world } from "./fixtures";

const { cats, accs, build } = world();

describe("avancement d'un objectif", () => {
  it("mode compte : somme des soldes des comptes listés", () => {
    const g = goal("Apport", { source: "account", accountIds: [accs.livret.id, accs.pea.id] });
    const data = build({
      goals: [g],
      operations: [
        transfer("2026-09-01", eur(1000), accs.courant.id, accs.livret.id),
        transfer("2026-09-02", eur(500), accs.courant.id, accs.pea.id),
        transfer("2026-09-03", eur(200), accs.livret.id, accs.courant.id),
      ],
    });
    expect(goalProgress(data, g, TODAY)).toBe(eur(1300));
  });

  it("mode opérations rattachées : versements, retrait, puis dépense finale qui vide l'objectif", () => {
    const g = goal("Voyage Laos", { target: eur(2000) });
    const tagged = { goalId: g.id };
    const saving = [
      transfer("2026-05-01", eur(1000), accs.courant.id, accs.livret.id, tagged),
      transfer("2026-06-01", eur(1000), accs.courant.id, accs.livret.id, tagged),
      transfer("2026-07-01", eur(200), accs.livret.id, accs.courant.id, tagged),
      income("2026-07-15", eur(150), cats.freelance.id, accs.courant.id, tagged),
      expense("2026-07-20", eur(50), cats.pea.id, accs.courant.id, tagged),
      transfer("2026-07-21", eur(999), accs.courant.id, accs.livret.id),
    ];
    const ticket = expense("2026-09-10", eur(1800), cats.voyage.id, accs.courant.id, tagged);
    const data = build({ goals: [g], operations: [...saving, ticket] });

    expect(goalProgress(data, g, "2026-08-31")).toBe(eur(1000 + 1000 - 200 + 150 + 50));
    expect(goalProgress(data, g, TODAY)).toBe(eur(2000 - 1800));
  });

  it("un transfert entre deux comptes courants rattaché ne compte pas", () => {
    const g = goal("Neutre");
    const other = { ...accs.courant, id: "acc-courant-2" };
    const data = build({ goals: [g], operations: [transfer("2026-09-01", eur(100), accs.courant.id, other.id, { goalId: g.id })] });
    expect(goalProgress({ ...data, collections: { ...data.collections, accounts: [...data.collections.accounts, other] } }, g, TODAY)).toBe(0);
  });
});

describe("cible et postes", () => {
  it("cible = somme des postes en mode « steps », postes supprimés exclus", () => {
    const g = goal("Voyage", { targetMode: "steps", target: eur(99_999) });
    const steps = [
      step(g.id, "Billet", eur(1500), true, 1),
      step(g.id, "Hôtel", eur(800), false, 2),
      tombstone(step(g.id, "Annulé", eur(200), false, 3), 9),
    ];
    const data = build({ goals: [g], goalSteps: steps });
    expect(goalTarget(data, g)).toBe(eur(2300));
    expect(goalTarget(data, { ...g, targetMode: "manual" })).toBe(eur(99_999));
  });

  it("« 2 postes sur 4 réglés · 1 500 € sur 2 500 € »", () => {
    const g = goal("Voyage", { targetMode: "steps" });
    const data = build({
      goals: [g],
      goalSteps: [
        step(g.id, "Billet", eur(1000), true, 1),
        step(g.id, "Visa", eur(500), true, 2),
        step(g.id, "Hôtel", eur(600), false, 3),
        step(g.id, "Sur place", eur(400), false, 4),
      ],
    });
    expect(stepSummary(data, g.id)).toEqual({
      settledCount: 2,
      totalCount: 4,
      settledAmount: eur(1500),
      totalAmount: eur(2500),
    });
  });
});

describe("échéance", () => {
  it("compte les mois entamés : du 23/09/2026 au 05/04/2027 → 7", () => {
    expect(monthsLeft(TODAY, "2027-04-05")).toBe(7);
  });

  it("mensualité nécessaire = (cible − avancement) ÷ mois restants", () => {
    const g = goal("Voyage", { due: "2027-04-05" });
    const d = goalDeadline(g, eur(2000), eur(600), TODAY);
    expect(d).toMatchObject({
      status: "upcoming",
      remaining: eur(1400),
      monthsLeft: 7,
      monthlyNeeded: eur(200),
      timeLeft: { months: 6, days: 13 },
    });
  });

  it("à moins d'un mois, tout le reste est dû", () => {
    const g = goal("Proche", { due: "2026-10-01" });
    expect(goalDeadline(g, eur(1000), eur(250), TODAY)).toMatchObject({ monthsLeft: 1, monthlyNeeded: eur(750) });
    expect(monthsLeft(TODAY, TODAY)).toBe(1);
    expect(monthsLeft(TODAY, "2026-10-23")).toBe(1);
    expect(monthsLeft(TODAY, "2026-10-24")).toBe(2);
  });

  it("échéance dépassée et non atteinte : en retard, plus de mensualité", () => {
    const g = goal("Raté", { due: "2026-09-01" });
    expect(goalDeadline(g, eur(1000), eur(400), TODAY)).toMatchObject({
      status: "overdue",
      remaining: eur(600),
      monthsLeft: null,
      monthlyNeeded: null,
    });
  });

  it("rien n'est dû si l'objectif est marqué atteint ou si la cible est couverte", () => {
    expect(goalDeadline(goal("A", { due: "2026-09-01", done: true }), eur(1000), 0, TODAY)?.status).toBe("met");
    expect(goalDeadline(goal("B", { due: "2027-01-01" }), eur(1000), eur(1200), TODAY)).toMatchObject({
      status: "met",
      remaining: 0,
      monthlyNeeded: null,
    });
  });

  it("sans échéance, pas de bloc échéance", () => {
    expect(goalDeadline(goal("Libre"), eur(1000), 0, TODAY)).toBeNull();
  });

  it("propose « marquer atteint » sans le décider", () => {
    const g = goal("Couvert", { target: eur(100), source: "account", accountIds: [accs.livret.id] });
    const data = build({ goals: [g], operations: [transfer("2026-09-01", eur(150), accs.courant.id, accs.livret.id)] });
    const view = goalView(data, g, TODAY, TODAY);
    expect(view.suggestDone).toBe(true);
    expect(view.goal.done).toBe(false);
  });
});

describe("filtrage du tableau de bord", () => {
  const normal = goal("Normal", { position: 1 });
  const hidden = goal("Masqué", { hidden: true, position: 2 });
  const archived = goal("Archivé", { archived: true, position: 3 });
  const done = goal("Atteint", { done: true, doneAt: "2026-09-01", position: 4 });
  const donePinned = goal("Atteint épinglé", { done: true, pinned: true, position: 6 });
  const pinned = goal("Épinglé", { pinned: true, position: 5 });
  const deleted = tombstone(goal("Supprimé", { position: 0 }), 9);
  const data = build({ goals: [normal, hidden, archived, done, donePinned, pinned, deleted] });

  it("ni archivé, ni masqué, et non atteint ou épinglé ; les épinglés en tête", () => {
    expect(dashboardGoals(data).map((g) => g.name)).toEqual(["Épinglé", "Atteint épinglé", "Normal"]);
  });

  it("l'onglet Objectifs montre tout, rangé par état", () => {
    const s = goalsByState(data);
    expect(s.active.map((g) => g.name)).toEqual(["Épinglé", "Normal", "Masqué"]);
    expect(s.done.map((g) => g.name)).toEqual(["Atteint épinglé", "Atteint"]);
    expect(s.archived.map((g) => g.name)).toEqual(["Archivé"]);
  });
});
