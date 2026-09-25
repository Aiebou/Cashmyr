import type { ProfileEntry } from "@cashmyr/storage";
import { useState } from "react";
import { initialOf } from "../lib/profiles";
import s from "./ProfilePicker.module.css";

type Props = {
  profiles: ProfileEntry[];
  onPick(profile: ProfileEntry): void;
};

/** « Qui utilise Cashmyr ? » : à chaque lancement, dès que l'appareil a plusieurs profils (décision 54). */
export function ProfilePicker({ profiles, onPick }: Props) {
  const [opening, setOpening] = useState<string | null>(null);
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
      </ul>
      <p className={s.muted}>Chaque profil a ses comptes, ses opérations et son fichier de synchronisation.</p>
    </main>
  );
}
