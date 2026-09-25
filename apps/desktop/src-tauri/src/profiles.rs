//! Profils (§9 de `docs/architecture.md`) : chaque profil range son stockage dans son dossier,
//! la racine du répertoire de données pour le premier, `profils/<id>/` pour les suivants.
//!
//! Le contrat côté front est décrit dans `packages/storage/src/tauri/index.ts`. Rust n'admet que
//! `principal` ou un uuid v4 : un identifiant ne peut donc désigner qu'un dossier de `profils/`,
//! et le front ne peut toujours pas diriger la synchronisation vers un autre fichier que ceux
//! choisis dans le dialogue.

use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_store::StoreExt;

use crate::sync_file::{SyncTarget, TARGET_FILE};

pub const PRINCIPAL: &str = "principal";
const PROFILES_DIR: &str = "profils";
const DEVICE_STORE: &str = "device.json";
/// Ce qui appartient au premier profil, à la racine ; `profils.json` et `profils/` n'en font pas partie.
const PRINCIPAL_FILES: &[&str] = &["data.json", "data.json.tmp", DEVICE_STORE, TARGET_FILE];
const PRINCIPAL_DIRS: &[&str] = &["backups", "mis-de-cote"];

/// `principal`, ou un uuid v4 en minuscules, tel que le front les crée.
pub fn is_profile_id(id: &str) -> bool {
    if id == PRINCIPAL {
        return true;
    }
    let bytes = id.as_bytes();
    let hex = |b: &u8| b.is_ascii_digit() || (b'a'..=b'f').contains(b);
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => *b == b'-',
            14 => *b == b'4',
            19 => matches!(b, b'8' | b'9' | b'a' | b'b'),
            _ => hex(b),
        })
}

/// Dossier du profil, relatif au répertoire de données (vide pour le premier).
fn relative_dir(id: &str) -> PathBuf {
    if id == PRINCIPAL {
        PathBuf::new()
    } else {
        Path::new(PROFILES_DIR).join(id)
    }
}

pub fn profile_dir(data_dir: &Path, id: &str) -> PathBuf {
    if id == PRINCIPAL {
        data_dir.to_path_buf()
    } else {
        data_dir.join(relative_dir(id))
    }
}

/// Retire le stockage local d'un profil. Son fichier de synchronisation, ailleurs, n'est pas touché.
pub fn remove_storage(data_dir: &Path, id: &str) -> io::Result<()> {
    let ignore_missing = |r: io::Result<()>| match r {
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        other => other,
    };
    if id == PRINCIPAL {
        for name in PRINCIPAL_FILES {
            ignore_missing(fs::remove_file(data_dir.join(name)))?;
        }
        for name in PRINCIPAL_DIRS {
            ignore_missing(fs::remove_dir_all(data_dir.join(name)))?;
        }
        Ok(())
    } else {
        ignore_missing(fs::remove_dir_all(profile_dir(data_dir, id)))
    }
}

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn checked(id: &str) -> Result<(), String> {
    if is_profile_id(id) {
        Ok(())
    } else {
        Err("Identifiant de profil inutilisable.".to_string())
    }
}

// ── Commandes ────────────────────────────────────────────────────────────

/// Les commandes de synchronisation agissent désormais sur ce profil.
#[tauri::command]
pub fn profile_select(app: AppHandle, target: State<'_, SyncTarget>, id: String) -> Result<(), String> {
    checked(&id)?;
    let dir = profile_dir(&data_dir(&app)?, &id);
    if !dir.is_dir() {
        return Err("Ce profil n'existe pas sur cet appareil.".to_string());
    }
    target.switch(dir.join(TARGET_FILE));
    Ok(())
}

/// Retire le stockage local d'un profil, `sync-target.txt` compris, que `plugin-fs` ne peut pas toucher.
#[tauri::command]
pub async fn profile_remove(app: AppHandle, target: State<'_, SyncTarget>, id: String) -> Result<(), String> {
    checked(&id)?;
    let data = data_dir(&app)?;
    // L'état de l'appareil du profil, s'il est chargé, ne doit pas être réécrit à la fermeture.
    let device = relative_dir(&id).join(DEVICE_STORE);
    if let Some(store) = app.get_store(&device) {
        store.close_resource();
    }
    if target.uses(&profile_dir(&data, &id).join(TARGET_FILE)) {
        target.release();
    }
    tauri::async_runtime::spawn_blocking(move || remove_storage(&data, &id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Suppression du profil impossible : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FOYER: &str = "0b7e2f4c-1d2a-4c3b-9e8f-7a6b5c4d3e2f";

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "x").unwrap();
    }

    #[test]
    fn seuls_principal_et_un_uuid_v4_sont_admis() {
        assert!(is_profile_id("principal"));
        assert!(is_profile_id(FOYER));
        for bad in [
            "",
            "Principal",
            "..",
            "../principal",
            "profils/x",
            "0B7E2F4C-1D2A-4C3B-9E8F-7A6B5C4D3E2F",
            "0b7e2f4c-1d2a-1c3b-9e8f-7a6b5c4d3e2f",
            "0b7e2f4c-1d2a-4c3b-7e8f-7a6b5c4d3e2f",
            "0b7e2f4c1d2a4c3b9e8f7a6b5c4d3e2f",
            "0b7e2f4c-1d2a-4c3b-9e8f-7a6b5c4d3e2f/..",
        ] {
            assert!(!is_profile_id(bad), "{bad:?}");
        }
    }

    #[test]
    fn dossier_de_chaque_profil() {
        let root = Path::new("/données");
        assert_eq!(profile_dir(root, PRINCIPAL), root);
        assert_eq!(profile_dir(root, FOYER), root.join("profils").join(FOYER));
    }

    #[test]
    fn retirer_le_premier_profil_garde_le_registre_et_les_autres() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for name in [
            "data.json",
            "device.json",
            "sync-target.txt",
            "backups/data-1.json",
            "mis-de-cote/data-2.json",
        ] {
            touch(&root.join(name));
        }
        touch(&root.join("profils.json"));
        touch(&root.join("profils").join(FOYER).join("data.json"));

        remove_storage(root, PRINCIPAL).unwrap();
        let mut left: Vec<_> = fs::read_dir(root)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left, vec!["profils", "profils.json"]);
        assert!(root.join("profils").join(FOYER).join("data.json").is_file());
        // Déjà retiré : pas une erreur.
        remove_storage(root, PRINCIPAL).unwrap();
    }

    #[test]
    fn retirer_un_autre_profil_ne_touche_qu_a_son_dossier() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        touch(&root.join("data.json"));
        touch(&root.join("profils").join(FOYER).join("backups").join("data-1.json"));
        touch(&root.join("profils").join(FOYER).join("sync-target.txt"));

        remove_storage(root, FOYER).unwrap();
        assert!(!root.join("profils").join(FOYER).exists());
        assert!(root.join("data.json").is_file());
        remove_storage(root, FOYER).unwrap();
    }
}
