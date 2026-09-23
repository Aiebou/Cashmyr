import { createRecord, type Operation } from "@cashmyr/core";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { dayLong } from "../src/lib/format";
import { defaultCategories } from "../src/lib/data";
import { accounts, renderApp } from "./helpers";

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
      screen.getByText("Total de mes comptes aujourd'hui"),
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

  it("vos comptes : solde, départ, entrés, sortis, valeur déclarée et écart", async () => {
    await openAccounts();
    const list = within(frame("Vos comptes")).getByRole("list");
    // 1 250 + 1 000 + 2 000 − 300 − 500 = 3 450 €.
    expect(plain(row(list, "Compte courant").textContent)).toBe("Compte courant3 450,00 €Départ 1 250,00 € · 3 000,00 € entrés · 800,00 € sortis");
    // Le type n'est pas répété quand le nom le dit ; la précaution est signalée.
    expect(plain(row(list, "Livret A").textContent)).toBe(
      "Livret AÉpargne · épargne de précaution3 500,00 €Départ 3 000,00 € · 500,00 € entrés · 0,00 € sortis" +
        "Valeur déclarée 3 900,00 € le 1er septembre 2026 · écart +400,00 € avec le capital injecté",
    );
  });

  it("année passée : soldes et mouvements au 31 décembre", async () => {
    const { store } = await openAccounts();
    act(() => store.getState().actions.setYear(2025));
    expect(screen.getByText("Total de mes comptes au 31 décembre 2025")).toBeTruthy();
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
