import { toLocalDay } from "@cashmyr/core";
import { LocalDataError, Repository, SyncEngine, type Platform, type SyncHooks } from "@cashmyr/storage";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RecoveryScreen } from "./screens/Recovery";
import { createAppStore, type AppActions } from "./store/app-store";

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

/** Questions posées par le moteur de synchronisation, dans une fenêtre de l'application. */
function syncHooks(ask: () => AppActions["ask"]): SyncHooks {
  return {
    confirmFirstJoin: ({ localRecords, fileRecords }) =>
      ask()({
        title: "Réunir les deux jeux de données ?",
        message:
          `Cet appareil a déjà ${plural(localRecords, "élément")} et le fichier en contient ${fileRecords}. ` +
          "Les deux seront réunis : ce qui a été saisi des deux côtés apparaîtra en double.",
        confirmLabel: "Réunir",
        cancelLabel: "Ne pas synchroniser",
      }),
    confirmDropPurged: (suspects) =>
      ask()({
        title: "Écarter les éléments supprimés ailleurs ?",
        message:
          `Cet appareil n'a pas été synchronisé depuis plus de six mois. ${plural(suspects.length, "élément")} ` +
          "ont sans doute été supprimés sur un autre appareil entre-temps.\n" +
          "Les écarter ici aussi, ou les garder et les renvoyer dans le fichier ?",
        confirmLabel: "Les écarter",
        cancelLabel: "Les garder",
      }),
  };
}

/**
 * Démarre l'application sur une plateforme donnée. Si les données locales sont refusées à
 * l'ouverture, affiche l'écran de secours à la place ; une restauration réussie relance tout.
 */
export async function startApp(
  platform: Platform,
  element: HTMLElement,
  options: { restart?: () => void } = {},
): Promise<void> {
  const today = () => toLocalDay(new Date());
  let repository: Repository;
  try {
    repository = await Repository.open({ local: platform.local, deviceLabel: platform.deviceLabel, today });
  } catch (e) {
    if (!(e instanceof LocalDataError)) throw e;
    const restart = options.restart ?? (() => window.location.reload());
    createRoot(element).render(
      <StrictMode>
        <RecoveryScreen platform={platform} problem={e} onRecovered={restart} />
      </StrictMode>,
    );
    return;
  }
  void platform.local.requestPersistence();
  // Le moteur naît avant le store qui affiche ses questions : celles-ci passent par une référence tardive.
  let ask: AppActions["ask"] = async () => false;
  const engine = new SyncEngine({ repository, sync: platform.sync, hooks: syncHooks(() => ask) });
  const store = createAppStore({ platform, repository, engine, today, ...(options.restart ? { restart: options.restart } : {}) });
  ask = store.getState().actions.ask;
  createRoot(element).render(
    <StrictMode>
      <App store={store} />
    </StrictMode>,
  );
  void engine.start().then((outcome) => {
    if (outcome?.kind === "failed") store.getState().actions.toast(outcome.error, "error");
  });
}
