import { FIRST_PROFILE_NAME } from "@cashmyr/storage";
import { useId, useState, type FormEvent } from "react";
import { Button, Field, submitOnEnter, TextInput } from "../../components/controls";
import { Modal } from "../../components/Modal";
import { count } from "../../lib/format";
import type { ProfileCheck } from "../../store/app-store";
import { useActions, useApp } from "../../store/context";
import s from "./Settings.module.css";

/** Nouveau profil : il s'ouvre aussitôt, sur l'accueil. Au deuxième, « Mon budget » peut être renommé (décision 55). */
export function CreateProfileModal() {
  const registered = useApp((st) => st.profiles.registered);
  const { profiles, closeModal } = useActions();
  const id = useId();
  const [name, setName] = useState("");
  const [firstName, setFirstName] = useState(FIRST_PROFILE_NAME);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() === "") return setError("Donne un nom au nouveau profil.");
    if (!registered && firstName.trim() === "") return setError("Donne un nom à ce profil-ci.");
    setBusy(true);
    const failure = await profiles.create(name, registered ? undefined : firstName);
    if (failure) {
      setError(failure);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nouveau profil"
      width="narrow"
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form={`${id}-form`} disabled={busy}>
            {busy ? "Ouverture…" : "Créer et ouvrir"}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} className={s.modalForm} onSubmit={submit} onKeyDown={submitOnEnter} noValidate>
        <Field label="Nom du nouveau profil" htmlFor={`${id}-name`}>
          <TextInput id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-autofocus />
        </Field>
        {!registered && (
          <Field label="Nom de ce profil-ci" htmlFor={`${id}-first`} hint="Tes données actuelles. Tu pourras le renommer plus tard.">
            <TextInput id={`${id}-first`} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" />
          </Field>
        )}
        <p className={s.muted}>
          Le nouveau profil s'ouvre sur l'accueil : catégories par défaut, reprise d'un fichier, ou fichier de synchronisation à
          rejoindre.
        </p>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

const modifications = (n: number) => count(n, "modification", "modifications");

/**
 * Supprimer un profil de cet appareil (décisions 56, 58 et 61). Quand rien ne se perd, une simple
 * confirmation. Sinon, une sauvegarde proposée et le nom du profil à taper.
 */
export function DeleteProfileModal({ profileId, check }: { profileId: string; check: ProfileCheck }) {
  const { list, current } = useApp((st) => st.profiles);
  const { profiles, closeModal } = useActions();
  const id = useId();
  const profile = list.find((p) => p.id === profileId);
  const [stage, setStage] = useState<ProfileCheck["kind"]>(check.kind);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  if (!profile) return null;

  const isCurrent = profile.id === current.id;
  const relaunch = isCurrent ? " Cashmyr se relance ensuite." : "";
  const remove = async () => {
    setBusy(true);
    if (!(await profiles.remove(profile.id))) setBusy(false);
    else if (!isCurrent) closeModal();
  };

  if (stage === "pending" && check.kind === "pending") {
    return (
      <Modal
        title={`« ${profile.name} » a des modifications à envoyer`}
        width="narrow"
        onClose={closeModal}
        footer={
          <>
            <Button variant="ghost" onClick={() => setStage("unsafe")}>
              Supprimer quand même…
            </Button>
            <Button variant="primary" onClick={() => void profiles.open(profile.id)} data-autofocus>
              Ouvrir « {profile.name} »
            </Button>
          </>
        }
      >
        <p className={s.confirmText}>
          {modifications(check.count)} de ce profil {check.count > 1 ? "ne sont" : "n'est"} pas encore dans son fichier de
          synchronisation. Ouvre-le pour les envoyer, puis supprime-le. Le supprimer maintenant les perdrait, sauf sauvegarde.
        </p>
      </Modal>
    );
  }

  if (stage === "safe" && check.kind === "safe") {
    return (
      <Modal
        title={`Supprimer « ${profile.name} » de cet appareil ?`}
        width="narrow"
        onClose={closeModal}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal}>
              Annuler
            </Button>
            <Button variant="danger" onClick={() => void remove()} disabled={busy} data-autofocus>
              Supprimer
            </Button>
          </>
        }
      >
        <p className={s.confirmText}>
          {check.fileName
            ? `Ses données quittent cet appareil, copies de sauvegarde comprises. Son fichier de synchronisation (${check.fileName}) et tes autres appareils ne changent pas : pour le retrouver ici, crée un profil et rejoins ce fichier.`
            : "Ce profil ne contient aucune donnée : il quitte simplement cet appareil."}
          {relaunch}
        </p>
      </Modal>
    );
  }

  // Ce qui serait perdu n'est nulle part ailleurs.
  const lost = check.kind === "safe" ? 0 : check.count;
  const noFile = check.kind === "unsafe" && check.reason === "no-file";
  const matches = typed.trim() === profile.name;
  return (
    <Modal
      title={`Supprimer « ${profile.name} » de cet appareil ?`}
      width="narrow"
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            Annuler
          </Button>
          <Button variant="danger" type="submit" form={`${id}-form`} disabled={!matches || busy}>
            Supprimer définitivement
          </Button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        className={s.modalForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (matches) void remove();
        }}
        noValidate
      >
        <p className={s.warning} role="status">
          {noFile
            ? "Ce profil n'a pas de fichier de synchronisation : ses données ne sont que sur cet appareil et disparaîtront avec lui."
            : `${modifications(lost)} de ce profil ${lost > 1 ? "ne sont" : "n'est"} pas encore dans son fichier de synchronisation : ${lost > 1 ? "elles disparaîtront" : "elle disparaîtra"} avec lui.`}
          {relaunch}
        </p>
        <div className={s.actions}>
          <Button onClick={() => void profiles.backup(profile.id)}>Enregistrer une sauvegarde</Button>
        </div>
        <Field label={`Pour confirmer, tape le nom du profil : ${profile.name}`} htmlFor={`${id}-name`}>
          <TextInput id={`${id}-name`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-autofocus />
        </Field>
      </form>
    </Modal>
  );
}
