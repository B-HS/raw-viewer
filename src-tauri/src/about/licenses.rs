use std::path::Path;

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

const LICENSES_RESOURCE: &str = "resources/licenses-rust.html";

#[tauri::command]
pub async fn get_licenses(app: AppHandle) -> AppResult<String> {
    if let Ok(resolved) = app.path().resolve(LICENSES_RESOURCE, BaseDirectory::Resource) {
        if let Ok(contents) = std::fs::read_to_string(&resolved) {
            return Ok(contents);
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join(LICENSES_RESOURCE);
    std::fs::read_to_string(&dev).map_err(|error| AppError::Io(format!("licenses resource unavailable: {error}")))
}
