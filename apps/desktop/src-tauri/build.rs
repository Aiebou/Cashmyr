// Chaque commande de l'application reçoit une permission `allow-<commande>` : dès lors,
// seules celles que liste `capabilities/default.json` sont appelables depuis l'interface.
const COMMANDS: &[&str] = &[
    "sync_choose",
    "sync_status",
    "sync_target_name",
    "sync_read",
    "sync_write_atomic",
    "sync_forget",
    "profile_select",
    "profile_remove",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("échec de tauri-build");
}
