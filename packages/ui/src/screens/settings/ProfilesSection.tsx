import type { ProfileEntry } from "@cashmyr/storage";
import { useState } from "react";
import { Button, cx, InlineText } from "../../components/controls";
import { TrashIcon } from "../../components/icons";
import { Card } from "../../components/layout";
import { initialOf } from "../../lib/profiles";
import { useActions, useApp } from "../../store/context";
import s from "./Settings.module.css";

/** Profils de l'appareil (§9) : chacun est un budget à part, avec son propre fichier de synchronisation. */
export function ProfilesSection() {
  const { list, current } = useApp((st) => st.profiles);
  const { profiles, openModal, toast } = useActions();
  const [checking, setChecking] = useState<string | null>(null);
  // Un nom refusé revient à la valeur enregistrée.
  const [resets, setResets] = useState(0);

  const rename = async (profile: ProfileEntry, name: string) => {
    const error = await profiles.rename(profile.id, name);
    if (error) {
      toast(error, "error");
      setResets((n) => n + 1);
    }
  };

  const remove = async (profile: ProfileEntry) => {
    setChecking(profile.id);
    try {
      const check = await profiles.inspect(profile.id);
      openModal({ kind: "delete-profile", profileId: profile.id, check });
    } catch (e) {
      toast(`Impossible de lire l'état de ce profil : ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setChecking(null);
    }
  };

  return (
    <Card title="Profils" subtitle="Chaque profil est un budget à part, avec ses comptes, ses opérations et son fichier de synchronisation.">
      <ul className={cx(s.list, s.profileList)}>
        {list.map((profile) => {
          const open = profile.id === current.id;
          return (
            <li key={`${profile.id}-${resets}`} className={s.profileRow}>
              <span className={s.profileInitial} aria-hidden="true">
                {initialOf(profile.name)}
              </span>
              <InlineText label={`Nom du profil « ${profile.name} »`} value={profile.name} required onCommit={(name) => void rename(profile, name)} />
              {open ? (
                <span className={s.muted}>Ouvert</span>
              ) : (
                <Button size="small" onClick={() => void profiles.open(profile.id)}>
                  Ouvrir
                </Button>
              )}
              {list.length > 1 && (
                <Button
                  size="small"
                  variant="ghost"
                  aria-label={`Supprimer le profil « ${profile.name} »`}
                  disabled={checking !== null}
                  onClick={() => void remove(profile)}
                >
                  <TrashIcon size={16} />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div className={s.actions}>
        <Button onClick={() => openModal({ kind: "create-profile" })}>Nouveau profil…</Button>
      </div>
      <p className={s.muted}>
        Sur cet appareil, chacun peut ouvrir tous les profils. Pour partager un profil, celui du foyer par exemple, crée un profil sur
        l'autre appareil et rejoins-y le même fichier de synchronisation. Supprimer un profil ne le retire que de cet appareil : son
        fichier et tes autres appareils ne changent pas.
      </p>
    </Card>
  );
}
