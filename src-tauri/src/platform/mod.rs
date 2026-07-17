use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{AppError, AppResult};
use crate::types_platform::OpenRequestPayload;

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "macos")]
pub mod commands;
pub mod open_queue;
pub mod recents;

pub use open_queue::OpenQueue;
pub use recents::RecentsService;

pub fn ensure_app_bundle(path: &Path) -> AppResult<()> {
    let is_macos_bundle = path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("app")) && path.is_dir();
    let is_windows_executable = cfg!(windows) && path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("exe")) && path.is_file();
    if is_macos_bundle || is_windows_executable {
        Ok(())
    } else {
        Err(AppError::Io(format!("not an application bundle: {}", path.display())))
    }
}

pub fn handle_open(app: &AppHandle, path: PathBuf) {
    match app.state::<OpenQueue>().accept(path) {
        Some(ready) => emit_open(app, ready),
        None => focus_window(app),
    }
}

fn emit_open(app: &AppHandle, path: PathBuf) {
    focus_window(app);
    if let Err(error) = app.emit(crate::events::EVENT_FILE_OPEN_REQUEST, OpenRequestPayload { path }) {
        tracing::warn!(%error, "emit file:open-request failed");
    }
}

fn focus_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentItem {
    pub path: PathBuf,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalApp {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ColorSpaceId {
    DisplayP3,
    Srgb,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessToken {
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashToken {
    pub id: String,
}

#[derive(Debug, Clone)]
pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

pub trait Platform: Send + Sync + 'static {
    fn note_recent_document(&self, path: &Path) -> AppResult<()>;
    fn set_recent_menu(&self, items: &[RecentItem], current: Option<&Path>) -> AppResult<()>;
    fn set_progress_badge(&self, progress: Option<f32>) -> AppResult<()>;
    fn request_attention(&self) -> AppResult<()>;
    fn copy_image(&self, png: &[u8], tiff: Option<&[u8]>) -> AppResult<()>;
    fn copy_files(&self, paths: &[PathBuf]) -> AppResult<()>;
    fn copy_text(&self, text: &str) -> AppResult<()>;
    fn reveal_in_file_manager(&self, path: &Path) -> AppResult<()>;
    fn open_with_app(&self, app: &ExternalApp, paths: &[PathBuf]) -> AppResult<()>;
    fn list_default_apps(&self, ext: &str) -> AppResult<Vec<ExternalApp>>;
    fn display_color_space(&self) -> AppResult<ColorSpaceId>;
    fn display_icc_profile(&self) -> AppResult<Option<Vec<u8>>>;
    fn create_bookmark(&self, path: &Path) -> AppResult<Vec<u8>>;
    fn resolve_bookmark(&self, data: &[u8]) -> AppResult<PathBuf>;
    fn start_access(&self, path: &Path) -> AppResult<AccessToken>;
    fn decode_heic(&self, bytes: &[u8]) -> AppResult<DecodedImage>;
    fn move_to_trash(&self, paths: &[PathBuf]) -> AppResult<Vec<TrashToken>>;
    fn restore_from_trash(&self, token: &TrashToken) -> AppResult<PathBuf>;
}

#[cfg(target_os = "macos")]
pub type CurrentPlatform = macos::MacOsPlatform;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_app_bundle_ok_for_app_directory() {
        let dir = std::env::temp_dir().join(format!("raw-viewer-bundle-{}.app", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        assert!(ensure_app_bundle(&dir).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_app_bundle_rejects_missing_path() {
        let missing = std::env::temp_dir().join("raw-viewer-bundle-does-not-exist.app");
        assert!(matches!(ensure_app_bundle(&missing), Err(AppError::Io(_))));
    }

    #[test]
    fn ensure_app_bundle_rejects_non_app_path() {
        let dir = std::env::temp_dir().join(format!("raw-viewer-bundle-plain-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        assert!(matches!(ensure_app_bundle(&dir), Err(AppError::Io(_))));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
