import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "./helpers";

/** jsdom n'a pas `matchMedia` : sans lui, l'application se comporte comme sur un écran étroit. */
function screenWidth(wide: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: wide && query === "(min-width: 980px)", media: query, addEventListener() {}, removeEventListener() {} })),
  );
}

beforeEach(() => screenWidth(true));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const side = () => screen.getByRole("navigation", { name: "Sections" });

describe("menu latéral (grand écran)", () => {
  it("les onglets passent dans le menu, les sections de Paramètres s'y ajoutent quand il est ouvert", async () => {
    const user = userEvent.setup();
    await renderApp();
    expect(side().id).toBe("menu-lateral");
    expect(screen.getAllByRole("navigation", { name: "Sections" })).toHaveLength(1);
    expect(within(side()).getByRole("button", { name: "Tableau de bord" }).getAttribute("aria-current")).toBe("page");
    expect(within(side()).queryByRole("link")).toBeNull();
    // La période reste dans l'en-tête.
    expect(screen.getByRole("group", { name: "Année affichée" })).toBeTruthy();

    await user.click(within(side()).getByRole("button", { name: "Paramètres" }));
    const sections = within(side()).getByRole("list", { name: "Sections des paramètres" });
    expect(within(sections).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toContainEqual([
      "Catégories",
      "#reglages-categories",
    ]);
    expect(within(sections).getAllByRole("link")).toHaveLength(10);
  });

  it("☰ replie le menu, choix propre à l'appareil, jamais synchronisé", async () => {
    const user = userEvent.setup();
    const { repository } = await renderApp();
    const pending = repository.pending;
    await user.click(screen.getByRole("button", { name: "Masquer le menu" }));
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
    expect(repository.device.display?.sideNavCollapsed).toBe(true);
    expect(repository.pending).toBe(pending);
    const toggle = screen.getByRole("button", { name: "Afficher le menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Replié, le bouton tient lieu de sections pour le tutoriel.
    expect(toggle.getAttribute("data-tour")).toBe("tabs");
    await user.click(toggle);
    expect(side()).toBeTruthy();
  });

  it("un menu replié le reste au lancement suivant", async () => {
    await renderApp({ display: { sideNavCollapsed: true } });
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
    expect(screen.getByRole("button", { name: "Afficher le menu" })).toBeTruthy();
  });

  it("écran étroit : les onglets en haut, sans ☰", async () => {
    screenWidth(false);
    await renderApp();
    expect(side().id).toBe("");
    expect(screen.queryByRole("button", { name: /le menu$/ })).toBeNull();
  });

  it("l'écran d'accueil n'a pas de menu", async () => {
    await renderApp({ seeded: false });
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
    expect(screen.queryByRole("button", { name: /le menu$/ })).toBeNull();
  });
});
