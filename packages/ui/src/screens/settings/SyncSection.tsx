import type { SyncOutcome, SyncState } from "@cashmyr/storage";
import { useState } from "react";
import { Button } from "../../components/controls";
import { SyncIcon } from "../../components/icons";
import { Card } from "../../components/layout";
import { count, stamp } from "../../lib/format";
import { useActions, useApp } from "../../store/context";
import s from "./Settings.module.css";

const MODE_LABELS: Record<SyncState["mode"], string> = {
  "auto-tauri": "Automatique : l'application de bureau lit et écrit le fichier elle-même.",
  "auto-fs-access": "Automatique : ce navigateur a le droit de lire et d'écrire le fichier choisi.",
  assisted: "À la demande : ce navigateur ne peut pas écrire dans ton dossier cloud.",
};

function statusText(sync: SyncState): string {
  switch (sync.status) {
    case "unconfigured":
      return sync.automatic ? "Aucun fichier choisi : les données restent sur cet appareil." : "Jamais synchronisé depuis cet appareil.";
    case "ready":
      return sync.automatic ? "En place : chaque modification part dans le fichier deux secondes plus tard." : "Prêt.";
    case "needs-permission":
      return "Le navigateur demande de réautoriser l'accès au fichier.";
    case "missing":
      return "Le fichier choisi est introuvable : déplacé, renommé ou supprimé ?";
    case "syncing":
      return "Synchronisation en cours…";
    case "error":
      return "La dernière synchronisation a échoué.";
  }
}

/** Compte rendu d'un passage, en une phrase. */
function outcomeText(outcome: SyncOutcome): string | null {
  if (outcome.kind !== "merged") return null;
  const { received, sent } = outcome.report;
  if (received === 0 && sent === 0) return "Tout était déjà à jour.";
  return `Fusion faite : ${count(received, "ligne reçue", "lignes reçues")}, ${count(sent, "ligne envoyée", "lignes envoyées")}.`;
}

export function SyncSection() {
  const sync = useApp((st) => st.sync);
  const fileName = useApp((st) => st.platform.syncFileName);
  const { sync: actions, toast, ask } = useActions();
  const [busy, setBusy] = useState(false);

  const run = async (task: () => Promise<SyncOutcome>) => {
    setBusy(true);
    try {
      const text = outcomeText(await task());
      if (text) toast(text);
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    const ok = await ask({
      title: "Oublier ce fichier ?",
      message:
        "Cet appareil cesse de se synchroniser. Le fichier et les données de cet appareil restent intacts ; tu pourras le choisir de nouveau.",
      confirmLabel: "Oublier le fichier",
    });
    if (ok) await actions.disconnect();
  };

  const offer = async () => {
    const result = await actions.offerMerged();
    if (result === "shared" || result === "downloaded") {
      toast("Fichier fusionné proposé : vérifie qu'il remplace bien l'original dans ton dossier cloud.");
    }
  };

  const configured = sync.status !== "unconfigured";

  return (
    <Card title="Synchronisation" subtitle={MODE_LABELS[sync.mode]}>
      <dl className={s.status}>
        <dt>État</dt>
        <dd>{statusText(sync)}</dd>
        {sync.targetName && (
          <>
            <dt>Fichier</dt>
            <dd>{sync.targetName}</dd>
          </>
        )}
        <dt>Dernière fusion</dt>
        <dd>{sync.lastMergeAt ? stamp(sync.lastMergeAt) : "Jamais"}</dd>
        {!sync.automatic && (
          <>
            <dt>Dernier fichier proposé</dt>
            <dd>{sync.lastOfferAt ? stamp(sync.lastOfferAt) : "Jamais"}</dd>
          </>
        )}
        {/* Sans fichier, rien n'est « en attente » : rien ne partira. */}
        {configured && (
          <>
            <dt>En attente</dt>
            <dd>{sync.pending === 0 ? "Rien" : count(sync.pending, "modification à synchroniser", "modifications à synchroniser")}</dd>
          </>
        )}
        {sync.lastError && (
          <>
            <dt>Dernière erreur</dt>
            <dd className={s.error}>{sync.lastError}</dd>
          </>
        )}
      </dl>

      {sync.automatic ? (
        <>
          {!configured && (
            <p className={s.muted}>
              Choisis <strong>{fileName}</strong> dans un dossier que ton service cloud synchronise (iCloud Drive, Dropbox,
              OneDrive…). Chaque appareil y lit et y écrit ; aucune donnée ne passe par un serveur de Cashmyr.
            </p>
          )}
          <div className={s.actions}>
            {!configured || sync.status === "missing" ? (
              <>
                <Button variant="primary" disabled={busy} onClick={() => run(() => actions.connect("open"))}>
                  Choisir mon fichier
                </Button>
                <Button disabled={busy} onClick={() => run(() => actions.connect("create"))}>
                  Créer un nouveau fichier
                </Button>
              </>
            ) : sync.status === "needs-permission" ? (
              <Button variant="primary" disabled={busy} onClick={() => run(actions.requestPermission)}>
                Réautoriser l'accès au fichier
              </Button>
            ) : (
              <Button variant="primary" disabled={busy || sync.status === "syncing"} onClick={() => run(actions.now)}>
                <SyncIcon size={16} />
                Synchroniser maintenant
              </Button>
            )}
            {configured && (
              <Button variant="ghost" disabled={busy} onClick={forget}>
                Oublier ce fichier
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <ol className={s.steps}>
            <li>
              <strong>Synchroniser</strong> : choisis {fileName} dans ton dossier cloud. Il est fusionné avec cet appareil, qui est
              aussitôt à jour.
            </li>
            <li>
              <strong>Enregistrer le fichier fusionné</strong> : il remplace l'original dans ton dossier cloud, pour que les autres appareils
              le retrouvent.
            </li>
          </ol>
          <p className={s.muted}>
            La synchronisation n'a lieu qu'à la demande, et l'application ne peut pas vérifier que l'original a bien été remplacé.
          </p>
          <div className={s.actions}>
            <Button variant={sync.offerReady ? "default" : "primary"} disabled={busy} onClick={() => run(actions.now)}>
              <SyncIcon size={16} />
              Synchroniser
            </Button>
            <Button variant={sync.offerReady ? "primary" : "default"} disabled={!sync.offerReady} onClick={offer}>
              Enregistrer le fichier fusionné
            </Button>
            {!configured && (
              <Button variant="ghost" disabled={busy} onClick={() => run(actions.createAssistedFile)}>
                Créer le fichier de synchronisation
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
