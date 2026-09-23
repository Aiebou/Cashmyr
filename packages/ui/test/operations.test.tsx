import { cancelOccurrence, createRecord, type Debt, type Goal, type Operation, type Recurrence } from "@cashmyr/core";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { defaultCategories } from "../src/lib/data";
import { fold, matchesFilters, NO_FILTERS } from "../src/lib/filters";
import { accounts, NOW, renderApp } from "./helpers";

afterEach(cleanup);

const cats = defaultCategories();
const cat = (name: string) => cats.find((c) => c.name === name)!.id;
const plain = (text: string | null | undefined) => (text ?? "").replace(/[  ]/g, " ");
const { courant, livret } = accounts;

const op = (id: string, date: string, amount: number, type: Operation["type"], extra: Partial<Operation>): Operation =>
  createRecord<Operation>(id, { date, amount, type, note: "", ...extra } as Omit<Operation, "id" | "updatedAt" | "deletedAt">, 1);

const trip = createRecord<Goal>(
  "goal-trip",
  {
    name: "Voyage",
    target: 100_000,
    targetMode: "manual",
    source: "tagged",
    accountIds: [],
    due: null,
    hidden: false,
    pinned: false,
    done: false,
    doneAt: null,
    archived: false,
    position: 1,
    color: 2,
  },
  1,
);

const loan = createRecord<Debt>(
  "debt-1",
  {
    name: "Prêt auto",
    creditor: "",
    direction: "owe",
    principal: 100_000,
    paidManual: 0,
    mode: "free",
    installmentAmount: 0,
    installmentCount: 0,
    startDate: "2026-01-10",
    dayOfMonth: 10,
    categoryId: cat("Crédit"),
    accountId: courant.id,
    recurrenceId: null,
    hidden: false,
    pinned: false,
    settled: false,
    settledAt: null,
    archived: false,
    position: 1,
    color: 3,
  },
  1,
);

const gym = createRecord<Recurrence>(
  "rec-gym",
  { label: "Salle de sport", amount: 3_500, type: "out", categoryId: cat("Sorties et loisirs"), accountId: courant.id, dayOfMonth: 3, startMonth: "2026-09", endMonth: null, active: true },
  1,
);

const september = () => [
  op("salary", "2026-09-01", 240_000, "in", { categoryId: cat("Salaire"), accountId: courant.id }),
  op("rent", "2026-09-05", 82_000, "out", { categoryId: cat("Loyer et charges"), accountId: courant.id, note: "Loyer" }),
  op("shop-1", "2026-09-09", 4_250, "out", { categoryId: cat("Courses"), accountId: courant.id, note: "Marché" }),
  op("shop-2", "2026-09-09", 6_100, "out", { categoryId: cat("Courses"), accountId: courant.id }),
  op("save", "2026-09-12", 20_000, "tx", { fromAccountId: courant.id, toAccountId: livret.id, goalId: trip.id }),
  op("loan", "2026-09-10", 30_000, "out", { categoryId: cat("Crédit"), accountId: courant.id, debtId: loan.id, note: "Échéance prêt" }),
  op("august", "2026-08-30", 1_000, "out", { categoryId: cat("Courses"), accountId: courant.id }),
];

async function openOperations(extra: { recurrences?: Recurrence[] } = {}) {
  const app = await renderApp();
  await act(() => app.repository.apply({ goals: [trip], debts: [loan], operations: september(), recurrences: extra.recurrences ?? [] }));
  act(() => app.store.getState().actions.setTab("operations"));
  return app;
}

const headings = () => screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
const labels = () =>
  [...document.querySelectorAll('main section[aria-labelledby^="day-"] li > button')].map((b) => b.querySelector("[class*=label]")!.textContent!.replace("(générée par une récurrence)", "").trim());
const summary = () => plain(screen.getByText(/opérations?( sur \d+)?( ·|$)/).textContent);

describe("liste du mois", () => {
  it("toutes les opérations du mois, par date décroissante, groupées par jour", async () => {
    await openOperations();
    expect(screen.getByRole("heading", { name: "Opérations de septembre 2026" })).toBeTruthy();
    expect(headings()).toEqual(["Samedi 12 septembre", "Jeudi 10 septembre", "Mercredi 9 septembre", "Samedi 5 septembre", "Mardi 1er septembre"]);
    expect(labels()).toEqual(["Compte courant → Livret A", "Échéance prêt", expect.any(String), expect.any(String), "Loyer", "Salaire"]);
    expect(labels()).not.toContain("août");
    expect(summary()).toBe("6 opérations · Dépenses 1 223,50 € · Revenus 2 400,00 € · Transferts 200,00 €");
  });

  it("chaque ligne ouvre l'édition", async () => {
    const user = userEvent.setup();
    await openOperations();
    await user.click(screen.getByRole("button", { name: /Loyer/ }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText("Libellé") as HTMLInputElement).value).toBe("Loyer");
  });

  it("les opérations générées portent un marqueur discret", async () => {
    await openOperations({ recurrences: [gym] });
    const row = screen.getByRole("button", { name: /Salle de sport/ });
    expect(within(row).getByText("(générée par une récurrence)")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /Loyer/ })).queryByText("(générée par une récurrence)")).toBeNull();
  });
});

describe("filtres", () => {
  it("par type, catégorie, compte, objectif et dette ; « Effacer les filtres » remet tout", async () => {
    const user = userEvent.setup();
    await openOperations();
    await user.click(screen.getByRole("radio", { name: "Revenus" }));
    expect(labels()).toEqual(["Salaire"]);
    await user.click(screen.getByRole("radio", { name: "Tout" }));

    await user.selectOptions(screen.getByLabelText("Catégorie"), "Courses");
    expect(labels()).toHaveLength(2);
    expect(summary()).toBe("2 opérations sur 6 · Dépenses 103,50 €");
    // Passer aux revenus retire une catégorie de dépense devenue sans objet.
    await user.click(screen.getByRole("radio", { name: "Revenus" }));
    expect((screen.getByLabelText("Catégorie") as HTMLSelectElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "Effacer les filtres" }));
    expect(labels()).toHaveLength(6);

    // Un transfert compte pour ses deux comptes.
    await user.selectOptions(screen.getByLabelText("Compte"), "Livret A");
    expect(labels()).toEqual(["Compte courant → Livret A"]);
    await user.selectOptions(screen.getByLabelText("Compte"), "Comptes");

    await user.selectOptions(screen.getByLabelText("Objectif"), "Voyage");
    expect(labels()).toEqual(["Compte courant → Livret A"]);
    await user.selectOptions(screen.getByLabelText("Objectif"), "Objectifs");

    await user.selectOptions(screen.getByLabelText("Dette"), "Prêt auto");
    expect(labels()).toEqual(["Échéance prêt"]);
  });

  it("recherche plein texte sur le libellé, sans accents ni casse, chaque mot compte", async () => {
    const user = userEvent.setup();
    await openOperations();
    await user.type(screen.getByRole("searchbox", { name: "Rechercher dans les libellés" }), "ECHEANCE pret");
    expect(labels()).toEqual(["Échéance prêt"]);
    await user.clear(screen.getByRole("searchbox"));
    // Sans libellé saisi, c'est la catégorie affichée qui sert de libellé.
    await user.type(screen.getByRole("searchbox"), "courses");
    expect(labels()).toEqual(["Courses"]);
    await user.type(screen.getByRole("searchbox"), " zzz");
    expect(screen.getByText("Aucune opération ne correspond aux filtres.")).toBeTruthy();
  });

  it("matchesFilters : un filtre vide laisse tout passer", async () => {
    const { repository } = await openOperations();
    const data = repository.data;
    expect(september().every((o) => matchesFilters(data, o, NO_FILTERS))).toBe(true);
    expect(fold("Échéance Prêt")).toBe("echeance pret");
  });
});

describe("récurrences ignorées et mois à venir", () => {
  it("une occurrence annulée apparaît dans la section, et « Rétablir » la régénère", async () => {
    const user = userEvent.setup();
    const { repository } = await openOperations({ recurrences: [gym] });
    await act(() => repository.apply(cancelOccurrence(repository.data, gym.id, "2026-09", NOW + 1)));
    const section = screen.getByRole("heading", { name: "Récurrences ignorées ce mois" }).closest("section")!;
    expect(plain(within(section).getByRole("listitem").textContent)).toContain("Salle de sport−35,00 €");
    expect(labels()).not.toContain("Salle de sport");

    await user.click(within(section).getByRole("button", { name: "Rétablir « Salle de sport »" }));
    await screen.findByText("Occurrence rétablie");
    expect(screen.queryByRole("heading", { name: "Récurrences ignorées ce mois" })).toBeNull();
    expect(labels()).toContain("Salle de sport");
  });

  it("mois à venir : rien n'est créé, ce qui est prévu est listé en lecture seule", async () => {
    const { store } = await openOperations({ recurrences: [gym] });
    act(() => store.getState().actions.setMonth("2026-11"));
    expect(screen.getByText("Mois à venir : rien n'est créé à l'avance.")).toBeTruthy();
    const planned = screen.getByRole("heading", { name: "Prévu ce mois" }).closest("section")!;
    expect(plain(planned.textContent)).toContain("Salle de sport−35,00 €");
    expect(within(planned).queryByRole("button")).toBeNull();
  });
});
