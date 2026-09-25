import { defaultPreferences } from "@cashmyr/core";
import { addProfile, implicitRegistry, PRINCIPAL, setProfileFile, type AppUpdates, type ProfileRegistry } from "@cashmyr/storage";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startApp } from "../src/boot";
import { defaultCategories } from "../src/lib/data";
import { accounts, MemoryProfileHost, NOW, renderApp } from "./helpers";

afterEach(() => {
  cleanup();
  // Les écrans montés par startApp ne passent pas par render : on vide la page à la main.
  document.body.replaceChildren();
});

const FOYER = "0b7e2f4c-1d2a-4c3b-9e8f-7a6b5c4d3e2f";

/** Deux profils : « Mon budget » et « Foyer », le fichier de chacun noté ou non. */
function twoProfiles(files: { principal?: string; foyer?: string } = {}, checkUpdatesOnLaunch = true): ProfileRegistry {
  let registry = addProfile(implicitRegistry({ syncFileId: files.principal ?? null, checkUpdatesOnLaunch }), { id: FOYER, name: "Foyer" }, NOW);
  if (files.foyer) registry = setProfileFile(registry, FOYER, files.foyer);
  return registry;
}

const settingsCard = (title: string) => screen.getByRole("heading", { name: title, level: 3 }).closest("section")!;

async function openProfiles(options: Parameters<typeof renderApp>[0] = {}) {
  const restart = vi.fn();
  const app = await renderApp({ restart, ...options });
  act(() => app.actions.setTab("settings"));
  return { ...app, restart, card: settingsCard("Profils") };
}

/** Données d'un autre profil sur l'appareil : son jeu, et son fichier et ses modifications en attente. */
async function fillFoyer(host: MemoryProfileHost, sync: { fileId: string | null; dirty: number }) {
  const store = host.storeOf(FOYER);
  await store.apply({ categories: defaultCategories(), accounts: [accounts.courant] }, defaultPreferences());
  const dirty: Record<string, number> = {};
  for (let i = 0; i < sync.dirty; i++) dirty[`operations:op-${i}`] = NOW;
  store.device = {
    deviceId: "appareil-foyer",
    deviceLabel: "test",
    sync: { fileId: sync.fileId, targetName: sync.fileId ? "finances-sync-foyer.json" : null, lastMergeAt: null, lastOfferAt: null, lastError: null },
    dirty,
  };
}

describe("ouverture (décision 54)", () => {
  async function launch(host: MemoryProfileHost) {
    const restart = vi.fn();
    const element = document.body.appendChild(document.createElement("div"));
    await act(() => startApp(host, element, { restart, now: () => NOW }));
    return { restart };
  }
  const newHost = (updates?: AppUpdates) =>
    new MemoryProfileHost({
      target: "desktop",
      deviceLabel: "test",
      files: { saveAs: async () => true, openText: async () => null },
      shortcutHint: null,
      ...(updates ? { updates } : {}),
    });

  it("un seul profil : il s'ouvre directement, sans choix ni menu de profil", async () => {
    await launch(newHost());
    expect(screen.queryByRole("heading", { name: "Qui utilise Cashmyr ?" })).toBeNull();
    expect(await screen.findByRole("heading", { name: "Bienvenue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Changer de profil/ })).toBeNull();
  });

  it("plusieurs profils : « Qui utilise Cashmyr ? », puis le profil choisi, noté pour la session", async () => {
    const host = newHost();
    host.saved = twoProfiles();
    await launch(host);
    expect(screen.getByRole("heading", { name: "Qui utilise Cashmyr ?" })).toBeTruthy();
    const choices = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(choices).toEqual(["MMon budget", "FFoyer"]);
    await userEvent.click(screen.getByRole("button", { name: /Foyer/ }));
    expect(await screen.findByRole("heading", { name: "Bienvenue dans « Foyer »" })).toBeTruthy();
    expect(host.noted).toBe(FOYER);
    expect(screen.getByRole("button", { name: "Profil « Foyer ». Changer de profil" })).toBeTruthy();
  });

  it("un profil noté pour la session se rouvre sans repasser par le choix", async () => {
    const host = newHost();
    host.saved = twoProfiles();
    host.noted = FOYER;
    await launch(host);
    expect(screen.queryByRole("heading", { name: "Qui utilise Cashmyr ?" })).toBeNull();
    expect(await screen.findByRole("heading", { name: "Bienvenue dans « Foyer »" })).toBeTruthy();
  });

  it("la recherche de mise à jour part avant le choix, selon le réglage de l'appareil (décision 59)", async () => {
    const check = vi.fn(async () => "none" as const);
    const updates: AppUpdates = { version: "0.3.0", onAvailable: () => () => undefined, check };
    const on = newHost(updates);
    on.saved = twoProfiles();
    await launch(on);
    expect(screen.getByRole("heading", { name: "Qui utilise Cashmyr ?" })).toBeTruthy();
    expect(check).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: /Foyer/ }));
    await screen.findByRole("heading", { name: "Bienvenue dans « Foyer »" });
    expect(check).toHaveBeenCalledTimes(1);

    cleanup();
    document.body.replaceChildren();
    check.mockClear();
    const off = newHost(updates);
    off.saved = twoProfiles({}, false);
    await launch(off);
    expect(check).not.toHaveBeenCalled();
  });
});

describe("Paramètres → Profils", () => {
  it("un seul profil : « Mon budget », ouvert, sans suppression", async () => {
    const { card } = await openProfiles();
    expect(within(card).getByRole("textbox", { name: "Nom du profil « Mon budget »" })).toBeTruthy();
    expect(within(card).getByText("Ouvert")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /Supprimer le profil/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Changer de profil/ })).toBeNull();
  });

  it("créer le deuxième profil : « Mon budget » peut être renommé, puis le nouveau s'ouvre", async () => {
    const user = userEvent.setup();
    const { card, host, restart } = await openProfiles();
    await user.click(within(card).getByRole("button", { name: "Nouveau profil…" }));
    const dialog = screen.getByRole("dialog", { name: "Nouveau profil" });
    await user.type(within(dialog).getByLabelText("Nom du nouveau profil"), "Foyer");
    const first = within(dialog).getByLabelText("Nom de ce profil-ci");
    expect((first as HTMLInputElement).value).toBe("Mon budget");
    await user.clear(first);
    await user.type(first, "Alice");
    await user.click(within(dialog).getByRole("button", { name: "Créer et ouvrir" }));

    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    const [principal, foyer] = host.saved!.profiles;
    expect(principal).toMatchObject({ id: PRINCIPAL, name: "Alice" });
    expect(foyer).toMatchObject({ name: "Foyer", syncFileId: null });
    expect(host.prepared).toEqual([foyer!.id]);
    expect(host.noted).toBe(foyer!.id);
  });

  it("un nom déjà pris est refusé dans la fenêtre, sans rien écrire", async () => {
    const user = userEvent.setup();
    const { card, host, restart } = await openProfiles({ registry: twoProfiles() });
    await user.click(within(card).getByRole("button", { name: "Nouveau profil…" }));
    const dialog = screen.getByRole("dialog", { name: "Nouveau profil" });
    // Le registre existe déjà : plus de champ pour renommer « Mon budget ».
    expect(within(dialog).queryByLabelText("Nom de ce profil-ci")).toBeNull();
    await user.type(within(dialog).getByLabelText("Nom du nouveau profil"), "foyer");
    await user.click(within(dialog).getByRole("button", { name: "Créer et ouvrir" }));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "Le profil « Foyer » existe déjà sur cet appareil.");
    expect(host.saved!.profiles).toHaveLength(2);
    expect(restart).not.toHaveBeenCalled();
  });

  it("renommer sur place ; un nom pris revient à l'ancien", async () => {
    const user = userEvent.setup();
    const { card, host } = await openProfiles({ registry: twoProfiles() });
    const field = within(card).getByRole("textbox", { name: "Nom du profil « Foyer »" });
    await user.clear(field);
    await user.type(field, "Maison{Enter}");
    await waitFor(() => expect(host.saved!.profiles[1]!.name).toBe("Maison"));

    const again = within(card).getByRole("textbox", { name: "Nom du profil « Maison »" });
    await user.clear(again);
    await user.type(again, "MON BUDGET{Enter}");
    expect(await screen.findByText("Le profil « Mon budget » existe déjà sur cet appareil.")).toBeTruthy();
    await waitFor(() => expect((within(card).getByRole("textbox", { name: "Nom du profil « Maison »" }) as HTMLInputElement).value).toBe("Maison"));
  });

  it("en-tête : le profil ouvert, et les autres à un clic, une fois envoyé ce qui attend", async () => {
    const user = userEvent.setup();
    const { host, restart, local } = await openProfiles({ registry: twoProfiles() });
    const flush = vi.spyOn(local, "flush");
    await user.click(screen.getByRole("button", { name: "Profil « Mon budget ». Changer de profil" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Foyer", "Gérer les profils"]);
    await user.click(within(menu).getByRole("menuitem", { name: "Foyer" }));
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    expect(flush).toHaveBeenCalled();
    expect(host.noted).toBe(FOYER);
  });

  it("recherche au lancement : réglage de l'appareil, dans le registre (décision 59)", async () => {
    const user = userEvent.setup();
    const updates: AppUpdates = { version: "0.3.0", onAvailable: () => () => undefined, check: async () => "none" };
    const { host, local } = await openProfiles({ registry: twoProfiles(), target: "desktop", updates });
    const box = within(settingsCard("Application")).getByRole("checkbox", { name: "Rechercher une mise à jour au lancement" });
    expect((box as HTMLInputElement).checked).toBe(true);
    await user.click(box);
    await waitFor(() => expect(host.saved!.checkUpdatesOnLaunch).toBe(false));
    expect(local.device?.display?.checkUpdatesOnLaunch).toBeUndefined();
  });

  it("remise à zéro : les libellés nomment le profil ouvert", async () => {
    await openProfiles({ registry: twoProfiles() });
    const card = settingsCard("Remise à zéro");
    expect(within(card).getByRole("button", { name: "Effacer « Mon budget » sur cet appareil…" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Tout effacer dans « Mon budget », partout…" })).toBeTruthy();
  });
});

describe("supprimer un profil (décisions 56, 58 et 61)", () => {
  it("un autre profil à jour dans son fichier : simple confirmation, il quitte l'appareil", async () => {
    const user = userEvent.setup();
    const { card, host, restart } = await openProfiles({ registry: twoProfiles({ foyer: "fichier-foyer" }) });
    await fillFoyer(host, { fileId: "fichier-foyer", dirty: 0 });
    await user.click(within(card).getByRole("button", { name: "Supprimer le profil « Foyer »" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer « Foyer » de cet appareil ?" });
    expect(dialog.textContent).toContain("Son fichier de synchronisation (finances-sync-foyer.json) et tes autres appareils ne changent pas");
    await user.click(within(dialog).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(host.removed).toEqual([FOYER]));
    expect(host.saved!.profiles.map((p) => p.id)).toEqual([PRINCIPAL]);
    expect(restart).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(card).queryByRole("textbox", { name: "Nom du profil « Foyer »" })).toBeNull();
  });

  it("un autre profil avec des modifications à envoyer : l'ouvrir, ou le supprimer quand même", async () => {
    const user = userEvent.setup();
    const { card, host, restart } = await openProfiles({ registry: twoProfiles({ foyer: "fichier-foyer" }) });
    await fillFoyer(host, { fileId: "fichier-foyer", dirty: 3 });
    await user.click(within(card).getByRole("button", { name: "Supprimer le profil « Foyer »" }));
    let dialog = await screen.findByRole("dialog", { name: "« Foyer » a des modifications à envoyer" });
    expect(dialog.textContent).toContain("3 modifications de ce profil ne sont pas encore dans son fichier");

    await user.click(within(dialog).getByRole("button", { name: "Ouvrir « Foyer »" }));
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    expect(host.noted).toBe(FOYER);
    expect(host.removed).toEqual([]);

    act(() => host.session.set(null));
    await user.click(within(card).getByRole("button", { name: "Supprimer le profil « Foyer »" }));
    dialog = await screen.findByRole("dialog", { name: "« Foyer » a des modifications à envoyer" });
    await user.click(within(dialog).getByRole("button", { name: "Supprimer quand même…" }));
    dialog = screen.getByRole("dialog", { name: "Supprimer « Foyer » de cet appareil ?" });
    expect(dialog.textContent).toContain("3 modifications de ce profil ne sont pas encore dans son fichier de synchronisation : elles disparaîtront avec lui.");
    const confirm = within(dialog).getByRole("button", { name: "Supprimer définitivement" });
    expect(confirm).toHaveProperty("disabled", true);
    await user.type(within(dialog).getByLabelText("Pour confirmer, tape le nom du profil : Foyer"), "Foyer");
    await user.click(confirm);
    await waitFor(() => expect(host.removed).toEqual([FOYER]));
  });

  it("le profil ouvert, sans fichier : sauvegarde proposée, nom à taper, puis relance", async () => {
    const user = userEvent.setup();
    const saveAs = vi.fn(async () => true);
    const { card, host, restart } = await openProfiles({ registry: twoProfiles(), files: { saveAs } });
    host.noted = PRINCIPAL;
    await user.click(within(card).getByRole("button", { name: "Supprimer le profil « Mon budget »" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer « Mon budget » de cet appareil ?" });
    expect(dialog.textContent).toContain("Ce profil n'a pas de fichier de synchronisation : ses données ne sont que sur cet appareil");
    expect(dialog.textContent).toContain("Cashmyr se relance ensuite.");

    await user.click(within(dialog).getByRole("button", { name: "Enregistrer une sauvegarde" }));
    expect(saveAs).toHaveBeenCalledWith("cashmyr-sauvegarde-2026-09-23.json", "application/json", expect.stringContaining('"accounts"'));

    await user.type(within(dialog).getByLabelText("Pour confirmer, tape le nom du profil : Mon budget"), "Mon budge");
    expect(within(dialog).getByRole("button", { name: "Supprimer définitivement" })).toHaveProperty("disabled", true);
    await user.type(within(dialog).getByLabelText("Pour confirmer, tape le nom du profil : Mon budget"), "t");
    await user.click(within(dialog).getByRole("button", { name: "Supprimer définitivement" }));
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    expect(host.removed).toEqual([PRINCIPAL]);
    expect(host.saved!.profiles.map((p) => p.id)).toEqual([FOYER]);
    expect(host.noted).toBeNull();
  });

  it("un profil vide se supprime sur simple confirmation", async () => {
    const user = userEvent.setup();
    const { card, host } = await openProfiles({ registry: twoProfiles() });
    await user.click(within(card).getByRole("button", { name: "Supprimer le profil « Foyer »" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer « Foyer » de cet appareil ?" });
    expect(dialog.textContent).toContain("Ce profil ne contient aucune donnée");
    await user.click(within(dialog).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(host.removed).toEqual([FOYER]));
  });
});
