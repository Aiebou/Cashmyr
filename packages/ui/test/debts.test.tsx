import { createRecord, debtRecurrenceId, type Debt, type Operation } from "@cashmyr/core";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ofMonth } from "../src/lib/format";
import { defaultCategories } from "../src/lib/data";
import { accounts, renderApp, TODAY } from "./helpers";

afterEach(cleanup);

const cats = defaultCategories();
const cat = (name: string) => cats.find((c) => c.name === name)!.id;
/** Espaces fines et insécables d'Intl ramenées à des espaces simples. */
const plain = (text: string | null | undefined) => (text ?? "").replace(/[\u00a0\u202f]/g, " ");

/** 1 000 € en 5 × 200 €, de juillet à novembre 2026, le 10. */
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
      installmentAmount: 20_000,
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

const salary = (id: string, date: string): Operation =>
  createRecord<Operation>(id, { date, amount: 200_000, type: "in", note: "", categoryId: cat("Salaire"), accountId: accounts.courant.id }, 1);

async function openDebts(debts: Debt[], operations: Operation[] = []) {
  const app = await renderApp();
  await act(() => app.repository.apply({ debts, operations }));
  act(() => app.store.getState().actions.setTab("debts"));
  return app;
}

const card = (name: string) => screen.getByRole("heading", { name, level: 3 }).closest("article")!;
const liveOps = (app: Awaited<ReturnType<typeof openDebts>>) =>
  app.repository.data.collections.operations.filter((o) => o.deletedAt === null);
const debt = (app: Awaited<ReturnType<typeof openDebts>>, id = "debt-1") =>
  app.repository.data.collections.debts.find((d) => d.id === id)!;

describe("bandeau des dettes", () => {
  it("reste à rembourser, barre par dette, charge mensuelle rapportée au revenu moyen", async () => {
    const lent = loan({ direction: "lent", name: "Avance à Sam", categoryId: null, color: 1 });
    await openDebts(
      [loan({ paidManual: 60_000 }), { ...lent, id: "debt-2" }],
      [salary("s-6", "2026-06-05"), salary("s-7", "2026-07-05"), salary("s-8", "2026-08-05")],
    );
    const banner = screen.getByText("Reste à rembourser aujourd'hui").closest("section")!;
    // Seules les dettes « je dois » comptent : 1 000 − 600 = 400 €.
    expect(plain(banner.textContent)).toMatch(/^Reste à rembourser aujourd'hui400,00 €/);
    expect(within(banner).getAllByRole("listitem").map((li) => plain(li.textContent))).toEqual(["Prêt auto400,00 €"]);
    // 200 € d'échéance pour 2 000 € de revenu moyen (fenêtre tronquée au premier mois d'activité).
    expect(plain(banner.textContent)).toMatch(/Charge mensuelle : 200,00 €, soit 10 % du revenu moyen des 6 derniers mois \(2 000,00 €\)\./);
  });

  it("sans revenu moyen, la charge est donnée seule", async () => {
    await openDebts([loan()]);
    const banner = screen.getByText("Reste à rembourser aujourd'hui").closest("section")!;
    expect(plain(banner.textContent)).toMatch(/Charge mensuelle : 200,00 €\. Pas encore de revenu moyen pour la comparer\./);
  });
});

describe("versement ponctuel", () => {
  it("1 000 € en 5 × 200 €, 600 € réglés, versement de 350 € : il reste une seule échéance, de 50 €", async () => {
    const user = userEvent.setup();
    const app = await openDebts([loan({ paidManual: 60_000 })]);
    const c = card("Prêt auto");
    expect(within(c).getByText("Versement ponctuel")).toBeTruthy();
    expect((within(c).getByLabelText("Date") as HTMLInputElement).value).toBe(TODAY);
    expect((within(c).getByLabelText("Créer aussi l'opération dans mon budget") as HTMLInputElement).checked).toBe(true);

    await user.type(within(c).getByLabelText("Montant"), "350");
    await user.click(within(c).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Versement enregistré dans le budget");

    expect(plain(within(card("Prêt auto")).getByText(/^reste/).textContent)).toBe(
      "reste 1 échéance de 50,00 € · prochaine le 10 novembre 2026 · soldée en novembre 2026.",
    );
    const [op] = liveOps(app).filter((o) => o.debtId === "debt-1");
    expect(op).toMatchObject({
      type: "out",
      amount: 35_000,
      date: TODAY,
      note: "Versement — Prêt auto",
      categoryId: cat("Crédit"),
      accountId: accounts.courant.id,
    });
    expect(debt(app).paidManual).toBe(60_000);
  });

  it("case décochée : le déjà réglé augmente, aucune opération n'est créée", async () => {
    const user = userEvent.setup();
    const app = await openDebts([loan({ paidManual: 60_000 })]);
    const c = card("Prêt auto");
    await user.click(within(c).getByLabelText("Créer aussi l'opération dans mon budget"));
    // La date ne sert qu'à l'opération : elle disparaît.
    expect(within(c).getByLabelText("Date").closest("[hidden]")).not.toBeNull();
    await user.type(within(c).getByLabelText("Montant"), "100");
    await user.click(within(c).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Versement enregistré hors budget");
    expect(debt(app).paidManual).toBe(70_000);
    expect(liveOps(app).some((o) => o.debtId === "debt-1")).toBe(false);
  });

  it("« on me doit » sans catégorie : « Remboursement reçu » la demande, crée un revenu et la retient", async () => {
    const user = userEvent.setup();
    const app = await openDebts([loan({ direction: "lent", name: "Avance à Sam", categoryId: null, principal: 40_000, mode: "free", installmentAmount: 0, installmentCount: 0 })]);
    const box = screen.getByRole("form", { name: "Remboursement reçu" });
    await user.type(within(box).getByLabelText("Montant"), "50");
    await user.selectOptions(within(box).getByLabelText("Catégorie"), "Aides et remboursements");
    await user.click(within(box).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Remboursement enregistré dans le budget");
    const [op] = liveOps(app).filter((o) => o.debtId === "debt-1");
    expect(op).toMatchObject({ type: "in", amount: 5_000, categoryId: cat("Aides et remboursements") });
    expect(debt(app).categoryId).toBe(cat("Aides et remboursements"));
    expect(plain(within(card("Avance à Sam")).getByText(/^reste/).textContent)).toBe("reste à recevoir 350,00 €.");
  });
});

describe("prélèvement automatique", () => {
  it("créé du mois de la prochaine échéance au mois de la dernière, puis retiré sans toucher aux opérations", async () => {
    const user = userEvent.setup();
    const paid = createRecord<Operation>(
      "op-paid",
      { date: "2026-07-10", amount: 20_000, type: "out", note: "", categoryId: cat("Crédit"), accountId: accounts.courant.id, debtId: "debt-1" },
      1,
    );
    const app = await openDebts([loan({ paidManual: 40_000 })], [paid]);
    // 600 € réglés : prochaine échéance le 10 octobre.
    await user.click(within(card("Prêt auto")).getByRole("button", { name: "Créer le prélèvement mensuel" }));
    await screen.findByText("Prélèvement créé");

    const rec = app.repository.data.collections.recurrences.find((r) => r.id === debtRecurrenceId("debt-1"))!;
    expect(rec).toMatchObject({ startMonth: "2026-10", endMonth: "2026-11", debtId: "debt-1", amount: 20_000, dayOfMonth: 10, type: "out" });
    expect(debt(app).recurrenceId).toBe(rec.id);
    expect(plain(card("Prêt auto").textContent)).toContain(`${ofMonth("2026-10")} à novembre 2026`);
    expect(ofMonth("2026-10")).toBe("d'octobre 2026");

    await user.click(within(card("Prêt auto")).getByRole("button", { name: "Retirer le prélèvement mensuel" }));
    await screen.findByText("Prélèvement retiré");
    expect(app.repository.data.collections.recurrences.find((r) => r.id === rec.id)!.deletedAt).not.toBeNull();
    expect(debt(app).recurrenceId).toBeNull();
    expect(liveOps(app).map((o) => o.id)).toContain("op-paid");
  });

  it("supprimer la dette arrête son prélèvement ; la confirmation le dit", async () => {
    const user = userEvent.setup();
    const app = await openDebts([loan()]);
    await user.click(within(card("Prêt auto")).getByRole("button", { name: "Créer le prélèvement mensuel" }));
    await screen.findByText("Prélèvement créé");
    await user.click(within(card("Prêt auto")).getByRole("button", { name: "Supprimer la dette" }));
    expect(screen.getByRole("group", { name: "Confirmer la suppression" }).textContent).toContain("Son prélèvement mensuel s'arrête aussi");
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await screen.findByText("Dette supprimée");
    expect(debt(app).deletedAt).not.toBeNull();
    expect(app.repository.data.collections.recurrences.find((r) => r.id === debtRecurrenceId("debt-1"))!.deletedAt).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Prêt auto" })).toBeNull();
  });

  it("impossible sans catégorie ni compte : le bouton le dit", async () => {
    await openDebts([loan({ categoryId: null })]);
    const c = card("Prêt auto");
    expect(within(c).getByRole("button", { name: "Créer le prélèvement mensuel" }).hasAttribute("disabled")).toBe(true);
    expect(within(c).getByText(/Renseigne d'abord la catégorie et le compte/)).toBeTruthy();
  });

  it("signale un prélèvement dont les réglages ne suivent plus la dette, et le met à jour", async () => {
    const user = userEvent.setup();
    const app = await openDebts([loan()]);
    await user.click(within(card("Prêt auto")).getByRole("button", { name: "Créer le prélèvement mensuel" }));
    await screen.findByText("Prélèvement créé");
    await act(() => app.repository.apply({ debts: [{ ...debt(app), installmentAmount: 25_000, updatedAt: debt(app).updatedAt + 1 }] }));
    const c = card("Prêt auto");
    expect(within(c).getByText("Les réglages de la dette ont changé depuis la création du prélèvement mensuel.")).toBeTruthy();
    await user.click(within(c).getByRole("button", { name: "Mettre à jour le prélèvement mensuel" }));
    await screen.findByText("Prélèvement mis à jour");
    expect(app.repository.data.collections.recurrences.find((r) => r.id === debtRecurrenceId("debt-1"))!.amount).toBe(25_000);
    expect(within(card("Prêt auto")).queryByRole("button", { name: "Mettre à jour le prélèvement mensuel" })).toBeNull();
  });
});

describe("commandes et sections", () => {
  it("masquer, épingler, marquer soldée puis archiver et restaurer", async () => {
    const user = userEvent.setup();
    const app = await openDebts([loan()]);
    await user.click(within(card("Prêt auto")).getByRole("button", { name: "Masquer du tableau de bord" }));
    await user.click(within(card("Prêt auto")).getByRole("button", { name: "Épingler en tête" }));
    expect(debt(app)).toMatchObject({ hidden: true, pinned: true });

    await user.click(within(card("Prêt auto")).getByRole("button", { name: "Marquer soldée" }));
    expect(debt(app)).toMatchObject({ settled: true, settledAt: TODAY });
    const soldées = screen.getByRole("heading", { name: "Dettes soldées" });
    expect(soldées.compareDocumentPosition(card("Prêt auto")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Soldée : plus d'encadré de versement.
    expect(within(card("Prêt auto")).queryByText("Versement ponctuel")).toBeNull();

    await user.click(within(card("Prêt auto")).getByRole("button", { name: "Archiver" }));
    expect(debt(app).archived).toBe(true);
    expect(screen.getByRole("heading", { name: "Archives" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restaurer" }));
    expect(debt(app).archived).toBe(false);
  });

  it("propose « Marquer soldée » quand le reste est nul", async () => {
    const user = userEvent.setup();
    const app = await openDebts([loan({ paidManual: 100_000 })]);
    const c = card("Prêt auto");
    const suggestion = within(c).getByText("Le reste dû est nul.").parentElement!;
    await user.click(within(suggestion).getByRole("button", { name: "Marquer soldée" }));
    expect(debt(app).settled).toBe(true);
  });
});

describe("configuration et création", () => {
  it("deux des trois montants donnent le troisième, et le champ calculé le dit (décision 41)", async () => {
    const user = userEvent.setup();
    const app = await openDebts([loan()]);
    const c = card("Prêt auto");
    const field = (label: string) => within(c).getByLabelText(label) as HTMLInputElement;
    // 5 × 200 € : le total saisi garde le montant par échéance et recalcule le nombre.
    await user.type(field("Montant total"), "1200");
    expect(field("Nombre d'échéances").value).toBe("6");
    expect(within(c).getByText("Calculé : total ÷ montant par échéance")).toBeTruthy();
    // Le champ modifié le moins récemment se recalcule : 1 200 € par 250 € → 5 échéances, la dernière de 200 €.
    await user.clear(field("Montant par échéance"));
    await user.type(field("Montant par échéance"), "250");
    expect(field("Nombre d'échéances").value).toBe("5");
    expect(within(c).getByText("Calculé · dernière échéance réduite à 200,00 €")).toBeTruthy();
    await user.click(within(c).getByRole("button", { name: "Enregistrer les modifications" }));
    await screen.findByText("Dette mise à jour");
    expect(debt(app)).toMatchObject({ principal: 120_000, installmentAmount: 25_000, installmentCount: 5 });
    expect(within(card("Prêt auto")).getByRole("button", { name: "Enregistrer les modifications" }).hasAttribute("disabled")).toBe(true);
    expect(within(card("Prêt auto")).queryByText(/^Calculé/)).toBeNull();
  });

  it("refuse un total supérieur à l'échéancier, saisi en remboursement libre", async () => {
    const user = userEvent.setup();
    const app = await openDebts([loan()]);
    const c = card("Prêt auto");
    const before = debt(app).updatedAt;
    // En remboursement libre, rien ne se calcule : le total reste celui saisi.
    await user.click(within(c).getByRole("radio", { name: "Libre" }));
    await user.type(within(c).getByLabelText("Montant total"), "1200");
    await user.click(within(c).getByRole("radio", { name: "Échéancier" }));
    await user.click(within(c).getByRole("button", { name: "Enregistrer les modifications" }));
    expect(within(c).getByText("Le total dépasse ce que couvrent les échéances.")).toBeTruthy();
    expect(debt(app).updatedAt).toBe(before);
  });

  it("le sens ne change plus dès qu'une opération est rattachée", async () => {
    const paid = createRecord<Operation>(
      "op-paid",
      { date: "2026-07-10", amount: 20_000, type: "out", note: "", categoryId: cat("Crédit"), accountId: accounts.courant.id, debtId: "debt-1" },
      1,
    );
    await openDebts([loan()], [paid]);
    const c = card("Prêt auto");
    expect(within(c).queryByRole("radiogroup", { name: "Sens de la dette" })).toBeNull();
    expect(within(c).getByText(/le sens ne change plus/)).toBeTruthy();
  });

  it("le formulaire de l'onglet crée une somme prêtée, sans échéancier", async () => {
    const user = userEvent.setup();
    const app = await openDebts([]);
    const form = screen.getByRole("heading", { name: "Nouvelle dette" }).closest("section")!;
    expect(within(form).getByText("Aucune dette en cours : ajoute la première ici.")).toBeTruthy();
    await user.click(within(form).getByRole("radio", { name: "On me doit" }));
    await user.type(within(form).getByLabelText("Intitulé"), "Avance à Sam");
    await user.type(within(form).getByLabelText("Personne ou organisme qui doit"), "Sam");
    await user.type(within(form).getByLabelText("Montant total"), "400");
    await user.click(within(form).getByRole("button", { name: "Créer la dette" }));
    await screen.findByText("Dette créée");
    const [created] = app.repository.data.collections.debts;
    expect(created).toMatchObject({
      name: "Avance à Sam",
      creditor: "Sam",
      direction: "lent",
      mode: "free",
      principal: 40_000,
      categoryId: null,
      accountId: accounts.courant.id,
    });
    expect(within(card("Avance à Sam")).getByText("Remboursement reçu")).toBeTruthy();
    // Le formulaire repart à vide.
    expect((within(screen.getByRole("heading", { name: "Nouvelle dette" }).closest("section")!).getByLabelText("Intitulé") as HTMLInputElement).value).toBe("");
  });

  it("la modale du menu Ajouter crée la dette et son prélèvement, puis bascule sur l'onglet", async () => {
    const user = userEvent.setup();
    const { store, repository } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    await user.click(screen.getByRole("menuitem", { name: "Dette" }));
    const dialog = await screen.findByRole("dialog", { name: "Nouvelle dette" });
    await user.type(within(dialog).getByLabelText("Intitulé"), "Prêt auto");
    await user.type(within(dialog).getByLabelText("Montant par échéance"), "200");
    await user.type(within(dialog).getByLabelText("Nombre d'échéances"), "5");
    // Le total se calcule : 5 × 200 €.
    expect((within(dialog).getByLabelText("Montant total") as HTMLInputElement).value).toBe("1000,00");
    expect(within(dialog).getByText("Calculé : montant × nombre d'échéances")).toBeTruthy();
    await user.clear(within(dialog).getByLabelText("Première échéance"));
    await user.type(within(dialog).getByLabelText("Première échéance"), "2026-10-10");
    await user.click(within(dialog).getByLabelText("Créer aussi le prélèvement mensuel"));
    await user.click(within(dialog).getByRole("button", { name: "Créer" }));
    await screen.findByText("Dette créée");
    const [created] = repository.data.collections.debts;
    expect(created).toMatchObject({ mode: "installments", installmentAmount: 20_000, installmentCount: 5, principal: 100_000, dayOfMonth: 10 });
    const rec = repository.data.collections.recurrences.find((r) => r.debtId === created!.id)!;
    expect(rec).toMatchObject({ startMonth: "2026-10", endMonth: "2027-02" });
    expect(store.getState().tab).toBe("debts");
  });
});
