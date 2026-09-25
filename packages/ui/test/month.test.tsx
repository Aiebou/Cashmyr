import { createRecord, type Operation } from "@cashmyr/core";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { defaultCategories } from "../src/lib/data";
import { accounts, renderApp } from "./helpers";

afterEach(cleanup);

const cats = defaultCategories();
const cat = (name: string) => cats.find((c) => c.name === name)!.id;
/** Espaces fines et insécables d'Intl ramenées à des espaces simples. */
const plain = (text: string | null | undefined) => (text ?? "").replace(/[\u202f\u00a0]/g, " ");
const op = (id: string, amount: number, type: "in" | "out", category: string): Operation =>
  createRecord<Operation>(
    id,
    { date: "2026-09-05", amount, type, note: "", categoryId: cat(category), accountId: accounts.courant.id },
    1,
  );

describe("Répartition du mois", () => {
  it("signale en rouge, avec une icône, le dépassement des besoins et des envies, pas celui de l'épargne", async () => {
    const { repository, actions } = await renderApp();
    await act(() =>
      repository.apply({
        operations: [
          op("in-1", 200_000, "in", "Salaire"),
          // Cibles sur 2 000 € : besoins 1 000 €, envies 600 €, épargne 400 €.
          op("out-1", 120_000, "out", "Loyer et charges"),
          op("out-2", 10_000, "out", "Restaurants et bars"),
          op("out-3", 50_000, "out", "PEA et ETF"),
        ],
      }),
    );
    act(() => actions.setTab("month"));
    const card = screen.getByRole("heading", { name: "Répartition" }).closest("section")!;
    const caption = (text: RegExp) => within(card).getByText(text);

    const needs = caption(/cible 1\s000,00\s€ · dépassée de 200,00\s€/);
    expect(needs.querySelector("svg")).not.toBeNull();
    expect(caption(/cible 600,00\s€ · reste 500,00\s€/).querySelector("svg")).toBeNull();
    // L'épargne au-delà de sa cible n'est pas un avertissement.
    expect(caption(/cible 400,00\s€ · dépassée de 100,00\s€/).querySelector("svg")).toBeNull();
  });
});

describe("camemberts du mois", () => {
  /** 2 300 € de revenus ; six postes de dépense pour 1 920 €, épargne comprise. */
  async function openMonth() {
    const app = await renderApp();
    await act(() =>
      app.repository.apply({
        operations: [
          op("in-1", 200_000, "in", "Salaire"),
          op("in-2", 30_000, "in", "Missions freelance"),
          op("out-1", 90_000, "out", "Loyer et charges"),
          op("out-2", 30_000, "out", "Courses"),
          op("out-3", 12_000, "out", "Transport"),
          op("out-4", 20_000, "out", "Restaurants et bars"),
          op("out-5", 15_000, "out", "Vêtements"),
          op("out-6", 25_000, "out", "PEA et ETF"),
        ],
      }),
    );
    act(() => app.actions.setTab("month"));
    return app;
  }
  const card = (title: string) => screen.getByRole("heading", { name: title, level: 3 }).closest("section")!;
  const rows = (title: string) =>
    within(card(title))
      .getAllByRole("listitem")
      .filter((li) => li.parentElement?.parentElement === card(title).querySelector("ul")?.parentElement)
      .map((li) => plain(li.textContent));

  it("dépenses par poste, épargne comprise, rangées par usage ; au-delà de cinq parts, « Autres » détaillé à la demande", async () => {
    const user = userEvent.setup();
    await openMonth();
    // Quatre plus gros postes (besoins, envies, épargne), puis les deux plus petits regroupés.
    expect(rows("Dépenses par poste")).toEqual([
      "Loyer et charges900,00 €47 %",
      "Courses300,00 €16 %",
      "Restaurants et bars200,00 €10 %",
      "PEA et ETF250,00 €13 %",
      "Autres (2 postes)270,00 €14 %Voir le détail",
    ]);
    expect(plain(within(card("Dépenses par poste")).getByRole("img").getAttribute("aria-label"))).toContain(
      "Loyer et charges 900,00 €, 47 %",
    );
    await user.click(within(card("Dépenses par poste")).getByRole("button", { name: "Voir le détail" }));
    expect(plain(within(card("Dépenses par poste")).getByText("Autres (2 postes)").closest("li")!.textContent)).toContain(
      "Vêtements150,00 €Transport120,00 €",
    );
    expect(rows("Revenus par source")).toEqual(["Salaire2 000,00 €87 %", "Missions freelance300,00 €13 %"]);
  });

  it("se masquent pour cet appareil seulement, et reviennent", async () => {
    const user = userEvent.setup();
    const { local, repository } = await openMonth();
    const pending = repository.pending;
    await user.click(screen.getByRole("button", { name: "Masquer" }));
    expect(screen.queryByRole("heading", { name: "Dépenses par poste" })).toBeNull();
    expect(local.device?.display).toEqual({ hideMonthCharts: true });
    expect(repository.pending).toBe(pending);
    await user.click(screen.getByRole("button", { name: "Afficher les graphiques" }));
    expect(screen.getByRole("heading", { name: "Revenus par source" })).toBeTruthy();
  });
});
