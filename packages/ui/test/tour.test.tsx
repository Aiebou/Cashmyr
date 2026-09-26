import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { defaultCategories } from "../src/lib/data";
import { TOUR } from "../src/tour/steps";
import { accounts, renderApp } from "./helpers";

afterEach(cleanup);

const bubble = () => screen.queryByRole("dialog");
const step = () => {
  const d = screen.getByRole("dialog");
  return { title: within(d).getByRole("heading").textContent, count: d.querySelector("p")!.textContent, dialog: d };
};

describe("tutoriel (décisions 65 à 67)", () => {
  it("un profil neuf : le tableau de bord se présente étape par étape, sans rien modifier", async () => {
    const user = userEvent.setup();
    const { local, repository } = await renderApp({ tour: [] });
    const pending = repository.pending;
    const total = TOUR.dashboard.length;
    expect(step()).toMatchObject({ title: "Les sections", count: `1 / ${total}` });
    expect(within(step().dialog).queryByRole("button", { name: "Précédent" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Suivant" }));
    expect(step().title).toBe("Ajouter");
    expect(step().dialog.textContent).toContain("Raccourci : N.");
    await user.click(screen.getByRole("button", { name: "Précédent" }));
    expect(step().title).toBe("Les sections");

    for (let i = 1; i < total; i++) await user.click(screen.getByRole("button", { name: "Suivant" }));
    expect(step().title).toBe("Tes blocs");
    await user.click(screen.getByRole("button", { name: "Terminer" }));
    expect(bubble()).toBeNull();
    expect(local.device?.tour).toEqual({ seen: ["dashboard"] });
    // Mémoire de l'appareil : rien ne part en synchronisation.
    expect(repository.pending).toBe(pending);
  });

  it("chaque onglet à sa première visite ; « Passer » ne ferme que l'onglet en cours", async () => {
    const user = userEvent.setup();
    const { local, actions } = await renderApp({ tour: ["dashboard"] });
    expect(bubble()).toBeNull();

    act(() => actions.setTab("month"));
    expect(await screen.findByRole("heading", { name: "Le mois affiché" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Passer" }));
    await waitFor(() => expect(bubble()).toBeNull());
    expect(local.device?.tour).toEqual({ seen: ["dashboard", "month"] });

    act(() => actions.setTab("accounts"));
    expect(await screen.findByRole("heading", { name: "Le total de tes comptes" })).toBeTruthy();
    // Échap passe aussi.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(bubble()).toBeNull());

    act(() => actions.setTab("month"));
    expect(bubble()).toBeNull();
  });

  it("une étape dont l'élément n'est pas à l'écran est sautée", async () => {
    const { actions } = await renderApp({ tour: ["dashboard"] });
    // Aucun objectif : la carte d'un objectif n'existe pas.
    act(() => actions.setTab("goals"));
    const first = await screen.findByRole("dialog");
    expect(within(first).getByRole("heading").textContent).toBe("Épargne de précaution");
    expect(first.querySelector("p")!.textContent).toBe("1 / 2");
  });

  it("un profil d'avant le tutoriel ne le voit pas ; « Revoir le tutoriel » le relance", async () => {
    const user = userEvent.setup();
    const { local, actions } = await renderApp();
    for (const tab of ["dashboard", "month", "settings"] as const) {
      act(() => actions.setTab(tab));
      expect(bubble()).toBeNull();
    }
    await user.click(screen.getByRole("button", { name: "Revoir le tutoriel" }));
    expect(await screen.findByRole("heading", { name: "Les sections" })).toBeTruthy();
    expect(local.device?.tour).toEqual({ seen: [] });
  });

  it("il attend la fin de l'accueil pour commencer", async () => {
    const { repository } = await renderApp({ tour: [], seeded: false });
    expect(screen.getByRole("heading", { name: "Bienvenue" })).toBeTruthy();
    expect(bubble()).toBeNull();
    await act(() => repository.apply({ categories: defaultCategories(), accounts: [accounts.courant] }));
    expect(await screen.findByRole("heading", { name: "Les sections" })).toBeTruthy();
  });
});
