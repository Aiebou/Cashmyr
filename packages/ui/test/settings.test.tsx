import { createRecord, emptyDataset, serializeBackup, type Debt, type Operation, type Recurrence } from "@cashmyr/core";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCategories } from "../src/lib/data";
import { csvAmount, operationsCsv } from "../src/lib/export";
import { parsePercent, percentText } from "../src/screens/settings/BudgetSection";
import { accounts, renderApp, TODAY } from "./helpers";

afterEach(cleanup);

const cats = defaultCategories();
const cat = (name: string) => cats.find((c) => c.name === name)!.id;
const plain = (text: string | null | undefined) => (text ?? "").replace(/[\u00a0\u202f]/g, " ");
const { courant, livret } = accounts;

const op = (id: string, date: string, amount: number, type: Operation["type"], extra: Partial<Operation>): Operation =>
  createRecord<Operation>(id, { date, amount, type, note: "", ...extra } as Omit<Operation, "id" | "updatedAt" | "deletedAt">, 1);

const shopping = () => [
  op("shop-1", "2026-09-09", 4_250, "out", { categoryId: cat("Courses"), accountId: courant.id }),
  op("shop-2", "2026-08-09", 6_100, "out", { categoryId: cat("Courses"), accountId: courant.id }),
];

async function openSettings(options: Parameters<typeof renderApp>[0] = {}) {
  const app = await renderApp(options);
  await act(() => app.repository.apply({ operations: shopping() }));
  act(() => app.store.getState().actions.setTab("settings"));
  return app;
}

const card = (title: string) => screen.getByRole("heading", { name: title, level: 3 }).closest("section")!;
const dialog = () => screen.getByRole("dialog");

describe("écran Paramètres", () => {
  it("neuf sections, sans sélecteur de période dans l'en-tête", async () => {
    await openSettings();
    const toc = screen.getByRole("navigation", { name: "Sections des paramètres" });
    expect(within(toc).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Budget",
      "Comptes",
      "Récurrences",
      "Catégories et couleurs",
      "Tags",
      "Synchronisation",
      "Sauvegardes",
      "Apparence",
      "Application",
    ]);
    expect(screen.queryByRole("group", { name: /affichée?/ })).toBeNull();
  });
});

describe("budget", () => {
  it("pourcentages lus en points de base, jamais en flottant", () => {
    expect(parsePercent("33,33")).toBe(3_333);
    expect(parsePercent("50")).toBe(5_000);
    expect(parsePercent("12.5 %")).toBe(1_250);
    expect(parsePercent("101")).toBeNull();
    expect(parsePercent("1,234")).toBeNull();
    expect(percentText(3_330)).toBe("33,3");
    expect(percentText(5_000)).toBe("50");
  });

  it("la répartition ne s'enregistre qu'à 100 %, et le dit", async () => {
    const user = userEvent.setup();
    const { repository } = await openSettings();
    const splits = card("Répartition cible");
    const needs = within(splits).getByLabelText("Besoins");
    const save = within(splits).getByRole("button", { name: "Enregistrer la répartition" });
    await user.clear(needs);
    await user.type(needs, "45");
    expect(within(splits).getByRole("alert").textContent).toBe("Total : 95 % · il manque 5 %");
    expect(save.hasAttribute("disabled")).toBe(true);
    const wants = within(splits).getByLabelText("Envies");
    await user.clear(wants);
    await user.type(wants, "35");
    expect(within(splits).getByText("Total : 100 %")).toBeTruthy();
    await user.click(save);
    expect(repository.data.preferences.splits).toEqual({ besoin: 4_500, envie: 3_500, invest: 2_000 });
  });

  it("base de calcul et fenêtre de moyenne", async () => {
    const user = userEvent.setup();
    const { repository } = await openSettings();
    await user.click(screen.getByRole("radio", { name: "Revenus du mois" }));
    await user.click(screen.getByRole("radio", { name: "12 mois" }));
    expect(repository.data.preferences).toMatchObject({ basis: "month", averageWindow: 12 });
  });
});

describe("comptes (décision 30)", () => {
  it("un compte utilisé ne se supprime pas ; un compte inutilisé, si", async () => {
    const user = userEvent.setup();
    const { repository } = await openSettings();
    const list = within(card("Comptes")).getAllByRole("listitem");
    expect(plain(list[0]!.textContent)).toContain("Utilisé par 2 opérations : il ne peut pas être supprimé.");
    // Le livret n'a aucune opération.
    await user.click(within(list[1]!).getByRole("button", { name: "Supprimer le compte" }));
    await user.click(within(list[1]!).getByRole("button", { name: "Supprimer" }));
    expect(repository.data.collections.accounts.find((a) => a.id === livret.id)!.deletedAt).not.toBeNull();
  });

  it("valeur déclarée datée du jour, retirée en vidant le champ", async () => {
    const user = userEvent.setup();
    const { repository } = await openSettings();
    // Le compte courant n'a pas de champ : seul son solde compte (décision 42).
    const fields = within(card("Comptes")).getAllByLabelText("Valeur déclarée");
    expect(fields).toHaveLength(1);
    const field = fields[0]!;
    await user.type(field, "3 100{Enter}");
    expect(repository.data.collections.accounts.find((a) => a.id === livret.id)).toMatchObject({ declaredValue: 310_000, declaredAt: TODAY });
    await user.clear(field);
    await user.keyboard("{Enter}");
    const after = repository.data.collections.accounts.find((a) => a.id === livret.id)!;
    expect("declaredValue" in after || "declaredAt" in after).toBe(false);
  });
});

describe("catégories et couleurs (décision 31, section 5)", () => {
  it("une catégorie inutilisée se supprime après confirmation dans l'application", async () => {
    const user = userEvent.setup();
    const { repository } = await openSettings();
    await user.click(screen.getByRole("button", { name: "Supprimer « Voyages »" }));
    expect(within(dialog()).getByText("Aucune opération, récurrence ni dette ne l'utilise.")).toBeTruthy();
    await user.click(within(dialog()).getByRole("button", { name: "Supprimer" }));
    expect(repository.data.collections.categories.find((c) => c.id === cat("Voyages"))!.deletedAt).not.toBeNull();
  });

  it("une catégorie utilisée passe ses opérations à une existante, en annonçant le changement d'usage", async () => {
    const user = userEvent.setup();
    const { repository } = await openSettings();
    await user.click(screen.getByRole("button", { name: "Supprimer « Courses »" }));
    const d = dialog();
    expect(within(d).getByText("Utilisée par 2 opérations. Elles passeront dans :")).toBeTruthy();
    await user.selectOptions(within(d).getByLabelText("Catégorie"), "Restaurants et bars");
    expect(plain(within(d).getByRole("status").textContent)).toBe("Les mois passés changent : 103,50 € de dépenses passent de Besoins à Envies.");
    await user.click(within(d).getByRole("button", { name: "Réaffecter et supprimer" }));
    const live = repository.data.collections.operations.filter((o) => o.deletedAt === null);
    expect(live.map((o) => o.categoryId)).toEqual([cat("Restaurants et bars"), cat("Restaurants et bars")]);
    expect(repository.data.collections.categories.find((c) => c.id === cat("Courses"))!.deletedAt).not.toBeNull();
  });

  it("ou à une nouvelle catégorie créée sur place", async () => {
    const user = userEvent.setup();
    const { repository } = await openSettings();
    await user.click(screen.getByRole("button", { name: "Supprimer « Courses »" }));
    await user.click(within(dialog()).getByRole("radio", { name: "Une nouvelle catégorie" }));
    await user.type(within(dialog()).getByLabelText("Nom de la nouvelle catégorie"), "Alimentation");
    await user.click(within(dialog()).getByRole("button", { name: "Réaffecter et supprimer" }));
    const created = repository.data.collections.categories.find((c) => c.name === "Alimentation")!;
    expect(created).toMatchObject({ kind: "out", bucket: "besoin", deletedAt: null });
    expect(repository.data.collections.operations.every((o) => o.categoryId === created.id)).toBe(true);
  });

  it("changer l'usage d'une catégorie utilisée demande confirmation, chiffres à l'appui", async () => {
    const user = userEvent.setup();
    const { repository } = await openSettings();
    await user.selectOptions(screen.getByLabelText("Usage de « Courses »"), "Envies");
    expect(plain(within(dialog()).getByText(/Les mois passés changent aussi/).textContent)).toBe(
      "Les mois passés changent aussi : 2 opérations, 103,50 € en tout, passent de Besoins à Envies.",
    );
    await user.click(within(dialog()).getByRole("button", { name: "Annuler" }));
    expect(repository.data.collections.categories.find((c) => c.id === cat("Courses"))!.bucket).toBe("besoin");
  });

  it("ajouter une source de revenu ; les doublons sont refusés", async () => {
    const user = userEvent.setup();
    const { repository } = await openSettings();
    const add = screen.getByLabelText("Nouvelle source de revenu");
    await user.type(add, "Loyers perçus{Enter}");
    expect(repository.data.collections.categories.some((c) => c.name === "Loyers perçus" && c.kind === "in")).toBe(true);
    await user.type(screen.getByLabelText("Nouvelle source de revenu"), "salaire{Enter}");
    expect(screen.getByText("Cette catégorie existe déjà.")).toBeTruthy();
  });

  it("couleur d'une source et d'un usage : choisie à la fermeture du sélecteur, puis rendue au thème", async () => {
    const user = userEvent.setup();
    const { repository } = await openSettings();
    const salary = screen.getByLabelText("Couleur de Salaire") as HTMLInputElement;
    fireEvent.input(salary, { target: { value: "#aa3355" } });
    expect(repository.data.preferences.categoryColors).toEqual({});
    fireEvent.change(salary, { target: { value: "#aa3355" } });
    await screen.findByRole("button", { name: "Rendre à Salaire sa couleur d'origine" });
    expect(repository.data.preferences.categoryColors).toEqual({ [cat("Salaire")]: "#aa3355" });
    await user.click(screen.getByRole("button", { name: "Rendre à Salaire sa couleur d'origine" }));
    expect(repository.data.preferences.categoryColors).toEqual({});

    const needs = screen.getByLabelText("Couleur de Besoins") as HTMLInputElement;
    needs.value = "#112233";
    needs.dispatchEvent(new Event("change"));
    await screen.findByRole("button", { name: "Rendre à Besoins sa couleur d'origine" });
    expect(repository.data.preferences.bucketColors).toEqual({ besoin: "#112233" });
  });
});

describe("récurrences", () => {
  it("créée avec un premier mois passé : la fenêtre annonce les opérations créées tout de suite", async () => {
    const user = userEvent.setup();
    const { repository } = await openSettings();
    await user.click(screen.getByRole("button", { name: "Nouvelle récurrence" }));
    const d = dialog();
    await user.type(within(d).getByLabelText("Libellé"), "Salle de sport");
    await user.type(within(d).getByLabelText("Montant"), "35");
    await user.selectOptions(within(d).getByLabelText("Catégorie"), "Sorties et loisirs");
    await user.selectOptions(within(d).getByLabelText("Jour du mois"), "le 3");
    await user.selectOptions(within(d).getByLabelText("Premier mois"), "juillet 2026");
    expect(plain(within(d).getByRole("status").textContent)).toBe(
      "L'enregistrement crée tout de suite 3 opérations, de juillet 2026 à septembre 2026 : les mois dont le jour est déjà passé.",
    );
    await user.click(within(d).getByRole("button", { name: "Enregistrer" }));
    const rec = repository.data.collections.recurrences[0]!;
    expect(rec).toMatchObject({ label: "Salle de sport", amount: 3_500, dayOfMonth: 3, startMonth: "2026-07", endMonth: null, active: true });
    expect(repository.data.collections.operations.filter((o) => o.recurrenceId === rec.id)).toHaveLength(3);
    expect(plain(within(card("Récurrences")).getByText(/le 3 de chaque mois/).textContent)).toBe(
      "−35,00 € le 3 de chaque mois · Sorties et loisirs · Compte courant · depuis juillet 2026",
    );
  });

  it("pause, reprise avec les mois manqués marqués « ignorés », suppression", async () => {
    const user = userEvent.setup();
    const rec = createRecord<Recurrence>(
      "rec-gym",
      { label: "Salle de sport", amount: 3_500, type: "out", categoryId: cat("Sorties et loisirs"), accountId: courant.id, dayOfMonth: 3, startMonth: "2026-10", endMonth: null, active: true },
      1,
    );
    const { repository } = await openSettings();
    await act(() => repository.apply({ recurrences: [rec] }));
    await user.click(screen.getByRole("button", { name: "Mettre « Salle de sport » en pause" }));
    expect(within(card("Récurrences")).getByText("En pause")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reprendre « Salle de sport »" }));
    await screen.findByText("Récurrence reprise");
    await user.click(screen.getByRole("button", { name: "Supprimer « Salle de sport »" }));
    expect(within(dialog()).getByText("Plus rien ne sera créé. Les opérations déjà créées restent dans le budget.")).toBeTruthy();
    await user.click(within(dialog()).getByRole("button", { name: "Supprimer" }));
    expect(repository.data.collections.recurrences[0]!.deletedAt).not.toBeNull();
  });

  it("supprimer le prélèvement d'une dette le retire aussi de la dette", async () => {
    const user = userEvent.setup();
    const loan = createRecord<Debt>(
      "debt-1",
      {
        name: "Prêt auto", creditor: "", direction: "owe", principal: 0, paidManual: 0, mode: "installments", installmentAmount: 20_000,
        installmentCount: 5, startDate: "2026-10-10", dayOfMonth: 10, categoryId: cat("Crédit"), accountId: courant.id, recurrenceId: "rec-debt",
        hidden: false, pinned: false, settled: false, settledAt: null, archived: false, position: 1, color: 3,
      },
      1,
    );
    const rec = createRecord<Recurrence>(
      "rec-debt",
      { label: "Échéance — Prêt auto", amount: 20_000, type: "out", categoryId: cat("Crédit"), accountId: courant.id, debtId: "debt-1", dayOfMonth: 10, startMonth: "2026-10", endMonth: "2027-02", active: true },
      1,
    );
    const { repository } = await openSettings();
    await act(() => repository.apply({ recurrences: [rec], debts: [loan] }));
    expect(within(card("Récurrences")).getByText("Dette « Prêt auto »")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Supprimer « Échéance — Prêt auto »" }));
    await user.click(within(dialog()).getByRole("button", { name: "Supprimer" }));
    expect(repository.data.collections.debts[0]!.recurrenceId).toBeNull();
  });
});

describe("sauvegardes (décisions 32 et 33)", () => {
  it("export JSON et CSV passent par la plateforme", async () => {
    const user = userEvent.setup();
    const saved: { name: string; mime: string; content: string }[] = [];
    await openSettings({ files: { saveAs: async (name, mime, content) => (saved.push({ name, mime, content }), true) } });
    await user.click(screen.getByRole("button", { name: "Exporter une sauvegarde (JSON)" }));
    await user.click(screen.getByRole("button", { name: "Exporter les opérations (CSV)" }));
    expect(saved.map((f) => [f.name, f.mime])).toEqual([
      [`cashmyr-sauvegarde-${TODAY}.json`, "application/json"],
      [`cashmyr-operations-${TODAY}.csv`, "text/csv"],
    ]);
    expect(JSON.parse(saved[0]!.content).collections.operations).toHaveLength(2);
    expect(saved[1]!.content.split("\r\n")[1]).toBe('"2026-08-09";"Dépense";"Courses";"Besoins";"Compte courant";"";"";"";"";"61,00";""');
  });

  it("CSV : colonnes de l'ancienne application, BOM, CRLF, transferts et montants", () => {
    const data = {
      ...emptyDataset(),
      collections: {
        ...emptyDataset().collections,
        categories: cats,
        accounts: [courant, livret],
        operations: [op("t", "2026-09-01", 5, "tx", { fromAccountId: courant.id, toAccountId: livret.id, note: 'dit "épargne"' })],
      },
    };
    const [header, row] = operationsCsv(data).split("\r\n");
    expect(header).toBe('﻿"Date";"Type";"Categorie";"Usage";"Compte";"Vers";"Objectif";"Dette";"Libelle";"Montant";"Tag"');
    expect(row).toBe('"2026-09-01";"Transfert";"";"";"Compte courant";"Livret A";"";"";"dit ""épargne""";"0,05";""');
    expect(csvAmount(123_456)).toBe("1234,56");
  });

  it("l'import fusionne après confirmation ; un fichier invalide est refusé en entier", async () => {
    const user = userEvent.setup();
    let content = "";
    const { repository, store } = await openSettings({ files: { openText: async () => ({ name: "sauvegarde.json", content }) } });
    const extra = op("gift", "2026-09-15", 2_000, "out", { categoryId: cat("Cadeaux"), accountId: courant.id, updatedAt: 99 });
    content = serializeBackup({ ...store.getState().data, collections: { ...store.getState().data.collections, operations: [...shopping(), extra] } });
    await user.click(screen.getByRole("button", { name: "Importer un fichier (JSON)" }));
    expect(plain(within(dialog()).getByText(/ligne sera ajoutée/).textContent)).toMatch(/^1 ligne sera ajoutée\. Pour chaque ligne/);
    await user.click(within(dialog()).getByRole("button", { name: "Importer" }));
    expect(repository.data.collections.operations.map((o) => o.id).sort()).toEqual(["gift", "shop-1", "shop-2"]);

    // Un fichier de l'ancienne application incomplet : refusé en entier, les raisons dans une fenêtre.
    content = JSON.stringify({ settings: {}, months: {} });
    await user.click(screen.getByRole("button", { name: "Importer un fichier (JSON)" }));
    expect(within(await screen.findByRole("dialog", { name: "Reprise refusée" })).getByText(/^Rien n'a été écrit/).textContent).toMatch(
      /• settings\.v : champ manquant/,
    );
    expect(within(dialog()).queryByRole("button", { name: "Annuler" })).toBeNull();
    await user.click(within(dialog()).getByRole("button", { name: "Compris" }));
    expect(repository.data.collections.operations).toHaveLength(3);
  });

  it("restaurer une copie : confirmation chiffrée, copie de l'état actuel, puis la copie gagne", async () => {
    const user = userEvent.setup();
    const { repository, local, store } = await openSettings();
    await local.snapshot(Date.UTC(2026, 8, 20, 9));
    await act(() => repository.apply({ operations: [op("late", "2026-09-20", 1_500, "out", { categoryId: cat("Cadeaux"), accountId: courant.id })] }));
    // La liste des copies se relit quand la section s'affiche.
    act(() => store.getState().actions.setTab("dashboard"));
    act(() => store.getState().actions.setTab("settings"));
    await user.click(await screen.findByRole("button", { name: /^Restaurer la copie du/ }));
    expect(plain(within(await screen.findByRole("dialog")).getByText(/sera supprimée/).textContent)).toBe(
      "1 ligne créée depuis sera supprimée. Tes autres appareils suivront à leur prochaine synchronisation.",
    );
    await user.click(within(dialog()).getByRole("button", { name: "Restaurer partout" }));
    await screen.findByText("Copie restaurée");
    const byId = (id: string) => repository.data.collections.operations.find((o) => o.id === id)!;
    expect(byId("late").deletedAt).not.toBeNull();
    expect([byId("shop-1").deletedAt, byId("shop-2").deletedAt]).toEqual([null, null]);
    // Une copie de l'état d'avant la restauration a été prise.
    expect(local.snapshots).toHaveLength(2);
  });
});

describe("remise à zéro (décision 45)", () => {
  it("effacer cet appareil : confirmation, copie de sauvegarde, données retirées, relance sur l'accueil", async () => {
    const user = userEvent.setup();
    const restart = vi.fn();
    const { local } = await openSettings({ restart });
    await user.click(within(card("Remise à zéro")).getByRole("button", { name: "Effacer cet appareil…" }));
    expect(within(dialog()).getByText(/Une copie de sauvegarde est prise juste avant\./)).toBeTruthy();
    await user.click(within(dialog()).getByRole("button", { name: "Effacer cet appareil" }));
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    expect(await local.load()).toBeNull();
    expect(local.snapshots[0]!.data.collections.operations.length).toBeGreaterThan(0);
    expect(local.device).toMatchObject({ dirty: {}, sync: { fileId: null } });
  });

  it("annuler ne touche à rien", async () => {
    const user = userEvent.setup();
    const restart = vi.fn();
    const { repository } = await openSettings({ restart });
    await user.click(within(card("Remise à zéro")).getByRole("button", { name: "Tout effacer, partout…" }));
    await user.click(within(dialog()).getByRole("button", { name: "Annuler" }));
    expect(repository.data.collections.operations.some((o) => o.deletedAt === null)).toBe(true);
    expect(restart).not.toHaveBeenCalled();
  });

  it("tout effacer partout : tout supprimé, réglages par défaut, l'accueil revient ; les catégories par défaut repartent", async () => {
    const user = userEvent.setup();
    const { repository, local, actions } = await openSettings();
    await act(async () => void (await actions.setPreference("averageWindow", 12)));
    await user.click(within(card("Remise à zéro")).getByRole("button", { name: "Tout effacer, partout…" }));
    expect(within(dialog()).getByText(/Restaurer la remet partout/)).toBeTruthy();
    await user.click(within(dialog()).getByRole("button", { name: "Tout effacer, partout" }));
    expect(await screen.findByRole("heading", { name: "Bienvenue" })).toBeTruthy();
    const collections = repository.data.collections;
    expect(Object.values(collections).every((rows) => rows.every((r) => r.deletedAt !== null))).toBe(true);
    expect(repository.data.preferences.averageWindow).toBe(emptyDataset().preferences.averageWindow);
    expect(local.snapshots[0]!.data.preferences.averageWindow).toBe(12);

    await user.click(screen.getByRole("button", { name: "Commencer avec les catégories par défaut" }));
    await screen.findByRole("dialog", { name: "Nouveau compte" });
    expect(repository.data.collections.categories.filter((c) => c.deletedAt === null)).toHaveLength(defaultCategories().length);
  });
});
