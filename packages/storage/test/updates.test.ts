import { describe, expect, it, vi } from "vitest";
import type { AvailableUpdate } from "../src";
import { createTauriUpdates } from "../src/tauri/updates";
import { createPwaUpdates, type RegisterSW } from "../src/web/updates";

/** Service worker simulé : les rappels de `registerSW` se déclenchent à la main. */
function fakeServiceWorker() {
  let options: Parameters<RegisterSW>[0] = {};
  const updateServiceWorker = vi.fn(async (_reload?: boolean) => {});
  const register: RegisterSW = (o) => {
    options = o;
    return updateServiceWorker;
  };
  return { register, updateServiceWorker, options: () => options };
}

describe("PWA : service worker en mode « prompt »", () => {
  it("s'enregistre tout de suite et ne propose rien tant qu'aucune version n'attend", () => {
    const sw = fakeServiceWorker();
    const updates = createPwaUpdates(sw.register, "0.1.0");
    const seen: AvailableUpdate[] = [];
    updates.onAvailable((u) => seen.push(u));
    expect(sw.options().immediate).toBe(true);
    expect(updates.version).toBe("0.1.0");
    expect(seen).toEqual([]);
    expect(updates.check).toBeUndefined();
  });

  it("annonce la version en attente, y compris à un abonné tardif, et recharge sur demande seulement", async () => {
    const sw = fakeServiceWorker();
    const updates = createPwaUpdates(sw.register, "0.1.0");
    const early: AvailableUpdate[] = [];
    updates.onAvailable((u) => early.push(u));
    sw.options().onNeedRefresh!();
    const late: AvailableUpdate[] = [];
    updates.onAvailable((u) => late.push(u));
    expect(early).toHaveLength(1);
    expect(late).toHaveLength(1);
    expect(early[0]).toMatchObject({ version: null, kind: "reload" });
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();
    await early[0]!.apply();
    expect(sw.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it("dit quand l'application est prête hors ligne", () => {
    const sw = fakeServiceWorker();
    const updates = createPwaUpdates(sw.register, "0.1.0");
    const ready = vi.fn();
    const stop = updates.onOfflineReady!(ready);
    sw.options().onOfflineReady!();
    expect(ready).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    updates.onOfflineReady!(late);
    expect(late).toHaveBeenCalledTimes(1);
    stop();
    sw.options().onOfflineReady!();
    expect(ready).toHaveBeenCalledTimes(1);
  });
});

describe("Bureau : updater sur demande", () => {
  it("à jour : rien n'est annoncé", async () => {
    const updater = { check: vi.fn(async () => null), relaunch: vi.fn(async () => {}) };
    const updates = createTauriUpdates(updater, "0.1.0");
    const seen = vi.fn();
    updates.onAvailable(seen);
    expect(await updates.check!()).toBe("none");
    expect(seen).not.toHaveBeenCalled();
    expect(updates.onOfflineReady).toBeUndefined();
  });

  it("ne vérifie jamais de lui-même", () => {
    const updater = { check: vi.fn(async () => null), relaunch: vi.fn(async () => {}) };
    const updates = createTauriUpdates(updater, "0.1.0");
    updates.onAvailable(() => {});
    expect(updater.check).not.toHaveBeenCalled();
  });

  it("une version trouvée est annoncée ; l'appliquer installe puis redémarre, dans cet ordre", async () => {
    const steps: string[] = [];
    const updater = {
      check: async () => ({ version: "0.2.0", downloadAndInstall: async () => void steps.push("installe") }),
      relaunch: async () => void steps.push("redémarre"),
    };
    const updates = createTauriUpdates(updater, "0.1.0");
    const seen: AvailableUpdate[] = [];
    updates.onAvailable((u) => seen.push(u));
    expect(await updates.check!()).toBe("available");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ version: "0.2.0", kind: "restart" });
    expect(steps).toEqual([]);
    await seen[0]!.apply();
    expect(steps).toEqual(["installe", "redémarre"]);
  });

  it("une installation qui échoue ne redémarre pas", async () => {
    const relaunch = vi.fn(async () => {});
    const updater = {
      check: async () => ({
        version: "0.2.0",
        downloadAndInstall: async () => {
          throw new Error("signature invalide");
        },
      }),
      relaunch,
    };
    const updates = createTauriUpdates(updater, "0.1.0");
    let update: AvailableUpdate | null = null;
    updates.onAvailable((u) => (update = u));
    await updates.check!();
    await expect(update!.apply()).rejects.toThrow("signature invalide");
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("une vérification impossible remonte l'erreur", async () => {
    const updater = {
      check: async () => {
        throw new Error("hors ligne");
      },
      relaunch: async () => {},
    };
    await expect(createTauriUpdates(updater, "0.1.0").check!()).rejects.toThrow("hors ligne");
  });
});
