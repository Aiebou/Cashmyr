import { toLocalDay } from "@cashmyr/core";
import {
  fileOwner,
  implicitRegistry,
  LocalDataError,
  Repository,
  setProfileFile,
  SyncEngine,
  type ProfileEntry,
  type ProfileHost,
  type SyncHooks,
} from "@cashmyr/storage";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ProfilePicker } from "./screens/ProfilePicker";
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
 * Démarre l'application. Avec plusieurs profils sur l'appareil, demande d'abord lequel ouvrir,
 * sauf s'il a été noté pour la session (changement de profil, rechargement) : décision 54.
 */
export async function startApp(
  host: ProfileHost,
  element: HTMLElement,
  options: { restart?: () => void; now?: () => number } = {},
): Promise<void> {
  const registry = await host.registry.read();
  const profiles = registry?.profiles ?? implicitRegistry({ syncFileId: null, checkUpdatesOnLaunch: true }).profiles;
  // La recherche au lancement ne dépend d'aucun profil (décision 59) ; sans registre, le seul profil la règle.
  const launchChecked = registry !== null;
  if (registry?.checkUpdatesOnLaunch && host.updates?.check) void host.updates.check().catch(() => undefined);

  const root = createRoot(element);
  const noted = profiles.find((p) => p.id === host.session.get());
  const chosen = profiles.length === 1 ? profiles[0] : noted;
  if (chosen) return openProfile(chosen);
  root.render(
    <StrictMode>
      <ProfilePicker
        profiles={profiles}
        onPick={(profile) => {
          host.session.set(profile.id);
          void openProfile(profile).catch((e: unknown) => root.render(<StartupError error={e} />));
        }}
      />
    </StrictMode>,
  );

  async function openProfile(profile: ProfileEntry): Promise<void> {
    const restart = options.restart ?? (() => window.location.reload());
    const platform = await host.open(profile);
    const today = () => toLocalDay(new Date());
    let repository: Repository;
    try {
      repository = await Repository.open({ local: platform.local, deviceLabel: platform.deviceLabel, today });
    } catch (e) {
      if (!(e instanceof LocalDataError)) throw e;
      root.render(
        <StrictMode>
          <RecoveryScreen
            platform={platform}
            problem={e}
            onRecovered={restart}
            {...(profiles.length > 1
              ? {
                  profileName: profile.name,
                  onSwitchProfile: () => {
                    host.session.set(null);
                    restart();
                  },
                }
              : {})}
          />
        </StrictMode>,
      );
      return;
    }
    void platform.local.requestPersistence();
    // Le moteur naît avant le store qui affiche ses questions : celles-ci passent par une référence tardive.
    let ask: AppActions["ask"] = async () => false;
    const engine = new SyncEngine({
      repository,
      sync: platform.sync,
      fileName: platform.syncFileName,
      hooks: { ...syncHooks(() => ask), ...fileHooks(host, profile.id) },
    });
    const store = createAppStore({
      platform,
      repository,
      engine,
      host,
      profiles: { list: profiles, current: profile, registered: registry !== null, registry },
      launchChecked,
      today,
      ...(options.restart ? { restart: options.restart } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
    ask = store.getState().actions.ask;
    root.render(
      <StrictMode>
        <App store={store} />
      </StrictMode>,
    );
    void engine.start().then((outcome) => {
      if (outcome?.kind === "failed") store.getState().actions.toast(outcome.error, "error");
    });
  }
}

/** Un fichier de synchronisation ne sert qu'à un profil de l'appareil (décision 57). */
function fileHooks(host: ProfileHost, profileId: string): Pick<SyncHooks, "fileOwner" | "fileChanged"> {
  return {
    fileOwner: async (fileId) => {
      const registry = await host.registry.read();
      return registry ? (fileOwner(registry, profileId, fileId)?.name ?? null) : null;
    },
    fileChanged: async (fileId) => {
      const registry = await host.registry.read();
      if (registry) await host.registry.write(setProfileFile(registry, profileId, fileId));
    },
  };
}

function StartupError({ error }: { error: unknown }) {
  return (
    <p style={{ maxWidth: 560, margin: "48px auto", padding: "0 16px", font: "16px/1.5 system-ui" }}>
      Cashmyr n'a pas pu démarrer : {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
