use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::platform::{AccessToken, ColorSpaceId, DecodedImage, ExternalApp, Platform, RecentItem, TrashToken};

#[derive(Debug, Default)]
pub struct MacOsPlatform;

impl Platform for MacOsPlatform {
    fn note_recent_document(&self, _path: &Path) -> AppResult<()> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn set_recent_menu(&self, _items: &[RecentItem], _current: Option<&Path>) -> AppResult<()> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn set_progress_badge(&self, _progress: Option<f32>) -> AppResult<()> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn request_attention(&self) -> AppResult<()> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn copy_image(&self, _png: &[u8], _tiff: Option<&[u8]>) -> AppResult<()> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn copy_files(&self, _paths: &[PathBuf]) -> AppResult<()> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn copy_text(&self, _text: &str) -> AppResult<()> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn reveal_in_file_manager(&self, _path: &Path) -> AppResult<()> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn open_with_app(&self, _app: &ExternalApp, _paths: &[PathBuf]) -> AppResult<()> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn list_default_apps(&self, _ext: &str) -> AppResult<Vec<ExternalApp>> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn display_color_space(&self) -> AppResult<ColorSpaceId> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn display_icc_profile(&self) -> AppResult<Option<Vec<u8>>> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn create_bookmark(&self, _path: &Path) -> AppResult<Vec<u8>> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn resolve_bookmark(&self, _data: &[u8]) -> AppResult<PathBuf> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn start_access(&self, path: &Path) -> AppResult<AccessToken> {
        Ok(AccessToken { path: path.to_path_buf() })
    }

    fn decode_heic(&self, _bytes: &[u8]) -> AppResult<DecodedImage> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn move_to_trash(&self, _paths: &[PathBuf]) -> AppResult<Vec<TrashToken>> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn restore_from_trash(&self, _token: &TrashToken) -> AppResult<PathBuf> {
        Err(AppError::NotSupportedOnPlatform)
    }
}
