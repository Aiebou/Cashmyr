//! Barre de menus macOS, en français. Celle de Tauri par défaut est en anglais ; sans barre
//! de menus, les raccourcis d'édition (⌘C, ⌘V, ⌘Z…) ne marcheraient pas dans les champs.
//! ⌘N reste libre : l'interface l'utilise pour « Nouvelle opération ».

use tauri::menu::{AboutMetadata, Menu, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID};
use tauri::{AppHandle, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(info.name.clone()),
        version: Some(info.version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        ..Default::default()
    };
    let name = info.name.as_str();

    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                name,
                true,
                &[
                    &PredefinedMenuItem::about(app, Some(&format!("À propos de {name}")), Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, Some("Services"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, Some(&format!("Masquer {name}")))?,
                    &PredefinedMenuItem::hide_others(app, Some("Masquer les autres"))?,
                    &PredefinedMenuItem::show_all(app, Some("Tout afficher"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, Some(&format!("Quitter {name}")))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Édition",
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some("Annuler"))?,
                    &PredefinedMenuItem::redo(app, Some("Rétablir"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, Some("Couper"))?,
                    &PredefinedMenuItem::copy(app, Some("Copier"))?,
                    &PredefinedMenuItem::paste(app, Some("Coller"))?,
                    &PredefinedMenuItem::select_all(app, Some("Tout sélectionner"))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Présentation",
                true,
                &[&PredefinedMenuItem::fullscreen(
                    app,
                    Some("Passer en mode plein écran"),
                )?],
            )?,
            &Submenu::with_id_and_items(
                app,
                WINDOW_SUBMENU_ID,
                "Fenêtre",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, Some("Placer dans le Dock"))?,
                    &PredefinedMenuItem::maximize(app, Some("Réduire/agrandir"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, Some("Fermer la fenêtre"))?,
                ],
            )?,
            &Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Aide", true, &[])?,
        ],
    )
}
