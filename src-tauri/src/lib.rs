use tauri::Manager;

mod export;
mod whistle;

#[tauri::command]
async fn whistle_request(
    app: tauri::AppHandle,
    target: String,
    path: String,
    body: Option<String>,
) -> Result<whistle::BridgeResponse, String> {
    let pid_path = app
        .path()
        .home_dir()
        .map_err(|_| "无法定位 Whistle.app 本地凭据文件；请求未发送。".to_string())?
        .join(".whistle_client.pid");
    Ok(whistle::request(target, path, body, pid_path).await)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            whistle_request,
            export::export_yaml
        ])
        .run(tauri::generate_context!())
        .expect("error while running NLab Easy Whistle");
}
