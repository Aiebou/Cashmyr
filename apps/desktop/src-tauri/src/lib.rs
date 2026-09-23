//! Enveloppe de bureau de Cashmyr : une fenêtre, les plugins de fichiers et de dialogues,
//! et les commandes du fichier de synchronisation. Aucun accès réseau.

#[cfg(target_os = "macos")]
mod menu;
mod sync_file;

use tauri::Manager;

pub fn run() {
    let builder = tauri::Builder::default()
        // En premier : relancer l'application ramène la fenêtre ouverte au lieu d'ouvrir une
        // seconde instance qui écrirait dans les mêmes fichiers.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let store = app.path().app_data_dir()?.join(sync_file::TARGET_FILE);
            app.manage(sync_file::SyncTarget::load(store));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sync_file::sync_choose,
            sync_file::sync_status,
            sync_file::sync_target_name,
            sync_file::sync_read,
            sync_file::sync_write_atomic,
            sync_file::sync_forget,
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build);

    builder
        .run(tauri::generate_context!())
        .expect("Cashmyr n'a pas pu démarrer");
}
