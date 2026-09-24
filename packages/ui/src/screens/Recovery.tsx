import "../theme/global.css";
import { toLocalDay } from "@cashmyr/core";
import { recoverLocalData, recoveryCopies, type LocalDataError, type Platform, type RecoveryCopy } from "@cashmyr/storage";
import { useEffect, useState } from "react";
import { Button, cx } from "../components/controls";
import { Card, Stack } from "../components/layout";
import { fileSize, stamp } from "../lib/format";
import s from "./Recovery.module.css";

type Props = {
  platform: Platform;
  problem: LocalDataError;
  /** Après une restauration réussie : l'application redémarre. */
  onRecovered: () => void;
  now?: () => number;
};

type Status = { tone: "info" | "error"; text: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Écran de secours, à la place de l'application, quand les données locales sont refusées à
 * l'ouverture (décisions 38 à 40) : repartir d'une copie de sauvegarde, ou de zéro s'il n'y
 * en a aucune d'utilisable. La version abîmée est gardée de côté, et peut être enregistrée.
 */
export function RecoveryScreen({ platform, problem, onRecovered, now = Date.now }: Props) {
  const [copies, setCopies] = useState<RecoveryCopy[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmZero, setConfirmZero] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let live = true;
    recoveryCopies(platform.local).then(
      (found) => live && setCopies(found),
      () => live && setCopies([]),
    );
    return () => {
      live = false;
    };
  }, [platform]);

  const recover = async (copy: RecoveryCopy | null) => {
    setBusy(true);
    setStatus(null);
    try {
      await recoverLocalData(platform.local, copy?.id ?? null, now());
      setStatus({
        tone: "info",
        text: copy ? `Copie du ${stamp(copy.takenAt)} restaurée. Cashmyr redémarre…` : "Cashmyr repart de zéro et redémarre…",
      });
      onRecovered();
    } catch (e) {
      setBusy(false);
      setStatus({ tone: "error", text: `La restauration n'a pas abouti (${errorText(e)}). La version abîmée n'est pas perdue : réessaie.` });
    }
  };

  const saveDamaged = async () => {
    try {
      const raw = await platform.local.readRaw();
      if (raw === null) {
        setStatus({ tone: "error", text: "Il n'y a plus de version abîmée à enregistrer sur cet appareil." });
        return;
      }
      const name = `cashmyr-version-abimee-${toLocalDay(new Date(now()))}.json`;
      if (await platform.files.saveAs(name, "application/json", raw)) setStatus({ tone: "info", text: "Version abîmée enregistrée." });
    } catch (e) {
      setStatus({ tone: "error", text: `Enregistrement impossible : ${errorText(e)}` });
    }
  };

  const usable = copies?.filter((c) => c.usable) ?? [];

  return (
    <main className={s.page}>
      <h1 className={s.brand}>Cashmyr</h1>
      <Stack gap={10}>
        <h2 className={s.title}>Les données de cet appareil sont abîmées</h2>
        <p className={s.lead}>
          {problem.kind === "illisible"
            ? "Cashmyr ne parvient pas à les lire."
            : "Elles contiennent des incohérences que Cashmyr refuse d'ouvrir."}{" "}
          Rien n'a été modifié. Choisis comment repartir : la version abîmée sera gardée de côté.
        </p>
      </Stack>

      {status && (
        <p className={cx(s.status, status.tone === "error" && s.error)} role={status.tone === "error" ? "alert" : "status"}>
          {status.text}
        </p>
      )}

      <Card title="Repartir d'une copie de sauvegarde" subtitle="Une copie est prise à chaque ouverture réussie de Cashmyr.">
        {copies === null ? (
          <p className={s.muted}>Recherche des copies…</p>
        ) : copies.length === 0 ? (
          <p className={s.muted}>Aucune copie sur cet appareil.</p>
        ) : (
          <ul className={s.list}>
            {copies.map((copy) => (
              <li key={copy.id}>
                <span>
                  Copie du {stamp(copy.takenAt)}{" "}
                  <span className={s.muted}>· {copy.usable ? fileSize(copy.bytes) : "abîmée elle aussi"}</span>
                </span>
                {copy.usable && (
                  <Button
                    size="small"
                    variant={copy === usable[0] ? "primary" : "default"}
                    disabled={busy}
                    onClick={() => void recover(copy)}
                    aria-label={`Restaurer la copie du ${stamp(copy.takenAt)}`}
                  >
                    Restaurer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className={s.muted}>
          Si la synchronisation est en place, ce qui a été synchronisé depuis la copie revient à la synchronisation suivante. Ce qui
          n'avait été saisi que sur cet appareil après la copie est perdu.
        </p>
      </Card>

      {copies !== null && usable.length === 0 && (
        <Card title="Repartir de zéro">
          <p>
            Aucune copie utilisable. Cashmyr peut repartir d'un appareil vide. Si la synchronisation est en place, elle ramènera tout
            ce qui avait été synchronisé ; sinon, tu repars d'un Cashmyr vide.
          </p>
          <div className={s.actions}>
            {confirmZero ? (
              <>
                <Button variant="danger" disabled={busy} onClick={() => void recover(null)}>
                  Confirmer : repartir de zéro
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmZero(false)}>
                  Annuler
                </Button>
              </>
            ) : (
              <Button disabled={busy} onClick={() => setConfirmZero(true)}>
                Repartir de zéro
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card
        title="Version abîmée"
        subtitle="Gardée de côté avant toute restauration ; Paramètres → Sauvegardes permet ensuite de l'enregistrer ou de la supprimer."
      >
        <div className={s.actions}>
          <Button disabled={busy} onClick={() => void saveDamaged()}>
            Enregistrer la version abîmée
          </Button>
        </div>
        <p className={s.muted}>Pour en garder dès maintenant une copie ailleurs : elle contient tes données telles qu'elles sont.</p>
      </Card>

      <details className={s.details}>
        <summary>Détail technique</summary>
        <pre className={s.detail}>{problem.detail}</pre>
      </details>
    </main>
  );
}
