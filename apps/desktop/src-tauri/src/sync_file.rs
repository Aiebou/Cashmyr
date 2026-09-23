//! Fichier de synchronisation choisi par l'utilisateur.
//!
//! Le contrat côté front est décrit dans `packages/storage/src/tauri/sync.ts`. Les commandes
//! n'agissent que sur le chemin choisi dans le dialogue natif et mémorisé ici : le front ne
//! peut pas leur en passer un autre. Le chemin est gardé dans `sync-target.txt`, dans le
//! répertoire de données de l'application : `plugin-fs` n'a pas le droit de toucher ce
//! fichier (voir `capabilities/default.json`), et `plugin-store`, qui n'écrit que du JSON,
//! ne peut pas en produire un valide.

use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::hash::{BuildHasher, Hasher};
use std::io::{self, ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

/// Nom du fichier où le chemin choisi est mémorisé, dans le répertoire de données.
pub const TARGET_FILE: &str = "sync-target.txt";
/// Première ligne de ce fichier ; le chemin suit, tel quel.
const TARGET_HEADER: &str = "cashmyr-sync-target 1\n";
const SUGGESTED_NAME: &str = "finances-sync.json";

/// Le fichier choisi, s'il y en a un.
pub struct SyncTarget {
    /// Où le chemin est mémorisé.
    store: PathBuf,
    path: Mutex<Option<PathBuf>>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Unconfigured,
    Ready,
    Missing,
}

impl SyncTarget {
    /// Relit le chemin mémorisé ; un fichier absent ou illisible vaut « aucun fichier choisi ».
    pub fn load(store: PathBuf) -> Self {
        let path = fs::read_to_string(&store).ok().and_then(|text| {
            text.strip_prefix(TARGET_HEADER)
                .filter(|p| !p.is_empty())
                .map(PathBuf::from)
        });
        Self {
            store,
            path: Mutex::new(path),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Option<PathBuf>> {
        self.path.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn current(&self) -> Option<PathBuf> {
        self.lock().clone()
    }

    /// Mémorise un nouveau chemin, sur disque puis en mémoire.
    pub fn set(&self, path: PathBuf) -> io::Result<()> {
        let mut current = self.lock();
        let text = format!(
            "{TARGET_HEADER}{}",
            path.to_str()
                .ok_or_else(|| io::Error::new(ErrorKind::InvalidInput, "chemin non pris en charge"))?
        );
        if let Some(dir) = self.store.parent() {
            fs::create_dir_all(dir)?;
        }
        write_atomic(&self.store, text.as_bytes())?;
        *current = Some(path);
        Ok(())
    }

    /// Oublie le chemin. Le fichier de synchronisation lui-même n'est pas touché.
    pub fn forget(&self) -> io::Result<()> {
        let mut current = self.lock();
        match fs::remove_file(&self.store) {
            Err(e) if e.kind() != ErrorKind::NotFound => return Err(e),
            _ => {}
        }
        *current = None;
        Ok(())
    }
}

pub fn status_of(path: Option<&Path>) -> Status {
    match path {
        None => Status::Unconfigured,
        Some(p) if p.is_file() => Status::Ready,
        Some(_) => Status::Missing,
    }
}

pub fn name_of(path: &Path) -> Option<String> {
    path.file_name().map(|n| n.to_string_lossy().into_owned())
}

/// Contenu du fichier, ou `None` s'il a disparu.
pub fn read_target(path: &Path) -> io::Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Remplace le contenu du fichier choisi. Refusé s'il a disparu : on ne recrée pas en
/// silence un fichier que l'utilisateur a pu déplacer ou supprimer.
pub fn write_target(path: &Path, content: &str) -> io::Result<()> {
    if !path.is_file() {
        return Err(io::Error::new(ErrorKind::NotFound, "le fichier choisi est introuvable"));
    }
    write_atomic(path, content.as_bytes())
}

/// Écrit `<fichier>.tmp-<aléa>` dans le même dossier, le force sur disque, puis le renomme
/// par-dessus l'original : un lecteur voit l'ancien contenu ou le nouveau, jamais un mélange.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = match path.parent() {
        Some(d) if !d.as_os_str().is_empty() => d,
        _ => Path::new("."),
    };
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(ErrorKind::InvalidInput, "chemin sans nom de fichier"))?;
    let mut tmp_name = OsString::from(name);
    tmp_name.push(format!(".tmp-{:016x}", random()));
    let tmp = dir.join(tmp_name);

    let result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        file.write_all(bytes)?;
        // Garde les droits de l'original (un fichier en 600 le reste).
        if let Ok(meta) = fs::metadata(path) {
            file.set_permissions(meta.permissions())?;
        }
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)?;
        sync_dir(dir);
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Le renommage lui-même est durable une fois le dossier forcé sur disque.
#[cfg(unix)]
fn sync_dir(dir: &Path) {
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

/// Suffixe du fichier temporaire. `create_new` garantit qu'il n'écrase rien.
fn random() -> u64 {
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    hasher.write_u128(nanos);
    hasher.finish()
}

/// Premier fichier « à créer » : vide, comme le fait `showSaveFilePicker`. Un fichier
/// existant est gardé tel quel ; le moteur de synchronisation décide de son sort.
fn ensure_exists(path: &Path) -> io::Result<()> {
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Err(e) if e.kind() != ErrorKind::AlreadyExists => Err(e),
        _ => Ok(()),
    }
}

// ── Commandes ────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChooseKind {
    Open,
    Create,
}

#[derive(Serialize)]
pub struct Chosen {
    name: String,
}

fn fail(what: &str, e: impl std::fmt::Display) -> String {
    format!("{what} : {e}")
}

fn configured(target: &SyncTarget) -> Result<PathBuf, String> {
    target
        .current()
        .ok_or_else(|| "Aucun fichier de synchronisation n'est choisi.".to_string())
}

/// Les accès disque passent hors du fil principal : un dossier cloud peut faire attendre.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_choose(
    app: AppHandle,
    target: State<'_, SyncTarget>,
    kind: ChooseKind,
) -> Result<Option<Chosen>, String> {
    let dialog = app.dialog().file().add_filter("Fichier de synchronisation", &["json"]);
    let picked = blocking(move || match kind {
        ChooseKind::Open => dialog
            .set_title("Choisir le fichier de synchronisation")
            .blocking_pick_file(),
        ChooseKind::Create => dialog
            .set_title("Créer le fichier de synchronisation")
            .set_file_name(SUGGESTED_NAME)
            .blocking_save_file(),
    })
    .await?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| fail("Chemin inutilisable", e))?;
    let name = name_of(&path).ok_or("Chemin sans nom de fichier.")?;
    if let ChooseKind::Create = kind {
        let p = path.clone();
        blocking(move || ensure_exists(&p))
            .await?
            .map_err(|e| fail("Création du fichier impossible", e))?;
    }
    target
        .set(path)
        .map_err(|e| fail("Mémorisation du fichier impossible", e))?;
    Ok(Some(Chosen { name }))
}

#[tauri::command]
pub async fn sync_status(target: State<'_, SyncTarget>) -> Result<Status, String> {
    let path = target.current();
    blocking(move || status_of(path.as_deref())).await
}

#[tauri::command]
pub fn sync_target_name(target: State<'_, SyncTarget>) -> Option<String> {
    target.current().as_deref().and_then(name_of)
}

#[tauri::command]
pub async fn sync_read(target: State<'_, SyncTarget>) -> Result<Option<String>, String> {
    let path = configured(&target)?;
    blocking(move || read_target(&path))
        .await?
        .map_err(|e| fail("Lecture du fichier de synchronisation impossible", e))
}

#[tauri::command]
pub async fn sync_write_atomic(target: State<'_, SyncTarget>, content: String) -> Result<(), String> {
    let path = configured(&target)?;
    blocking(move || write_target(&path, &content))
        .await?
        .map_err(|e| fail("Écriture du fichier de synchronisation impossible", e))
}

#[tauri::command]
pub fn sync_forget(target: State<'_, SyncTarget>) -> Result<(), String> {
    target.forget().map_err(|e| fail("Impossible d'oublier le fichier", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn le_chemin_choisi_survit_au_redemarrage_puis_s_oublie() {
        let dir = temp();
        let store = dir.path().join("app").join(TARGET_FILE);
        let chosen = dir.path().join("cloud").join("finances-sync.json");

        let target = SyncTarget::load(store.clone());
        assert_eq!(target.current(), None);
        target.set(chosen.clone()).unwrap();
        assert_eq!(SyncTarget::load(store.clone()).current(), Some(chosen));

        target.forget().unwrap();
        assert_eq!(target.current(), None);
        assert!(!store.exists());
        assert_eq!(SyncTarget::load(store.clone()).current(), None);
        // Oublier deux fois n'est pas une erreur.
        target.forget().unwrap();
    }

    #[test]
    fn un_memo_illisible_ou_ecrit_par_plugin_store_vaut_aucun_fichier() {
        let dir = temp();
        let store = dir.path().join(TARGET_FILE);
        for text in [
            "{ tronqué",
            "{\n  \"path\": \"/ailleurs.json\"\n}",
            "cashmyr-sync-target 1\n",
            "",
        ] {
            fs::write(&store, text).unwrap();
            assert_eq!(SyncTarget::load(store.clone()).current(), None, "{text:?}");
        }
    }

    #[test]
    fn statut_non_configure_pret_ou_introuvable() {
        let dir = temp();
        let file = dir.path().join("finances-sync.json");
        assert_eq!(status_of(None), Status::Unconfigured);
        assert_eq!(status_of(Some(&file)), Status::Missing);
        fs::write(&file, "{}").unwrap();
        assert_eq!(status_of(Some(&file)), Status::Ready);
        // Un dossier du même nom n'est pas un fichier prêt.
        let folder = dir.path().join("dossier.json");
        fs::create_dir(&folder).unwrap();
        assert_eq!(status_of(Some(&folder)), Status::Missing);
        assert_eq!(
            serde_json::to_string(&Status::Unconfigured).unwrap(),
            "\"unconfigured\""
        );
    }

    #[test]
    fn lecture_d_un_fichier_disparu() {
        let dir = temp();
        let file = dir.path().join("finances-sync.json");
        assert_eq!(read_target(&file).unwrap(), None);
        fs::write(&file, "contenu").unwrap();
        assert_eq!(read_target(&file).unwrap().as_deref(), Some("contenu"));
    }

    #[test]
    fn ecriture_atomique_remplace_sans_laisser_de_temporaire() {
        let dir = temp();
        let file = dir.path().join("finances-sync.json");
        fs::write(&file, "ancien contenu, plus long que le nouveau").unwrap();
        write_target(&file, "nouveau").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "nouveau");
        assert_eq!(entries(dir.path()), vec!["finances-sync.json"]);
    }

    #[test]
    fn ecriture_refusee_si_le_fichier_a_disparu() {
        let dir = temp();
        let file = dir.path().join("finances-sync.json");
        let err = write_target(&file, "x").unwrap_err();
        assert_eq!(err.kind(), ErrorKind::NotFound);
        assert!(entries(dir.path()).is_empty(), "rien n'est recréé");
    }

    #[cfg(unix)]
    #[test]
    fn ecriture_garde_les_droits_de_l_original() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp();
        let file = dir.path().join("finances-sync.json");
        fs::write(&file, "{}").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        write_target(&file, "{\"a\":1}").unwrap();
        assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn echec_d_ecriture_sans_debris_et_original_intact() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp();
        let file = dir.path().join("finances-sync.json");
        fs::write(&file, "original").unwrap();
        // Dossier en lecture seule : le temporaire ne peut pas être créé.
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o500)).unwrap();
        let result = write_target(&file, "nouveau");
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "original");
        assert_eq!(entries(dir.path()), vec!["finances-sync.json"]);
    }

    #[test]
    fn creation_d_un_fichier_vide_sans_ecraser_l_existant() {
        let dir = temp();
        let fresh = dir.path().join("nouveau.json");
        ensure_exists(&fresh).unwrap();
        assert_eq!(fs::read_to_string(&fresh).unwrap(), "");
        let existing = dir.path().join("finances-sync.json");
        fs::write(&existing, "{\"format\":\"finances-sync\"}").unwrap();
        ensure_exists(&existing).unwrap();
        assert_eq!(fs::read_to_string(&existing).unwrap(), "{\"format\":\"finances-sync\"}");
    }
}
