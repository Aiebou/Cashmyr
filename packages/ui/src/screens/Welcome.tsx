import { Button } from "../components/controls";
import { Card, Stack } from "../components/layout";
import { defaultCategories } from "../lib/data";
import { useActions, useApp } from "../store/context";
import s from "./Welcome.module.css";

/** Premier lancement : partir des catégories par défaut, ou rejoindre un fichier de synchronisation existant. */
export function Welcome() {
  const sync = useApp((st) => st.sync);
  const { apply, openModal, sync: syncActions } = useActions();

  const start = async () => {
    if (await apply({ categories: defaultCategories() }, undefined, "Catégories par défaut créées")) {
      openModal({ kind: "create-account" });
    }
  };

  const join = () => (sync.mode === "assisted" ? syncActions.now() : syncActions.connect("open"));

  return (
    <div className={s.welcome}>
      <Stack gap={10}>
        <h2 className={s.title}>Bienvenue</h2>
        <p className={s.lead}>
          Cashmyr garde tes comptes sur cet appareil, sans compte ni serveur. Tes revenus se déduisent de ce que tu
          saisis : l'application ne te demande jamais ton salaire.
        </p>
      </Stack>
      <div className={s.choices}>
        <Card title="Commencer ici">
          <p className={s.text}>
            Des catégories de revenus et de dépenses toutes prêtes, rangées en besoins, envies et mise de côté. Tu
            crées ensuite ton premier compte.
          </p>
          <Button variant="primary" onClick={start}>
            Commencer avec les catégories par défaut
          </Button>
        </Card>
        <Card title="J'utilise déjà Cashmyr ailleurs">
          <p className={s.text}>
            {sync.mode === "assisted"
              ? "Désigne ton fichier de synchronisation (finances-sync.json) dans ton app Fichiers : tes données le rejoindront."
              : "Choisis ton fichier de synchronisation (finances-sync.json) dans ton dossier synchronisé : tes données s'y retrouvent."}
          </p>
          <Button onClick={join}>Rejoindre mon fichier de synchronisation</Button>
        </Card>
      </div>
    </div>
  );
}
