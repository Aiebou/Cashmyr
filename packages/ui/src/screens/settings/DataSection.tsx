import { restoreEverywhere, serializeBackup, toLocalDay, type RestoreResult } from "@cashmyr/core";
import type { SetAsideInfo, SnapshotInfo } from "@cashmyr/storage";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/controls";
import { RestoreIcon } from "../../components/icons";
import { Card } from "../../components/layout";
import { operationsCsv } from "../../lib/export";
import { count, fileSize, stamp } from "../../lib/format";
import { importFromFile } from "../../lib/import";
import type { AppStore } from "../../store/app-store";
import { useActions, useApp, useStoreApi } from "../../store/context";
import s from "./Settings.module.css";

/** Export, import, copies de sauvegarde. */
export function DataSection() {
  const store = useStoreApi();
  const platform = useApp((st) => st.platform);
  const today = useApp((st) => st.today);
  const { toast, ask } = useActions();
  const [snapshots, setSnapshots] = useState<SnapshotInfo[] | null>(null);
  const [setAside, setSetAside] = useState<SetAsideInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSnapshots(await platform.local.listSnapshots());
    } catch {
      setSnapshots([]);
    }
    try {
      setSetAside(await platform.local.listSetAside());
    } catch {
      setSetAside([]);
    }
  }, [platform]);
  useEffect(() => void refresh(), [refresh]);

  const save = async (name: string, mime: string, content: string, message: string) => {
    if (await platform.files.saveAs(name, mime, content)) toast(message);
  };

  // Décision 40 : les versions abîmées gardées par l'écran de secours.
  const saveSetAside = async (v: SetAsideInfo) => {
    const content = await platform.local.readSetAside(v.id);
    const day = toLocalDay(new Date(v.setAsideAt));
    await save(`cashmyr-version-abimee-${day}.json`, "application/json", content, "Version abîmée enregistrée");
  };
  const removeSetAside = async (v: SetAsideInfo) => {
    const ok = await ask({
      title: "Supprimer cette version abîmée ?",
      message: `La version mise de côté le ${stamp(v.setAsideAt)} sera effacée de cet appareil. Enregistre-la d'abord si tu veux la garder.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await platform.local.removeSetAside(v.id);
    toast("Version abîmée supprimée");
    void refresh();
  };

  // Décision 33 : restaurer une copie la fait gagner partout.
  const restore = async (snap: SnapshotInfo) => {
    setBusy(true);
    try {
      await restoreSnapshot(store, snap);
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <>
      <Card title="Exporter et importer" subtitle="Les fichiers exportés contiennent toutes tes données : garde-les en lieu sûr.">
        <div className={s.actions}>
          <Button
            onClick={() =>
              save(`cashmyr-sauvegarde-${today}.json`, "application/json", serializeBackup(store.getState().data), "Sauvegarde exportée")
            }
          >
            Exporter une sauvegarde (JSON)
          </Button>
          <Button onClick={() => save(`cashmyr-operations-${today}.csv`, "text/csv", operationsCsv(store.getState().data), "Opérations exportées")}>
            Exporter les opérations (CSV)
          </Button>
          <Button onClick={() => importFromFile(store)}>Importer un fichier (JSON)</Button>
        </div>
        <p className={s.muted}>
          L'import accepte une sauvegarde JSON de Cashmyr, un fichier finances-sync.json ou l'export de l'ancienne application
          (mes-finances.json), et les fusionne avec cet appareil sans rien écraser de plus récent. Le CSV reprend les colonnes de
          l'ancienne application, pour un tableur.
        </p>
      </Card>
      <Card
        title="Copies de sauvegarde"
        subtitle="Une copie est prise à chaque ouverture ; les cinq dernières sont gardées sur cet appareil."
      >
        {snapshots === null ? (
          <p className={s.muted}>Chargement…</p>
        ) : snapshots.length === 0 ? (
          <p className={s.muted}>Aucune copie pour l'instant.</p>
        ) : (
          <ul className={s.list}>
            {snapshots.map((snap) => (
              <li key={snap.id} className={s.snapshot}>
                <span>
                  Copie du {stamp(snap.takenAt)} <span className={s.muted}>· {fileSize(snap.bytes)}</span>
                </span>
                <Button size="small" variant="ghost" disabled={busy} onClick={() => restore(snap)} aria-label={`Restaurer la copie du ${stamp(snap.takenAt)}`}>
                  <RestoreIcon size={16} />
                  Restaurer
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className={s.muted}>
          Restaurer une copie la fait gagner sur tous tes appareils : ce qui a été saisi depuis est supprimé partout. Une copie de l'état
          actuel est prise juste avant.
        </p>
      </Card>
      {setAside.length > 0 && (
        <Card title="Versions abîmées mises de côté" subtitle="Gardées par l'écran de secours, quand les données de cet appareil n'ont pas pu être ouvertes.">
          <ul className={s.list}>
            {setAside.map((v) => (
              <li key={v.id} className={s.snapshot}>
                <span>
                  Mise de côté le {stamp(v.setAsideAt)} <span className={s.muted}>· {fileSize(v.bytes)}</span>
                </span>
                <span className={s.actions}>
                  <Button size="small" variant="ghost" onClick={() => void saveSetAside(v)} aria-label={`Enregistrer la version mise de côté le ${stamp(v.setAsideAt)}`}>
                    Enregistrer
                  </Button>
                  <Button size="small" variant="ghost" onClick={() => void removeSetAside(v)} aria-label={`Supprimer la version mise de côté le ${stamp(v.setAsideAt)}`}>
                    Supprimer
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/** « 3 lignes seront rétablies ou modifiées, 5 lignes créées depuis seront supprimées » : seulement ce qui change. */
function restoreSummary(r: RestoreResult): string {
  const parts = [
    r.restored > 0 ? count(r.restored, "ligne sera rétablie ou modifiée", "lignes seront rétablies ou modifiées") : "",
    r.removed > 0 ? count(r.removed, "ligne créée depuis sera supprimée", "lignes créées depuis seront supprimées") : "",
    r.preferencesChanged.length > 0 ? count(r.preferencesChanged.length, "réglage reprend sa valeur d'alors", "réglages reprennent leur valeur d'alors") : "",
  ].filter(Boolean);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Restauration « partout ». En synchronisation automatique, un passage d'abord : la
 * copie l'emporte ainsi aussi sur ce que les autres appareils ont écrit dans le fichier.
 */
async function restoreSnapshot(store: AppStore, snap: SnapshotInfo): Promise<void> {
  const { platform, actions } = store.getState();
  const snapshot = await platform.local.readSnapshot(snap.id);
  const sync = store.getState().sync;
  if (sync.automatic && sync.status === "ready") await actions.sync.now();
  const preview = restoreEverywhere(store.getState().data, snapshot, Date.now());
  if (preview.restored === 0 && preview.removed === 0 && preview.preferencesChanged.length === 0) {
    actions.toast("Cette copie est identique à l'état actuel : rien à restaurer.");
    return;
  }
  const ok = await actions.ask({
    title: `Restaurer la copie du ${stamp(snap.takenAt)} ?`,
    message: `${restoreSummary(preview)}. Tes autres appareils suivront à leur prochaine synchronisation.`,
    confirmLabel: "Restaurer partout",
    danger: true,
  });
  if (!ok) return;
  await platform.local.snapshot(Date.now());
  // Recalculée au moment d'écrire : rien de ce qui a pu changer pendant la question n'échappe.
  const result = restoreEverywhere(store.getState().data, snapshot, Date.now());
  await actions.apply(result.changes, result.preferences, "Copie restaurée");
}
