import { toLocalDay } from "@cashmyr/core";
import { Repository, SyncEngine, type Platform, type SyncHooks } from "@cashmyr/storage";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createAppStore } from "./store/app-store";

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

/** Questions posées par le moteur de synchronisation. */
const hooks: SyncHooks = {
  confirmFirstJoin: async ({ localRecords, fileRecords }) =>
    window.confirm(
      `Cet appareil a déjà ${plural(localRecords, "élément")} et le fichier en contient ${fileRecords}. ` +
        "Les deux seront réunis ; ce qui a été saisi des deux côtés apparaîtra en double. Continuer ?",
    ),
  confirmDropPurged: async (suspects) =>
    window.confirm(
      `Cet appareil n'a pas été synchronisé depuis plus de six mois. ${plural(suspects.length, "élément")} ` +
        "ont sans doute été supprimés sur un autre appareil entre-temps. Les écarter ici aussi ? " +
        "(Annuler les garde et les renvoie dans le fichier.)",
    ),
};

/** Démarre l'application sur une plateforme donnée. */
export async function startApp(platform: Platform, element: HTMLElement): Promise<void> {
  const today = () => toLocalDay(new Date());
  const repository = await Repository.open({ local: platform.local, deviceLabel: platform.deviceLabel, today });
  void platform.local.requestPersistence();
  const engine = new SyncEngine({ repository, sync: platform.sync, hooks });
  const store = createAppStore({ platform, repository, engine, today });
  createRoot(element).render(
    <StrictMode>
      <App store={store} />
    </StrictMode>,
  );
  void engine.start().then((outcome) => {
    if (outcome?.kind === "failed") store.getState().actions.toast(outcome.error, "error");
  });
}
