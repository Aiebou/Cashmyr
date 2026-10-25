import { applyChanges, createRecord, debtView, emptyDataset, type Debt, type Operation } from "@cashmyr/core";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { niceTicks } from "../src/components/charts/scale";
import { dropBefore, moveAmongVisible } from "../src/components/Reorderable";
import { defaultCategories } from "../src/lib/data";
import { debtSentence } from "../src/lib/debt-text";
import { accounts, bannerSection, renderApp, TODAY } from "./helpers";

afterEach(cleanup);

const cats = defaultCategories();
const cat = (name: string) => cats.find((c) => c.name === name)!.id;
const op = (id: string, date: string, amount: number, type: Operation["type"], extra: Partial<Operation>): Operation =>
  createRecord<Operation>(id, { date, amount, type, note: "", ...extra } as Omit<Operation, "id" | "updatedAt" | "deletedAt">, 1);

const loan = (extra: Partial<Debt> = {}): Debt =>
  createRecord<Debt>(
    "debt-1",
    {
      name: "Prêt auto",
      creditor: "Banque",
      direction: "owe",
      principal: 0,
      paidManual: 0,
      mode: "installments",
      installmentAmount: 30_000,
      installmentCount: 5,
      startDate: "2026-07-10",
      dayOfMonth: 10,
      categoryId: cat("Crédit"),
      accountId: accounts.courant.id,
      recurrenceId: null,
      hidden: false,
      pinned: false,
      settled: false,
      settledAt: null,
      archived: false,
      position: 1,
      color: 3,
      ...extra,
    },
    1,
  );

const blocks = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

/** Le titre du bandeau ouvre la liste des totaux (décision 62). */
async function chooseTotal(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole("button", { name: /Changer le total affiché$/ }));
  await user.click(screen.getByRole("menuitemradio", { name: new RegExp(`^${title.replace(/[()]/g, "\\$&")} `) }));
}

describe("bandeau du tableau de bord", () => {
  it("par défaut, courants et valeurs déclarées ; un compte sans valeur déclarée compte pour son capital injecté, signalé", async () => {
    await renderApp();
    const banner = bannerSection("Total de mes comptes (valeurs déclarées) aujourd'hui");
    expect(within(banner).getByText(/^4\s250,00\s€$/)).toBeTruthy();
    expect(banner.textContent).toMatch(/Dont 1\s250,00\s€ disponibles au quotidien et 3\s000,00\s€ d'épargne et de placements\./);
    expect(banner.textContent).toMatch(/Valeur injectée \(hors comptes courants\) : 3\s000,00\s€\./);
    expect(banner.textContent).toMatch(/Un compte sans valeur déclarée compte pour son capital injecté\./);
    const legend = within(banner).getAllByRole("listitem").map((li) => li.textContent);
    expect(legend).toEqual([expect.stringMatching(/^Compte courant1\s250,00\s€$/), expect.stringMatching(/^Livret A3\s000,00\s€valeur non déclarée$/)]);
    expect(banner.textContent).not.toMatch(/Dettes restantes/);
  });

  it("valeur déclarée en avant, capital injecté dessous ; patrimoine net en valeurs déclarées (décisions 42 et 44)", async () => {
    const { repository } = await renderApp();
    await act(() =>
      repository.apply({
        accounts: [{ ...accounts.livret, declaredValue: 310_000, declaredAt: TODAY, updatedAt: 2 }],
        debts: [loan()],
        operations: [op("op-1", "2026-07-10", 30_000, "out", { categoryId: cat("Crédit"), accountId: accounts.courant.id, debtId: "debt-1" })],
      }),
    );
    const banner = bannerSection("Total de mes comptes (valeurs déclarées) aujourd'hui");
    // 1 250 − 300 sur le courant, 3 100 déclarés sur le livret.
    expect(within(banner).getByText(/^4\s050,00\s€$/)).toBeTruthy();
    const legend = within(banner).getAllByRole("listitem").map((li) => li.textContent);
    expect(legend[1]).toMatch(/^Livret A3\s100,00\s€injecté 3\s000,00\s€$/);
    expect(banner.textContent).toMatch(/Valeur injectée \(hors comptes courants\) : 3\s000,00\s€\./);
    expect(banner.textContent).not.toMatch(/sans valeur déclarée/);
    // 1 200 € restent dus.
    expect(banner.textContent).toMatch(/Dettes restantes : 1\s200,00\s€\. Patrimoine net : 2\s850,00\s€\./);
  });

  it("le total se choisit, propre à l'appareil : rien ne part en synchronisation", async () => {
    const user = userEvent.setup();
    const { repository, local } = await renderApp();
    await act(() => repository.apply({ accounts: [{ ...accounts.livret, declaredValue: 310_000, declaredAt: TODAY, updatedAt: 2 }] }));
    const pending = repository.pending;
    await chooseTotal(user, "Total de mes comptes en capital injecté");
    let banner = bannerSection("Total de mes comptes en capital injecté aujourd'hui");
    expect(within(banner).getByText(/^4\s250,00\s€$/)).toBeTruthy();
    expect(banner.textContent).not.toMatch(/injecté 3\s000/);
    await chooseTotal(user, "Capital injecté hors comptes courants");
    banner = bannerSection("Capital injecté hors comptes courants aujourd'hui");
    // Le gros chiffre, puis la légende du seul compte retenu.
    expect(within(banner).getAllByText(/^3\s000,00\s€$/).map((el) => el.tagName)).toEqual(["P", "SPAN"]);
    expect(within(banner).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringMatching(/^Livret A/)]);
    expect(banner.textContent).not.toMatch(/Valeur injectée/);
    expect(local.device?.display).toEqual({ bannerTotal: "injectedOutsideCurrent" });
    expect(repository.pending).toBe(pending);
  });

  it("n'affiche que les comptes au solde positif dans la barre et la légende", async () => {
    const { repository } = await renderApp();
    await act(() => repository.apply({ accounts: [{ ...accounts.courant, opening: -5_000, updatedAt: 2 }] }));
    const banner = bannerSection("Total de mes comptes (valeurs déclarées) aujourd'hui");
    const legend = within(banner).getAllByRole("listitem").map((li) => li.textContent);
    expect(legend).toEqual([expect.stringContaining("Livret A")]);
  });
});

describe("blocs réordonnables", () => {
  it("sans dette, le bloc Dettes n'apparaît pas ; les flèches déplacent et l'ordre est enregistré", async () => {
    const user = userEvent.setup();
    const { repository } = await renderApp();
    // Les cibles du mois restent en tête, hors des blocs réordonnables.
    expect(blocks()).toEqual(["Cibles de septembre 2026", "Objectifs", "Indicateurs de l'année", "Douze mois", "Progression de l'épargne", "Postes de dépense"]);
    expect(screen.getByRole("button", { name: "Monter « Objectifs »" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Descendre « Objectifs »" }));
    expect(blocks().slice(1, 3)).toEqual(["Indicateurs de l'année", "Objectifs"]);
    // Le bloc Dettes, masqué, garde sa place dans l'ordre enregistré.
    expect(repository.data.preferences.dashOrder).toEqual(["stats", "debts", "goals", "months", "savings", "cats"]);
  });

  it("déplacer parmi les blocs visibles saute les blocs masqués", () => {
    const order = ["goals", "debts", "stats", "months"];
    expect(moveAmongVisible(order, ["goals", "stats", "months"], "goals", 1)).toEqual(["stats", "debts", "goals", "months"]);
    expect(moveAmongVisible(order, ["goals", "stats", "months"], "goals", -1)).toEqual(order);
    expect(dropBefore(order, "months", "goals", false)).toEqual(["months", "goals", "debts", "stats"]);
    expect(dropBefore(order, "goals", "stats", true)).toEqual(["debts", "stats", "goals", "months"]);
  });
});

describe("cibles du mois en cours", () => {
  it("ce qui reste avant chaque cible, dépassement des besoins en rouge ; seulement pour l'année en cours", async () => {
    const { repository, store } = await renderApp();
    await act(() =>
      repository.apply({
        operations: [
          op("in-1", "2026-09-01", 200_000, "in", { categoryId: cat("Salaire"), accountId: accounts.courant.id }),
          op("out-1", "2026-09-02", 110_000, "out", { categoryId: cat("Loyer et charges"), accountId: accounts.courant.id }),
          op("out-2", "2026-09-03", 20_000, "out", { categoryId: cat("Restaurants et bars"), accountId: accounts.courant.id }),
        ],
      }),
    );
    const card = screen.getByRole("heading", { name: "Cibles de septembre 2026" }).closest("section")!;
    expect(within(card).getByText(/cible 1\s000,00\s€ · dépassée de 100,00\s€/).querySelector("svg")).not.toBeNull();
    expect(within(card).getByText(/cible 600,00\s€ · reste 400,00\s€/)).toBeTruthy();
    expect(within(card).getByText(/cible 400,00\s€ · encore 400,00\s€ à mettre de côté/)).toBeTruthy();
    act(() => store.getState().actions.setYear(2025));
    expect(screen.queryByRole("heading", { name: /^Cibles/ })).toBeNull();
  });
});

describe("indicateurs de l'année", () => {
  it("taux d'endettement : remboursements des mois écoulés ÷ leurs revenus (décision 70)", async () => {
    const { repository } = await renderApp();
    const salary = (id: string, date: string) => op(id, date, 200_000, "in", { categoryId: cat("Salaire"), accountId: accounts.courant.id });
    const repay = (id: string, date: string) =>
      op(id, date, 35_000, "out", { categoryId: cat("Crédit"), accountId: accounts.courant.id, debtId: "debt-1" });
    await act(() =>
      repository.apply({
        debts: [loan()],
        operations: [
          salary("in-7", "2026-07-05"),
          salary("in-8", "2026-08-05"),
          repay("out-7", "2026-07-10"),
          repay("out-8", "2026-08-10"),
          // Septembre est le mois en cours : il n'entre pas.
          repay("out-9", "2026-09-10"),
        ],
      }),
    );
    const stats = screen.getByRole("heading", { name: "Indicateurs de l'année" }).closest("section")!;
    const tile = within(stats).getByText("Taux d'endettement (DTI)").parentElement!;
    // 700 € ÷ 4 000 € = 17,5 %.
    expect(tile.textContent?.replace(/[\u00a0\u202f]/g, " ")).toBe("Taux d'endettement (DTI)17,5 %Remboursements de dettes ÷ revenus, sur 2 mois écoulés de 2026");
  });
});

describe("graphiques et textes", () => {
  it("graduations propres, zéro compris", () => {
    expect(niceTicks(0, 3_120_00)).toEqual([0, 100_000, 200_000, 300_000, 400_000]);
    expect(niceTicks(-50_000, 90_000)).toEqual([-50_000, 0, 50_000, 100_000]);
    expect(niceTicks(0, 0)).toEqual([0]);
  });

  it("phrase de dette : « reste 1 échéance de 75 € · prochaine le 10 novembre 2026 · soldée en novembre 2026. »", () => {
    // 1 500 € en 5 × 300 € de juillet à novembre, 1 425 € réglés.
    const d = loan({ paidManual: 142_500 });
    const data = applyChanges(emptyDataset(), { debts: [d] });
    const text = debtSentence(debtView(data, d, TODAY, TODAY), TODAY).replace(/ | /g, " ");
    expect(text).toBe("reste 1 échéance de 75,00 € · prochaine le 10 novembre 2026 · soldée en novembre 2026.");
  });

  it("phrase de dette : échéance en retard, dernière réduite", () => {
    const d = loan({ paidManual: 22_500 });
    const data = applyChanges(emptyDataset(), { debts: [d] });
    const text = debtSentence(debtView(data, d, TODAY, TODAY), TODAY).replace(/ | /g, " ");
    expect(text).toBe(
      "reste 5 échéances, 4 de 300,00 € puis 75,00 € · en retard depuis le 10 juillet 2026 · soldée en novembre 2026.",
    );
  });
});
