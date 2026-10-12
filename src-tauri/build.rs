fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["whistle_request", "export_yaml"]),
    ))
    .expect("failed to build desktop permissions");
}
