import type { AppUpdates, AvailableUpdate } from "@cashmyr/storage";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "./helpers";

afterEach(cleanup);

/** PWA simulée : le service worker annonce une version en attente quand le test le décide. */
function pwa() {
  const listeners = new Set<(u: AvailableUpdate) => void>();
  const ready = new Set<() => void>();
  const apply = vi.fn(async () => {});
  const updates: AppUpdates = {
    version: "0.1.0",
    onAvailable: (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    onOfflineReady: (cb) => (ready.add(cb), () => void ready.delete(cb)),
  };
  return {
    updates,
    apply,
    waiting: () => listeners.forEach((cb) => cb({ version: null, kind: "reload", apply })),
    offlineReady: () => ready.forEach((cb) => cb()),
  };
}

/** Bureau simulé : `check` répond ce que le test prépare. */
function desktop(answer: () => Promise<{ version: string } | null>) {
  const listeners = new Set<(u: AvailableUpdate) => void>();
  const apply = vi.fn(async () => {});
  const updates: AppUpdates = {
    version: "0.1.0",
    onAvailable: (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    check: async () => {
      const found = await answer();
      if (!found) return "none";
      listeners.forEach((cb) => cb({ version: found.version, kind: "restart", apply }));
      return "available";
    },
  };
  return { updates, apply };
}

const settingsCard = () => screen.getByRole("heading", { name: "Application", level: 3 }).closest("section")!;

describe("mise à jour de la PWA", () => {
  it("propose de recharger, sans forcer ; recharger termine d'abord les écritures locales", async () => {
    const sw = pwa();
    const app = await renderApp({ updates: sw.updates });
    const flush = vi.spyOn(app.local, "flush");
    expect(screen.queryByText("Nouvelle version disponible.")).toBeNull();

    act(() => sw.waiting());
    const banner = screen.getByText("Nouvelle version disponible.").closest("[role=status]") as HTMLElement;
    expect(sw.apply).not.toHaveBeenCalled();

    await userEvent.click(within(banner).getByRole("button", { name: "Recharger" }));
    expect(flush).toHaveBeenCalled();
    expect(sw.apply).toHaveBeenCalledTimes(1);
    expect(flush.mock.invocationCallOrder[0]!).toBeLessThan(sw.apply.mock.invocationCallOrder[0]!);
  });

  it("« Plus tard » ferme le bandeau ; Paramètres propose toujours de recharger", async () => {
    const sw = pwa();
    const app = await renderApp({ updates: sw.updates });
    act(() => sw.waiting());
    await userEvent.click(screen.getByRole("button", { name: "Plus tard" }));
    expect(screen.queryByText("Nouvelle version disponible.")).toBeNull();

    act(() => app.actions.setTab("settings"));
    const card = settingsCard();
    expect(within(card).getByText("Cashmyr, version 0.1.0")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Rechercher une mise à jour" })).toBeNull();
    await userEvent.click(within(card).getByRole("button", { name: "Recharger" }));
    expect(sw.apply).toHaveBeenCalledTimes(1);
  });

  it("dit quand l'application fonctionne hors ligne", async () => {
    const sw = pwa();
    await renderApp({ updates: sw.updates });
    act(() => sw.offlineReady());
    expect(screen.getByText(/fonctionne désormais hors ligne/)).toBeTruthy();
  });
});

describe("mise à jour du bureau", () => {
  it("ne vérifie que sur clic, et dit quand Cashmyr est à jour", async () => {
    const answer = vi.fn(async () => null);
    const app = await renderApp({ target: "desktop", updates: desktop(answer).updates });
    act(() => app.actions.setTab("settings"));
    expect(answer).not.toHaveBeenCalled();
    await userEvent.click(within(settingsCard()).getByRole("button", { name: "Rechercher une mise à jour" }));
    expect(answer).toHaveBeenCalledTimes(1);
    expect(within(settingsCard()).getByRole("status").textContent).toBe("Cashmyr est à jour.");
  });

  it("une vérification impossible le dit, sans rien casser", async () => {
    const app = await renderApp({
      target: "desktop",
      updates: desktop(async () => {
        throw new Error("hors ligne");
      }).updates,
    });
    act(() => app.actions.setTab("settings"));
    await userEvent.click(within(settingsCard()).getByRole("button", { name: "Rechercher une mise à jour" }));
    expect(within(settingsCard()).getByRole("alert").textContent).toContain("Vérification impossible (hors ligne)");
    expect(within(settingsCard()).getByRole("button", { name: "Rechercher une mise à jour" })).toBeTruthy();
  });

  it("une version trouvée s'installe sur demande ; un échec est affiché et le bouton revient", async () => {
    const d = desktop(async () => ({ version: "0.2.0" }));
    const app = await renderApp({ target: "desktop", updates: d.updates });
    act(() => app.actions.setTab("settings"));
    await userEvent.click(within(settingsCard()).getByRole("button", { name: "Rechercher une mise à jour" }));

    const banner = screen.getByText("Cashmyr 0.2.0 est disponible.", { selector: "p" }).closest("[role=status]") as HTMLElement;
    expect(within(settingsCard()).getByText("Cashmyr 0.2.0 est disponible.")).toBeTruthy();
    expect(d.apply).not.toHaveBeenCalled();

    d.apply.mockRejectedValueOnce(new Error("signature invalide"));
    await userEvent.click(within(banner).getByRole("button", { name: "Installer et redémarrer" }));
    expect(screen.getByText("La mise à jour n'a pas pu être appliquée : signature invalide")).toBeTruthy();
    const retry = within(banner).getByRole("button", { name: "Installer et redémarrer" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    await userEvent.click(retry);
    expect(d.apply).toHaveBeenCalledTimes(2);
  });
});
