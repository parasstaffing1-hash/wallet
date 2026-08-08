#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{fs, path::Path};
use tauri::Manager;

const MAX_SCAN_FILE_BYTES: u64 = 1024 * 1024;
const MAX_SCAN_FILES: usize = 100_000;
const MAX_SCAN_TOTAL_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct FolderFile {
    name: String,
    relative_path: String,
    size: u64,
    content: String,
}

fn should_skip_directory(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".git"
            | ".next"
            | "node_modules"
            | "dist"
            | "build"
            | "target"
            | "coverage"
            | "vendor"
            | "out"
            | "site"
    )
}

fn collect_folder_files(
    root: &Path,
    current: &Path,
    files: &mut Vec<FolderFile>,
    total_bytes: &mut u64,
) -> Result<(), String> {
    let entries =
        fs::read_dir(current).map_err(|error| format!("Unable to read folder: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Unable to inspect folder: {error}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Unable to inspect file: {error}"))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            if !should_skip_directory(&entry.file_name().to_string_lossy()) {
                collect_folder_files(root, &path, files, total_bytes)?;
            }
            continue;
        }
        if !file_type.is_file() {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|error| format!("Unable to inspect file: {error}"))?;
        if metadata.len() > MAX_SCAN_FILE_BYTES {
            continue;
        }
        if files.len() >= MAX_SCAN_FILES
            || total_bytes.saturating_add(metadata.len()) > MAX_SCAN_TOTAL_BYTES
        {
            return Err(
                "The selected folder is too large to scan safely. Choose a smaller project folder."
                    .to_string(),
            );
        }
        let bytes = fs::read(&path).map_err(|error| format!("Unable to read file: {error}"))?;
        if bytes.contains(&0) {
            continue;
        }
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };
        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let folder_name = root
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "project".to_string());
        files.push(FolderFile {
            name: entry.file_name().to_string_lossy().to_string(),
            relative_path: format!("{folder_name}/{relative_path}"),
            size: metadata.len(),
            content,
        });
        *total_bytes = total_bytes.saturating_add(metadata.len());
    }
    Ok(())
}

#[tauri::command]
fn choose_and_scan_folder() -> Result<Option<Vec<FolderFile>>, String> {
    let Some(folder) = rfd::FileDialog::new()
        .set_title("Choose a project folder")
        .pick_folder()
    else {
        return Ok(None);
    };
    let mut files = Vec::new();
    let mut total_bytes = 0;
    collect_folder_files(&folder, &folder, &mut files, &mut total_bytes)?;
    Ok(Some(files))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_local_data_dir()
                .map_err(|error| format!("Unable to resolve secure storage path: {error}"))?;
            fs::create_dir_all(&app_data_dir)
                .map_err(|error| format!("Unable to create secure storage directory: {error}"))?;
            let salt_path = app_data_dir.join("stronghold-salt.txt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![choose_and_scan_folder])
        .run(tauri::generate_context!())
        .expect("error while running Wallet desktop app");
}
