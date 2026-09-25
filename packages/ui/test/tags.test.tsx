import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { renderApp } from "./helpers";

afterEach(cleanup);

/** Espaces fines et insécables d'Intl ramenées à des espaces simples. */
const plain = (text: string | null | undefined) => (text ?? "").replace(/[  ]/g, " ");

type App = Awaited<ReturnType<typeof renderApp>>;

/** Saisit une opération du mois affiché, avec un tag. */
async function addOperation(app: App, type: "Dépense" | "Revenu" | "Transfert", amount: string, tag: string) {
  const user = userEvent.setup();
  act(() => app.actions.openModal({ kind: "operation", type: "out" }));
  const dialog = await screen.findByRole("dialog", { name: "Nouvelle opération" });
  await user.click(within(dialog).getByRole("radio", { name: type }));
  await user.type(within(dialog).getByLabelText("Montant"), amount);
  if (type === "Dépense") await user.selectOptions(within(dialog).getByLabelText("Catégorie"), "Abonnements");
  if (type === "Revenu") await user.selectOptions(within(dialog).getByLabelText("Catégorie"), "Revenus de trading");
  if (type === "Transfert") await user.selectOptions(within(dialog).getByLabelText("Vers"), "Livret A");
  await user.type(within(dialog).getByLabelText("Tag"), tag);
  await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

describe("tags (décisions 47 et 48)", () => {
  it("un nom nouveau crée le tag ; le même nom, à la casse près, le reprend", async () => {
    const app = await renderApp();
    await addOperation(app, "Dépense", "21", "Société A");
    await addOperation(app, "Revenu", "19,99", "  société a ");
    const tags = app.repository.data.collections.tags;
    expect(tags.map((t) => t.name)).toEqual(["Société A"]);
    expect(app.repository.data.collections.operations.map((o) => o.tagId)).toEqual([tags[0]!.id, tags[0]!.id]);
  });

  it("Opérations : filtre par tag, entrées, sorties et solde du mois ; les transferts listés sans compter", async () => {
    const user = userEvent.setup();
    const app = await renderApp();
    await addOperation(app, "Dépense", "21", "Propfirm FTMO");
    await addOperation(app, "Revenu", "19,99", "Propfirm FTMO");
    await addOperation(app, "Transfert", "100", "Propfirm FTMO");
    await addOperation(app, "Dépense", "5", "Autre projet");
    act(() => app.actions.setTab("operations"));
    await user.selectOptions(screen.getByLabelText("Tag"), "Propfirm FTMO");
    // Le signe moins dépend de la version d'ICU : trait d'union ou signe moins.
    expect(plain(screen.getByText(/opérations sur/).textContent)).toMatch(
      /^3 opérations sur 4 · Entrées 19,99 € · Sorties 21,00 € · Solde [−-]1,01 € · 1 transfert non compté$/,
    );
    // Le tag s'affiche dans la liste.
    expect(screen.getAllByText("Propfirm FTMO", { selector: "span" }).length).toBeGreaterThanOrEqual(3);
  });

  it("Paramètres : renommer garde les opérations ; supprimer les laisse intactes, sans afficher le tag", async () => {
    const user = userEvent.setup();
    const app = await renderApp();
    await addOperation(app, "Dépense", "21", "Projet");
    const op = app.repository.data.collections.operations[0]!;
    act(() => app.actions.setTab("settings"));
    const card = screen.getByRole("heading", { name: "Tags", level: 3 }).closest("section")!;
    expect(plain(card.textContent)).toContain("1 opération");
    const field = within(card).getByLabelText("Nom du tag « Projet »");
    await user.clear(field);
    await user.type(field, "Société A{Enter}");
    expect(app.repository.data.collections.tags[0]).toMatchObject({ id: op.tagId, name: "Société A" });

    await user.click(within(card).getByRole("button", { name: "Supprimer le tag « Société A »" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Elles ne sont pas modifiées/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Supprimer" }));
    const after = app.repository.data.collections.operations[0]!;
    expect(after).toEqual(op);
    act(() => app.actions.setTab("operations"));
    expect(screen.queryByText("Société A")).toBeNull();
  });

  it("une récurrence taguée : le champ Tag la suit, et chaque occurrence le reprend", async () => {
    const user = userEvent.setup();
    const app = await renderApp();
    act(() => app.actions.openModal({ kind: "recurrence" }));
    const dialog = await screen.findByRole("dialog", { name: "Nouvelle récurrence" });
    await user.type(within(dialog).getByLabelText("Libellé"), "Abonnement Anthropic");
    await user.type(within(dialog).getByLabelText("Montant"), "21");
    await user.selectOptions(within(dialog).getByLabelText("Catégorie"), "Abonnements");
    await user.type(within(dialog).getByLabelText("Tag"), "Société A");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Récurrence créée");
    const [rec] = app.repository.data.collections.recurrences;
    const [tag] = app.repository.data.collections.tags;
    expect(rec!.tagId).toBe(tag!.id);
  });
});
