import { createRecord, legacyCategoryId, type Operation, type Recurrence } from "@cashmyr/core";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { accounts, NOW, renderApp } from "./helpers";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const plain = (text: string | null | undefined) => (text ?? "").replace(/[\u00a0\u202f]/g, " ");
const RESTO = legacyCategoryId("d18");
const COURSES = legacyCategoryId("d12");
const { courant } = accounts;
const out = (id: string, date: string, amount: number, categoryId: string) =>
  createRecord<Operation>(id, { date, amount, type: "out", note: "", categoryId, accountId: courant.id }, 5);

/** « Restaurants et bars » retirée, comme au format 3 : 45,50 € en mai, 30 € en septembre, une récurrence. */
async function withRetired() {
  const app = await renderApp();
  const { repository } = app;
  const resto = repository.data.collections.categories.find((c) => c.id === RESTO)!;
  await act(() =>
    repository.apply({
      operations: [out("op-mai", "2026-05-04", 4_550, RESTO), out("op-sept", "2026-09-10", 3_000, RESTO), out("op-courses", "2026-09-11", 8_000, COURSES)],
      recurrences: [
        createRecord<Recurrence>(
          "rec-resto",
          { label: "Cantine", type: "out", amount: 1_200, dayOfMonth: 25, startMonth: "2026-10", endMonth: null, active: true, categoryId: RESTO, accountId: courant.id },
          5,
        ),
      ],
    }),
  );
  await act(() => repository.apply({ categories: [{ ...resto, deletedAt: NOW, updatedAt: NOW }] }));
  return app;
}

describe("à reclasser (décision 89, points 17a et 17c)", () => {
  it("Opérations : le bandeau compte tous les mois, filtre le mois et mène au plus ancien", async () => {
    const user = userEvent.setup();
    const { store } = await withRetired();
    act(() => store.getState().actions.setTab("operations"));
    const banner = screen.getByText(/à reclasser/).closest("div")!;
    expect(plain(banner.textContent)).toContain("2 opérations à reclasser, dont 1 en septembre 2026 · la plus ancienne en mai 2026");

    await user.click(within(banner).getByRole("button", { name: "Afficher celles du mois" }));
    expect((screen.getByLabelText("Catégorie") as HTMLSelectElement).value).toBe("a-reclasser");
    expect(plain(screen.getByText(/1 opération sur 2/).textContent)).toContain("1 opération sur 2");
    expect(screen.getByText("Restaurants et bars (ancienne catégorie)")).toBeTruthy();

    await user.click(within(screen.getByText(/à reclasser/).closest("div")!).getByRole("button", { name: "Aller au plus ancien" }));
    expect(store.getState().month).toBe("2026-05");
    expect(plain(screen.getByText(/1 opération sur 1/).textContent)).toContain("1 opération sur 1");
  });

  it("la fiche garde l'ancienne catégorie, choisie, avec l'aide « À reclasser »", async () => {
    const { store } = await withRetired();
    act(() => store.getState().actions.openModal({ kind: "operation", type: "out", editId: "op-sept" }));
    const d = await screen.findByRole("dialog");
    const select = within(d).getByLabelText("Catégorie") as HTMLSelectElement;
    expect(select.value).toBe(RESTO);
    expect(select.selectedOptions[0]!.textContent).toBe("Restaurants et bars (ancienne catégorie)");
    expect(within(d).getByText("À reclasser : choisis une catégorie actuelle.")).toBeTruthy();
  });

  it("Paramètres : la récurrence porte le badge ; « Reclasser » fait tout passer d'un coup", async () => {
    const user = userEvent.setup();
    const { repository, store } = await withRetired();
    act(() => store.getState().actions.setTab("settings"));
    const rec = screen.getByText("Cantine").closest("li")!;
    expect(within(rec).getByText("À reclasser")).toBeTruthy();

    const card = screen.getByRole("heading", { name: "Anciennes catégories", level: 3 }).closest("section")!;
    expect(plain(within(card).getByRole("listitem").textContent)).toContain("Restaurants et bars (ancienne catégorie) · 2 opérations et 1 récurrence · 75,50 €");
    await user.click(within(card).getByRole("button", { name: "Reclasser « Restaurants et bars »" }));
    const d = await screen.findByRole("dialog", { name: "Reclasser « Restaurants et bars »" });
    await user.selectOptions(within(d).getByLabelText("Catégorie"), "Courses");
    expect(plain(within(d).getByRole("status").textContent)).toBe("Les mois passés changent : 75,50 € passent de Loisirs à Dépenses courantes.");
    await user.click(within(d).getByRole("button", { name: "Reclasser" }));

    const c = repository.data.collections;
    expect(c.operations.filter((o) => o.categoryId === COURSES)).toHaveLength(3);
    expect(c.recurrences[0]!.categoryId).toBe(COURSES);
    expect(screen.queryByRole("heading", { name: "Anciennes catégories", level: 3 })).toBeNull();
    expect(within(screen.getByText("Cantine").closest("li")!).queryByText("À reclasser")).toBeNull();
  });
});
