import { DEFAULT_CATEGORIES } from "@cashmyr/core";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { renderApp } from "./helpers";

afterEach(cleanup);

const plain = (text: string | null | undefined) => (text ?? "").replace(/[  ]/g, " ");

/** Export minimal au format de l'ancienne application. Données inventées. */
function legacyFile() {
  return {
    settings: {
      v: 2,
      cats: DEFAULT_CATEGORIES.map((c) => ({ id: c.legacy, kind: c.kind, name: c.name, ...(c.bucket ? { bucket: c.bucket } : {}) })),
      accounts: [{ id: "a1", name: "Compte courant", opening: 100, role: "courant", safety: false }],
      splits: { besoin: 0.5, envie: 0.3, invest: 0.2 },
      basis: "avg",
      window: 6,
      safety: { amount: 0, hidden: false, mode: "months", months: 4 },
      goals: [],
      debts: [] as Record<string, unknown>[],
      catColors: {},
      bucketColors: {},
      dashOrder: ["goals", "debts", "stats", "months", "savings", "cats"],
      recurring: [],
    },
    months: {
      "2026-09": {
        items: [{ id: "x1", d: "2026-09-02", t: "out", amt: 12.5, cat: "d12", acc: "a1", note: "Marché" }] as Record<string, unknown>[],
        skips: [] as string[],
      },
    } as Record<string, { items: Record<string, unknown>[]; skips: string[] }>,
  };
}

const openText = async () => ({ name: "mes-finances.json", content: JSON.stringify(legacyFile()) });

describe("reprise de l'ancienne application", () => {
  it("depuis l'accueil : résumé vérifié, confirmation, puis l'application s'ouvre", async () => {
    const user = userEvent.setup();
    const { repository } = await renderApp({ seeded: false, files: { openText } });
    await user.click(screen.getByRole("button", { name: "Importer un fichier" }));
    const d = await screen.findByRole("dialog", { name: "Reprendre « mes-finances.json » ?" });
    expect(plain(within(d).getByText(/^Ancienne application/).textContent)).toBe(
      "Ancienne application : 1 compte, 30 catégories et 1 opération.\n" +
        "Vérifié au centime près par un recalcul sur l'ancien fichier : les totaux de 1 mois et les soldes de 1 compte.",
    );
    await user.click(within(d).getByRole("button", { name: "Reprendre mes données" }));
    await screen.findByText("Données de l'ancienne application reprises");
    expect(screen.queryByRole("heading", { name: "Bienvenue" })).toBeNull();
    expect(repository.data.collections.operations).toEqual([expect.objectContaining({ amount: 1250, note: "Marché" })]);
  });

  it("la confirmation dit ce qui est laissé de côté : lien vers un élément supprimé, catégorie de dette (décisions 35 et 36)", async () => {
    const file = legacyFile();
    file.months["2026-09"]!.items[0]!.goal = "objectif-supprime";
    file.settings.debts.push({
      id: "dt1",
      name: "Dépannage",
      creditor: "",
      direction: "lent",
      principal: 150,
      paidManual: 0,
      mode: "free",
      installmentAmount: 0,
      installmentCount: 0,
      startDate: "2026-09-01",
      dayOfMonth: 1,
      categoryId: "d16",
      accountId: "a1",
      recurrenceId: null,
      hidden: false,
      pinned: false,
      settled: false,
      archived: false,
    });
    const user = userEvent.setup();
    const { repository } = await renderApp({
      seeded: false,
      files: { openText: async () => ({ name: "mes-finances.json", content: JSON.stringify(file) }) },
    });
    await user.click(screen.getByRole("button", { name: "Importer un fichier" }));
    const d = await screen.findByRole("dialog", { name: "Reprendre « mes-finances.json » ?" });
    const text = plain(within(d).getByText(/^Ancienne application/).textContent);
    expect(text).toContain("1 lien vers un élément supprimé est écarté, comme le faisait l'ancienne application : aucun total ne change.");
    expect(text).toContain("La dette « Dépannage » est reprise sans catégorie");
    await user.click(within(d).getByRole("button", { name: "Reprendre mes données" }));
    await screen.findByText("Données de l'ancienne application reprises");
    expect(repository.data.collections.debts[0]).toMatchObject({ name: "Dépannage", categoryId: null });
  });

  it("depuis les paramètres, sur un appareil déjà en service : n'ajoute que ce qui manque", async () => {
    const user = userEvent.setup();
    const { repository, actions } = await renderApp({ files: { openText } });
    act(() => actions.setTab("settings"));
    await user.click(screen.getByRole("button", { name: "Importer un fichier (JSON)" }));
    const d = await screen.findByRole("dialog", { name: "Reprendre « mes-finances.json » ?" });
    // Les catégories par défaut sont déjà là, les réglages ont les mêmes valeurs : seuls le compte et l'opération sont nouveaux.
    expect(plain(within(d).getByText(/^Ancienne application/).textContent)).toMatch(
      /\n2 lignes seront ajoutées\. Rien de ce que Cashmyr contient déjà n'est écrasé\.$/,
    );
    await user.click(within(d).getByRole("button", { name: "Reprendre mes données" }));
    await screen.findByText("Données de l'ancienne application reprises");
    // Les catégories par défaut et celles de l'ancien fichier sont les mêmes lignes.
    expect(repository.data.collections.categories).toHaveLength(30);

    await user.click(screen.getByRole("button", { name: "Importer un fichier (JSON)" }));
    expect(await screen.findByText("Rien de nouveau dans ce fichier : tout ce qu'il contient est déjà dans Cashmyr.")).toBeTruthy();
  });
});
