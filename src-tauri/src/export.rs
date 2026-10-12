use std::{io::Write, path::Path};
use tauri_plugin_dialog::DialogExt;
use tempfile::NamedTempFile;

const TEXT_LIMIT: usize = 1024 * 1024;
const SAVE_ERROR: &str = "无法保存 YAML，原文件未修改。";

fn validate_text(text: &str) -> Result<(), String> {
    if text.len() > TEXT_LIMIT {
        return Err("YAML 文本超过 1 MiB。".to_string());
    }
    Ok(())
}

fn save_yaml(path: &Path, text: &str) -> Result<(), String> {
    validate_text(text)?;
    let parent = path.parent().ok_or("保存位置无效。")?;
    let mut file = NamedTempFile::new_in(parent).map_err(|_| SAVE_ERROR.to_string())?;
    file.write_all(text.as_bytes())
        .map_err(|_| SAVE_ERROR.to_string())?;
    file.as_file()
        .sync_all()
        .map_err(|_| SAVE_ERROR.to_string())?;
    file.persist(path).map_err(|_| SAVE_ERROR.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn export_yaml(app: tauri::AppHandle, text: String) -> Result<bool, String> {
    validate_text(&text)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name("nlab-easy-whistle.yaml")
            .add_filter("YAML", &["yaml", "yml"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|_| "保存位置无效。".to_string())?;
        save_yaml(&path, &text)?;
        Ok(true)
    })
    .await
    .map_err(|_| "YAML 导出任务失败。".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn replaces_existing_yaml_with_complete_utf8_content() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        fs::write(&path, "original content").unwrap();
        save_yaml(&path, "环境: 测试\n").unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), "环境: 测试\n");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_persist_preserves_destination_and_cleans_temporary_file() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("existing");
        fs::create_dir(&destination).unwrap();
        let original = destination.join("config.yaml");
        fs::write(&original, "original content").unwrap();
        assert_eq!(
            save_yaml(&destination, "replacement").unwrap_err(),
            SAVE_ERROR
        );
        assert_eq!(fs::read_to_string(original).unwrap(), "original content");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn text_limit_counts_utf8_bytes_and_keeps_existing_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let text = "x".repeat(TEXT_LIMIT);
        save_yaml(&path, &text).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().len(), TEXT_LIMIT as u64);
        assert!(save_yaml(&path, &(text.clone() + "中")).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), text);
    }
}
