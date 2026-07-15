use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[cfg(target_os = "macos")]
pub mod macos;

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
