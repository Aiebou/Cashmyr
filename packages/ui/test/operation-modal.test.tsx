import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderApp } from "./helpers";

afterEach(cleanup);

// Sous jsdom, import.meta.url n'est pas une URL de fichier : on part du dossier du paquet.
const globalCss = readFileSync(join(process.cwd(), "src/theme/global.css"), "utf8");

async function openOperation(type: "out" | "in" | "tx" = "out") {
  const app = await renderApp();
  act(() => app.actions.openModal({ kind: "operation", type }));
  const dialog = await screen.findByRole("dialog", { name: "Nouvelle opération" });
  return { ...app, dialog };
}

/** Sélecteurs visibles, au sens de l'accessibilité : un champ masqué n'y figure pas. */
const shown = (dialog: HTMLElement, name: string) => within(dialog).queryByRole("combobox", { name });

describe("champs masqués de la saisie", () => {
  it("Dépense puis Revenu : ni « Depuis » ni « Vers » ; Transfert : ni catégorie ni compte", async () => {
    const user = userEvent.setup();
    const { dialog } = await openOperation("out");

    for (const type of ["Dépense", "Revenu"]) {
      await user.click(within(dialog).getByRole("radio", { name: type }));
      expect(shown(dialog, "Depuis")).toBeNull();
      expect(shown(dialog, "Vers")).toBeNull();
      expect(shown(dialog, "Catégorie")).not.toBeNull();
      expect(shown(dialog, "Compte")).not.toBeNull();
      // Les conteneurs portent bien l'attribut hidden.
      expect(within(dialog).getByLabelText("Depuis").closest("[hidden]")).not.toBeNull();
      expect(within(dialog).getByLabelText("Vers").closest("[hidden]")).not.toBeNull();
    }

    await user.click(within(dialog).getByRole("radio", { name: "Transfert" }));
    expect(shown(dialog, "Catégorie")).toBeNull();
    expect(shown(dialog, "Compte")).toBeNull();
    expect(shown(dialog, "Depuis")).not.toBeNull();
    expect(shown(dialog, "Vers")).not.toBeNull();
    expect(within(dialog).getByLabelText("Catégorie").closest("[hidden]")).not.toBeNull();
  });

  it("la feuille de styles déclare que tout élément portant hidden ne s'affiche pas", () => {
    const rule = /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/;
    expect(globalCss).toMatch(rule);
  });
});

describe("saisie d'une opération", () => {
  it("le montant vient en premier, accepte la virgule, et Entrée enregistre des centimes entiers", async () => {
    const user = userEvent.setup();
    const { dialog, repository } = await openOperation("out");
    const amount = within(dialog).getByLabelText("Montant");
    expect(document.activeElement).toBe(amount);
    await user.type(amount, "12,50");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Catégorie" }), "Courses");
    await user.type(amount, "{Enter}");
    await screen.findByText("Dépense enregistrée");
    const [op] = repository.data.collections.operations;
    expect(op).toMatchObject({ amount: 1250, type: "out", date: "2026-09-23", accountId: "acc-courant" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refuse un montant absent ou invalide, sans rien enregistrer", async () => {
    const user = userEvent.setup();
    const { dialog, repository } = await openOperation("out");
    await user.type(within(dialog).getByLabelText("Montant"), "12,345{Enter}");
    const alerts = within(dialog).getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toEqual(["Indique un montant supérieur à zéro.", "Choisis une catégorie."]);
    expect(repository.data.collections.operations).toEqual([]);
  });

  it("un transfert part du compte courant vers l'épargne par défaut", async () => {
    const user = userEvent.setup();
    const { dialog, repository } = await openOperation("tx");
    await user.type(within(dialog).getByLabelText("Montant"), "300{Enter}");
    await screen.findByText("Transfert enregistré");
    expect(repository.data.collections.operations[0]).toMatchObject({
      type: "tx",
      amount: 30_000,
      fromAccountId: "acc-courant",
      toAccountId: "acc-livret",
    });
  });

  it("« répéter chaque mois » crée la récurrence à partir du mois suivant, au jour choisi", async () => {
    const user = userEvent.setup();
    const { dialog, repository } = await openOperation("out");
    await user.type(within(dialog).getByLabelText("Montant"), "820");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Catégorie" }), "Loyer et charges");
    await user.click(within(dialog).getByLabelText("Répéter chaque mois, à partir du mois suivant"));
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Jour du mois" }), "5");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Dépense enregistrée");
    expect(repository.data.collections.recurrences[0]).toMatchObject({
      amount: 82_000,
      dayOfMonth: 5,
      startMonth: "2026-10",
      endMonth: null,
      active: true,
    });
  });
});

describe("menu Ajouter", () => {
  it("annonce un menu, s'ouvre, se ferme avec Échap et rend le focus", async () => {
    const user = userEvent.setup();
    await renderApp();
    const button = screen.getByRole("button", { name: "Ajouter" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Dépense",
      "Revenu",
      "Transfert",
      "Objectif",
      "Dette",
      "Compte",
    ]);
    expect(within(menu).getAllByRole("separator")).toHaveLength(1);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("se ferme au clic à l'extérieur, et après le choix d'une entrée", async () => {
    const user = userEvent.setup();
    await renderApp();
    const button = screen.getByRole("button", { name: "Ajouter" });
    await user.click(button);
    await user.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(button);
    await user.click(screen.getByRole("menuitem", { name: "Revenu" }));
    expect(screen.queryByRole("menu")).toBeNull();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: "Revenu" }).getAttribute("aria-checked")).toBe("true");
  });

  it("Compte ouvre une création courte puis bascule sur l'onglet Mes comptes", async () => {
    const user = userEvent.setup();
    const { store, repository } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    await user.click(screen.getByRole("menuitem", { name: "Compte" }));
    const dialog = await screen.findByRole("dialog", { name: "Nouveau compte" });
    await user.type(within(dialog).getByLabelText("Nom"), "PEA");
    await user.selectOptions(within(dialog).getByLabelText("Type de compte"), "Placement");
    await user.click(within(dialog).getByRole("button", { name: "Créer" }));
    await screen.findByText("Compte créé");
    expect(repository.data.collections.accounts.map((a) => a.name)).toContain("PEA");
    expect(store.getState().tab).toBe("accounts");
  });
});
