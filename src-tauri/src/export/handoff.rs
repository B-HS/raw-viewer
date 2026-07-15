use std::path::{Path, PathBuf};

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::platform::{CurrentPlatform, ExternalApp, Platform};

fn ensure_exists(path: &Path) -> AppResult<()> {
    if path.is_file() {
        Ok(())
    } else {
        Err(AppError::Io(format!("edited file does not exist: {}", path.display())))
    }
}

#[tauri::command]
pub fn open_with_edited(path: PathBuf, app_path: PathBuf, platform: State<'_, CurrentPlatform>) -> AppResult<()> {
    ensure_exists(&path)?;
    let app = ExternalApp {
        id: String::new(),
        name: String::new(),
        path: app_path,
    };
    platform.open_with_app(&app, &[path])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_exists_ok_for_real_file() {
        let dir = std::env::temp_dir().join(format!("raw-viewer-handoff-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("IMG-Edit.tif");
        let _ = std::fs::write(&file, b"tiff");
        assert!(ensure_exists(&file).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_exists_errors_for_missing_file() {
        let missing = std::env::temp_dir().join("raw-viewer-handoff-does-not-exist-Edit.tif");
        assert!(matches!(ensure_exists(&missing), Err(AppError::Io(_))));
    }
}
