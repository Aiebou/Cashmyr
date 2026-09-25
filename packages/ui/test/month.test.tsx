import { createRecord, type Operation } from "@cashmyr/core";
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { defaultCategories } from "../src/lib/data";
import { accounts, renderApp } from "./helpers";

afterEach(cleanup);

const cats = defaultCategories();
const cat = (name: string) => cats.find((c) => c.name === name)!.id;
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
