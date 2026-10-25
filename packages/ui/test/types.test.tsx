import { defaultTypeId, PRECAUTION_TYPE_ID } from "@cashmyr/core";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { accounts, renderApp } from "./helpers";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const PROJECT = defaultTypeId("projet");
const plain = (text: string | null | undefined) => (text ?? "").replace(/[  ]/g, " ");
const { courant, livret } = accounts;
const account = (repo: Awaited<ReturnType<typeof renderApp>>["repository"], id: string) => repo.data.collections.accounts.find((a) => a.id === id)!;

describe("comptes rattachés aux types (décisions 77 et 78)", () => {
  it("la fiche d'un compte coche ses types et choisit le principal", async () => {
    const user = userEvent.setup();
    const { repository, store } = await renderApp();
    act(() => store.getState().actions.openModal({ kind: "edit-account", accountId: livret.id }));
    const d = await screen.findByRole("dialog", { name: "Modifier le compte" });
    const types = within(d).getByRole("group", { name: "Types du compte" });
    expect(within(types).getByLabelText("Épargne de précaution")).toHaveProperty("checked", true);
    await user.click(within(types).getByLabelText("Projet"));
    expect(account(repository, livret.id).typeIds).toEqual([PRECAUTION_TYPE_ID, PROJECT]);
    await user.click(within(types).getByLabelText("Projet comme type principal"));
    expect(account(repository, livret.id).typeIds).toEqual([PROJECT, PRECAUTION_TYPE_ID]);
  });

  it("à la saisie, une part se réserve à un type du compte ; la tuile montre chaque part", async () => {
    const user = userEvent.setup();
    const { repository, store } = await renderApp();
    await act(() => repository.apply({ accounts: [{ ...livret, typeIds: [PRECAUTION_TYPE_ID, PROJECT], updatedAt: 5 }] }));
    act(() => store.getState().actions.openModal({ kind: "operation", type: "tx" }));
    const d = await screen.findByRole("dialog", { name: "Nouvelle opération" });
    await user.type(within(d).getByLabelText("Montant"), "120");
    await user.selectOptions(within(d).getByLabelText("Depuis"), courant.name);
    await user.selectOptions(within(d).getByLabelText("Vers"), livret.name);
    const reserve = within(d).getByLabelText("Part réservée à");
    expect(within(reserve).getAllByRole("option").map((o) => o.textContent)).toEqual(["Aucune (type principal)", "Projet"]);
    await user.selectOptions(reserve, "Projet");
    await user.click(within(d).getByRole("button", { name: "Enregistrer" }));
    expect(repository.data.collections.operations.find((o) => o.type === "tx")).toMatchObject({ amount: 12_000, typeId: PROJECT });

    act(() => store.getState().actions.setTab("accounts"));
    const tile = within(screen.getByRole("heading", { name: "Vos comptes", level: 3 }).closest("section")!)
      .getAllByRole("listitem")
      .find((li) => li.textContent?.startsWith("Livret A"))!;
    // Livret A : 3 000 € de départ et 120 € versés, dont 120 € réservés au projet.
    expect(plain(tile.textContent)).toContain("Épargne de précaution 3 000,00 € · Projet 120,00 €");
  });

  it("sans type en plus du principal, rien à réserver", async () => {
    const { store } = await renderApp();
    act(() => store.getState().actions.openModal({ kind: "operation", type: "tx" }));
    const d = await screen.findByRole("dialog", { name: "Nouvelle opération" });
    expect(within(d).queryByLabelText("Part réservée à")).toBeNull();
  });
});

describe("carte de l'épargne de précaution (point 18)", () => {
  it("seuls les comptes choisis, avec leur part ; « Choisir les comptes » ouvre la liste à cocher", async () => {
    const user = userEvent.setup();
    const { repository, store } = await renderApp();
    act(() => store.getState().actions.setTab("goals"));
    const card = screen.getByRole("heading", { name: "Épargne de précaution", level: 3 }).closest("section")!;
    const chosen = within(card).getByRole("list");
    expect(within(chosen).getAllByRole("listitem").map((li) => plain(li.textContent))).toEqual(["Livret A3 000,00 €"]);

    await user.click(within(card).getByRole("button", { name: "Choisir les comptes" }));
    const d = await screen.findByRole("dialog", { name: "Comptes de l'épargne de précaution" });
    await user.click(within(d).getByRole("checkbox", { name: /Compte courant/ }));
    expect(account(repository, courant.id).typeIds).toEqual([PRECAUTION_TYPE_ID]);
    await user.click(within(d).getByRole("button", { name: "Terminé" }));
    expect(within(within(card).getByRole("list")).getAllByRole("listitem")).toHaveLength(2);
  });
});
