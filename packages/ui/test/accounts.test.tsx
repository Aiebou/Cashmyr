import { createRecord, type Account, type Operation } from "@cashmyr/core";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { dayLong } from "../src/lib/format";
import { defaultCategories } from "../src/lib/data";
import { accounts, bannerSection, renderApp } from "./helpers";

afterEach(cleanup);

const cats = defaultCategories();
const cat = (name: string) => cats.find((c) => c.name === name)!.id;
/** Espaces fines et insécables d'Intl ramenées à des espaces simples. */
const plain = (text: string | null | undefined) => (text ?? "").replace(/[  ]/g, " ");
const { courant, livret } = accounts;

let n = 0;
const op = (date: string, amount: number, type: Operation["type"], extra: Partial<Operation>): Operation =>
  createRecord<Operation>(`op-${++n}`, { date, amount, type, note: "", ...extra } as Omit<Operation, "id" | "updatedAt" | "deletedAt">, 1);

/** 2 000 € de salaire, 300 € de courses, 500 € versés au livret en 2026 ; 1 000 € de salaire fin 2025. */
const operations = () => [
  op("2025-12-28", 100_000, "in", { categoryId: cat("Salaire"), accountId: courant.id }),
  op("2026-03-28", 200_000, "in", { categoryId: cat("Salaire"), accountId: courant.id }),
  op("2026-04-09", 30_000, "out", { categoryId: cat("Courses"), accountId: courant.id }),
  op("2026-04-27", 50_000, "tx", { fromAccountId: courant.id, toAccountId: livret.id }),
];

async function openAccounts() {
  const app = await renderApp();
  await act(() => app.repository.apply({ operations: operations(), accounts: [{ ...livret, declaredValue: 390_000, declaredAt: "2026-09-01", updatedAt: 2 }] }));
  act(() => app.store.getState().actions.setTab("accounts"));
  return app;
}

const frame = (title: string) => screen.getByRole("heading", { name: title, level: 3 }).closest("section")!;
const row = (list: HTMLElement, name: string) => within(list).getAllByRole("listitem").find((li) => li.textContent?.includes(name))!;

describe("Mes comptes", () => {
  it("dans l'ordre : bandeau, les deux boutons, Mouvements de l'année, Vos comptes", async () => {
    await openAccounts();
    const order = [
      bannerSection("Total de mes comptes (valeurs déclarées) aujourd'hui"),
      screen.getByRole("button", { name: "Ajouter un compte" }),
      screen.getByRole("button", { name: "Nouveau transfert" }),
      screen.getByRole("heading", { name: "Mouvements de l'année" }),
      screen.getByRole("heading", { name: "Vos comptes" }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByText(/Transférer entre deux comptes/)).toBeNull();
  });

  it("« Ajouter un compte » ouvre la création courte, « Nouveau transfert » la saisie en Transfert", async () => {
    const user = userEvent.setup();
    await openAccounts();
    await user.click(screen.getByRole("button", { name: "Ajouter un compte" }));
    expect(await screen.findByRole("dialog", { name: "Nouveau compte" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Nouveau transfert" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: "Transfert" }).getAttribute("aria-checked")).toBe("true");
  });

  it("mouvements de l'année : entrées et sorties par compte, transferts compris, sans l'année précédente", async () => {
    await openAccounts();
    const flows = within(frame("Mouvements de l'année")).getByRole("list");
    // Courant : 2 000 € entrés ; 300 € de courses et 500 € vers le livret sortis.
    expect(plain(row(flows, "Compte courant").textContent)).toBe("Compte courant+1 200,00 €Sorties 800,00 €Entrées 2 000,00 €");
    expect(plain(row(flows, "Livret A").textContent)).toBe("Livret A+500,00 €Sorties 0,00 €Entrées 500,00 €");
    expect(plain(frame("Mouvements de l'année").textContent)).toContain("Variation de l'ensemble depuis le 1er janvier : +1 700,00 €");
  });

  it("vos comptes : solde, départ, entrés, sortis ; valeur déclarée en avant, capital injecté dessous", async () => {
    await openAccounts();
    const list = within(frame("Vos comptes")).getByRole("list");
    // 1 250 + 1 000 + 2 000 − 300 − 500 = 3 450 €.
    expect(plain(row(list, "Compte courant").textContent)).toBe("Compte courant3 450,00 €Départ 1 250,00 € · 3 000,00 € entrés · 800,00 € sortis");
    // Le type n'est pas répété quand le nom le dit ; la précaution est signalée.
    expect(plain(row(list, "Livret A").textContent)).toBe(
      "Livret AÉpargne · épargne de précaution3 900,00 €valeur déclarée" +
        "Capital injecté 3 500,00 € · écart +400,00 € · déclarée le 1er septembre 2026" +
        "Départ 3 000,00 € · 500,00 € entrés · 0,00 € sortis",
    );
  });

  it("filtre par type de compte, propre à l'appareil : les deux listes suivent, pas le bandeau", async () => {
    const user = userEvent.setup();
    const { repository, local } = await openAccounts();
    const pea = createRecord<Account>("acc-pea", { name: "PEA", role: "invest", opening: 80_000, safety: false, color: 2 }, 1);
    await act(() => repository.apply({ accounts: [pea] }));
    const pending = repository.pending;
    const names = (title: string) => within(within(frame(title)).getByRole("list")).getAllByRole("listitem").map((li) => li.textContent?.match(/^(Compte courant|Livret A|PEA)/)?.[1]);
    const chips = screen.getByRole("group", { name: "Types de comptes affichés" });
    // Seuls les types présents sont proposés.
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["Tous", "Comptes courants", "Épargne", "Placements"]);

    await user.click(within(chips).getByRole("button", { name: "Épargne" }));
    expect(names("Vos comptes")).toEqual(["Livret A"]);
    expect(names("Mouvements de l'année")).toEqual(["Livret A"]);
    expect(plain(frame("Mouvements de l'année").textContent)).toContain("Variation de ces comptes depuis le 1er janvier : +500,00 €");
    await user.click(within(chips).getByRole("button", { name: "Placements" }));
    expect(names("Vos comptes")).toEqual(["Livret A", "PEA"]);
    expect(within(chips).getByRole("button", { name: "Tous" }).getAttribute("aria-pressed")).toBe("false");
    // Le bandeau garde tous les comptes.
    expect(bannerSection("Total de mes comptes (valeurs déclarées) aujourd'hui").textContent).toContain("Compte courant");
    expect(local.device?.display?.accountRoles).toEqual(["epargne", "invest"]);
    expect(repository.pending).toBe(pending);

    await user.click(within(chips).getByRole("button", { name: "Tous" }));
    expect(names("Vos comptes")).toEqual(["Compte courant", "Livret A", "PEA"]);
  });

  it("l'ordre des comptes se modifie ici et vaut partout (décision 49)", async () => {
    const user = userEvent.setup();
    const { repository, store } = await openAccounts();
    expect(within(frame("Vos comptes")).queryByRole("button", { name: "Descendre « Compte courant »" })).toBeNull();
    await user.click(within(frame("Vos comptes")).getByRole("button", { name: "Modifier l'ordre" }));
    await user.click(within(frame("Vos comptes")).getByRole("button", { name: "Descendre « Compte courant »" }));
    const names = within(within(frame("Vos comptes")).getByRole("list"))
      .getAllByRole("listitem")
      .map((li) => li.textContent?.match(/^(Compte courant|Livret A)/)?.[1]);
    expect(names).toEqual(["Livret A", "Compte courant"]);
    expect(repository.data.collections.accounts.map((a) => [a.name, a.position])).toEqual([
      ["Compte courant", 2],
      ["Livret A", 1],
    ]);
    // Ailleurs aussi : la légende du bandeau et la saisie d'une opération.
    const legend = within(bannerSection("Total de mes comptes (valeurs déclarées) aujourd'hui")).getAllByRole("listitem");
    expect(legend[0]!.textContent).toMatch(/^Livret A/);
    act(() => store.getState().actions.openModal({ kind: "operation", type: "out" }));
    const dialog = await screen.findByRole("dialog", { name: "Nouvelle opération" });
    expect(within(within(dialog).getByLabelText("Compte")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Livret A", "Compte courant"]);
  });

  it("un compte épargne, placement ou autre sans valeur déclarée le signale", async () => {
    const { repository, store } = await openAccounts();
    const pea = createRecord<Account>("acc-pea", { name: "PEA", role: "invest", opening: 80_000, safety: false, color: 2 }, 1);
    await act(() => repository.apply({ accounts: [pea] }));
    const list = within(frame("Vos comptes")).getByRole("list");
    expect(plain(row(list, "PEA").textContent)).toBe("PEAPlacement800,00 €valeur non déclaréeDépart 800,00 € · 0,00 € entrés · 0,00 € sortis");
    // Au 31 décembre 2025, le livret déclaré en septembre 2026 compte pour son capital injecté.
    act(() => store.getState().actions.setYear(2025));
    expect(plain(row(within(frame("Vos comptes")).getByRole("list"), "Livret A").textContent)).toContain("valeur déclarée après cette date");
  });

  it("année passée : soldes et mouvements au 31 décembre", async () => {
    const { store } = await openAccounts();
    act(() => store.getState().actions.setYear(2025));
    expect(bannerSection("Total de mes comptes (valeurs déclarées) au 31 décembre 2025")).toBeTruthy();
    expect(within(frame("Vos comptes")).getByText("Soldes au 31 décembre 2025")).toBeTruthy();
    const flows = within(frame("Mouvements de l'année")).getByRole("list");
    expect(plain(row(flows, "Compte courant").textContent)).toBe("Compte courant+1 000,00 €Sorties 0,00 €Entrées 1 000,00 €");
    expect(plain(frame("Mouvements de l'année").textContent)).toContain("Variation de l'ensemble sur 2025 : +1 000,00 €");
  });

  it("année à venir : rien n'a encore bougé", async () => {
    const { store } = await openAccounts();
    act(() => store.getState().actions.setYear(2027));
    expect(within(frame("Mouvements de l'année")).getByText("L'année 2027 n'a pas encore commencé.")).toBeTruthy();
  });

  it("un seul compte : pas de transfert possible", async () => {
    const { repository, store } = await renderApp();
    await act(() => repository.apply({ accounts: [{ ...livret, deletedAt: 5, updatedAt: 5 }] }));
    act(() => store.getState().actions.setTab("accounts"));
    expect(screen.getByRole("button", { name: "Nouveau transfert" }).hasAttribute("disabled")).toBe(true);
  });

  it("le premier du mois s'écrit « 1er »", () => {
    expect(dayLong("2026-09-01")).toBe("1er septembre 2026");
    expect(dayLong("2026-09-11")).toBe("11 septembre 2026");
  });
});
