import type { ProfileEntry } from "@cashmyr/storage";
import { useId, useState, type FormEvent } from "react";
import { Button, TextInput } from "../components/controls";
import { PlusIcon } from "../components/icons";
import { initialOf } from "../lib/profiles";
import s from "./ProfilePicker.module.css";

type Props = {
  profiles: ProfileEntry[];
  onPick(profile: ProfileEntry): void;
  /** Crée un profil et l'ouvre ; renvoie la raison d'un refus (nom vide ou déjà pris). */
  onCreate(name: string): Promise<string | null>;
};

/** « Qui utilise Cashmyr ? » : à chaque lancement, dès que l'appareil a plusieurs profils (décisions 54 et 64). */
export function ProfilePicker({ profiles, onPick, onCreate }: Props) {
  const [opening, setOpening] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() === "") return setError("Donne un nom au profil.");
    setOpening("new");
    const failure = await onCreate(name);
    if (failure) {
      setError(failure);
      setOpening(null);
    }
  };

  return (
    <main className={s.page}>
      <h1 className={s.brand}>Cashmyr</h1>
      <h2 className={s.title}>Qui utilise Cashmyr ?</h2>
      <ul className={s.grid}>
        {profiles.map((profile) => (
          <li key={profile.id}>
            <button
              type="button"
              className={s.profile}
              disabled={opening !== null}
              aria-busy={opening === profile.id}
              onClick={() => {
                setOpening(profile.id);
                onPick(profile);
              }}
            >
              <span className={s.initial} aria-hidden="true">
                {initialOf(profile.name)}
              </span>
              <span className={s.name}>{profile.name}</span>
            </button>
          </li>
        ))}
        {!creating && (
          <li>
            <button
              type="button"
              className={`${s.profile} ${s.add}`}
              aria-label="Nouveau profil"
              disabled={opening !== null}
              onClick={() => setCreating(true)}
            >
              <span className={s.initial} aria-hidden="true">
                <PlusIcon size={28} />
              </span>
              <span className={s.name}>Profil</span>
            </button>
          </li>
        )}
      </ul>
      {creating && (
        <form className={s.form} onSubmit={create} noValidate>
          <label className={s.label} htmlFor={`${id}-name`}>
            Nom du nouveau profil
          </label>
          <TextInput
            id={`${id}-name`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            autoComplete="off"
            autoFocus
          />
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <div className={s.actions}>
            <Button
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setName("");
                setError(null);
              }}
              disabled={opening !== null}
            >
              Annuler
            </Button>
            <Button variant="primary" type="submit" disabled={opening !== null}>
              {opening === "new" ? "Ouverture…" : "Créer et ouvrir"}
            </Button>
          </div>
        </form>
      )}
      <p className={s.muted}>Chaque profil a ses comptes, ses opérations et son fichier de synchronisation.</p>
    </main>
  );
}
