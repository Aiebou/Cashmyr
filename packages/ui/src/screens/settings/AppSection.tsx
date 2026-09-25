import { useState } from "react";
import { Button, Checkbox } from "../../components/controls";
import { Card } from "../../components/layout";
import { displayOf } from "../../store/app-store";
import { useActions, useApp } from "../../store/context";
import s from "./Settings.module.css";

type Check = { kind: "idle" } | { kind: "checking" } | { kind: "none" } | { kind: "error"; message: string };

/** Version en service et mises à jour de l'application elle-même. */
export function AppSection() {
  const updates = useApp((st) => st.platform.updates);
  const update = useApp((st) => st.update);
  const onLaunch = displayOf(useApp((st) => st.device)).checkUpdatesOnLaunch;
  const { updates: actions, setDisplay } = useActions();
  const [check, setCheck] = useState<Check>({ kind: "idle" });

  const search = async () => {
    setCheck({ kind: "checking" });
    const result = await actions.check();
    setCheck(typeof result === "object" ? { kind: "error", message: result.error } : result === "none" ? { kind: "none" } : { kind: "idle" });
  };

  const available = update?.available;
  return (
    <Card title="Application" subtitle={updates ? `Cashmyr, version ${updates.version}` : "Cashmyr"}>
      {available && (
        <div className={s.actions}>
          <span>{available.version ? `Cashmyr ${available.version} est disponible.` : "Nouvelle version disponible."}</span>
          <Button variant="primary" onClick={() => void actions.apply()} disabled={update.applying}>
            {available.kind === "reload" ? "Recharger" : "Installer et redémarrer"}
          </Button>
        </div>
      )}
      {updates?.check ? (
        <>
          {!available && (
            <div className={s.actions}>
              <Button onClick={() => void search()} disabled={check.kind === "checking"}>
                {check.kind === "checking" ? "Recherche…" : "Rechercher une mise à jour"}
              </Button>
              {check.kind === "none" && <span role="status">Cashmyr est à jour.</span>}
            </div>
          )}
          {check.kind === "error" && (
            <p className={s.error} role="alert">
              Vérification impossible ({check.message}). Vérifie ta connexion, puis réessaie.
            </p>
          )}
          <Checkbox
            label="Rechercher une mise à jour au lancement"
            checked={onLaunch}
            onChange={(e) => void setDisplay({ checkUpdatesOnLaunch: e.target.checked })}
          />
          <p className={s.muted}>
            Cashmyr ne se connecte à Internet que pour lire la dernière version publiée sur GitHub : au lancement si la case est
            cochée, et quand tu cliques sur ce bouton. Hors ligne, rien ne s'affiche. Une mise à jour ne s'installe que sur ton clic,
            et seulement si sa signature est valide ; tes données ne sont pas touchées.
          </p>
        </>
      ) : (
        updates && (
          <p className={s.muted}>
            La version en ligne se met à jour d'elle-même : à l'ouverture, le navigateur regarde s'il en existe une nouvelle, et un
            bandeau propose de recharger. Tes données restent sur cet appareil.
          </p>
        )
      )}
    </Card>
  );
}
