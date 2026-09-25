import { startingCategories } from "@cashmyr/core";
import { Button } from "../components/controls";
import { Card, Stack } from "../components/layout";
import { importFromFile } from "../lib/import";
import { useActions, useApp, useStoreApi } from "../store/context";
import s from "./Welcome.module.css";

/** Premier lancement : partir des catégories par défaut, reprendre un fichier, ou rejoindre un fichier de synchronisation. */
export function Welcome() {
  const store = useStoreApi();
  const sync = useApp((st) => st.sync);
  const fileName = useApp((st) => st.platform.syncFileName);
  const { list, current } = useApp((st) => st.profiles);
  const { apply, openModal, sync: syncActions } = useActions();

  const start = async () => {
    // Après une remise à zéro partout, les catégories effacées reviennent avec un horodatage plus récent.
    const categories = startingCategories(store.getState().data, Date.now());
    if (await apply({ categories }, undefined, "Catégories par défaut créées")) {
      openModal({ kind: "create-account" });
    }
  };

  const join = () => (sync.mode === "assisted" ? syncActions.now() : syncActions.connect("open"));

  return (
    <div className={s.welcome}>
      <Stack gap={10}>
        <h2 className={s.title}>{list.length > 1 ? `Bienvenue dans « ${current.name} »` : "Bienvenue"}</h2>
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
          <Button variant="primary" className={s.choice} onClick={start}>
            Commencer avec les catégories par défaut
          </Button>
        </Card>
        <Card title="J'utilise déjà Cashmyr ailleurs">
          <p className={s.text}>
            {sync.mode === "assisted"
              ? `Désigne ton fichier de synchronisation (${fileName}) dans ton app Fichiers : tes données le rejoindront.`
              : `Choisis ton fichier de synchronisation (${fileName}) dans ton dossier synchronisé : tes données s'y retrouvent.`}
          </p>
          <Button className={s.choice} onClick={join}>Rejoindre mon fichier de synchronisation</Button>
        </Card>
        <Card title="Reprendre mes données">
          <p className={s.text}>
            L'export JSON de l'ancienne application (mes-finances.json) ou une sauvegarde Cashmyr. Tout est vérifié avant d'être
            écrit : au moindre doute, rien n'est repris.
          </p>
          <Button className={s.choice} onClick={() => importFromFile(store)}>Importer un fichier</Button>
        </Card>
      </div>
    </div>
  );
}
