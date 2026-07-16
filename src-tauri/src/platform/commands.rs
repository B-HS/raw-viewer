use std::collections::HashSet;
use std::path::PathBuf;

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::pipeline::AppState;
use crate::platform::recents::RecentsService;
use crate::platform::{ensure_app_bundle, ColorSpaceId, CurrentPlatform, ExternalApp, Platform};
use crate::scan::pairing;
use crate::types_platform::{PairInfo, RecentEntry};

const RECENTS_UI_LIMIT: usize = 10;

fn png_to_tiff(png: &[u8]) -> AppResult<Vec<u8>> {
    let decoded =
        image::load_from_memory_with_format(png, image::ImageFormat::Png).map_err(|error| AppError::Internal(format!("png decode failed: {error}")))?;
    let mut cursor = std::io::Cursor::new(Vec::new());
    decoded
        .write_to(&mut cursor, image::ImageFormat::Tiff)
        .map_err(|error| AppError::Internal(format!("tiff encode failed: {error}")))?;
    Ok(cursor.into_inner())
}

#[tauri::command]
pub fn copy_image_to_clipboard(request: Request<'_>, platform: State<'_, CurrentPlatform>) -> AppResult<()> {
    let png = match request.body() {
        InvokeBody::Raw(bytes) => bytes.as_slice(),
        InvokeBody::Json(_) => return Err(AppError::Internal("copy_image_to_clipboard requires a raw body".to_owned())),
    };
    let tiff = png_to_tiff(png).ok();
    platform.copy_image(png, tiff.as_deref())
}

#[tauri::command]
pub fn copy_files_to_clipboard(image_ids: Vec<String>, state: State<'_, AppState>, platform: State<'_, CurrentPlatform>) -> AppResult<()> {
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    for id in &image_ids {
        let Some(path) = state.services.registry.resolve(id) else {
            continue;
        };
        if seen.insert(path.clone()) {
            paths.push(path.clone());
        }
        if let Some(dir) = path.parent() {
            for pair in pairing::find_pairs(dir) {
                if pair.raw_id == *id && seen.insert(pair.jpeg_path.clone()) {
                    paths.push(pair.jpeg_path);
                }
            }
        }
    }
    if paths.is_empty() {
        return Err(AppError::Io("no files resolved for clipboard".to_owned()));
    }
    platform.copy_files(&paths)
}

#[tauri::command]
pub fn copy_text(text: String, platform: State<'_, CurrentPlatform>) -> AppResult<()> {
    platform.copy_text(&text)
}

#[tauri::command]
pub fn get_pairs(dir: PathBuf) -> AppResult<Vec<PairInfo>> {
    let root = std::fs::canonicalize(&dir).unwrap_or(dir);
    Ok(pairing::find_pairs(&root))
}

#[tauri::command]
pub fn note_recent(path: PathBuf, recents: State<'_, RecentsService>, platform: State<'_, CurrentPlatform>) -> AppResult<()> {
    let canonical = std::fs::canonicalize(&path).unwrap_or(path);
    recents.record(&canonical)?;
    if let Err(error) = platform.note_recent_document(&canonical) {
        tracing::warn!(%error, "note_recent_document failed");
    }
    super::macos::dock::set_current(Some(canonical));
    Ok(())
}

#[tauri::command]
pub fn get_recents(recents: State<'_, RecentsService>) -> AppResult<Vec<RecentEntry>> {
    recents.list(RECENTS_UI_LIMIT)
}

#[tauri::command]
pub fn clear_recents(recents: State<'_, RecentsService>) -> AppResult<()> {
    recents.clear()
}

#[tauri::command]
pub fn get_display_color_space(platform: State<'_, CurrentPlatform>) -> AppResult<ColorSpaceId> {
    platform.display_color_space()
}

#[tauri::command]
pub fn has_display_icc_profile(platform: State<'_, CurrentPlatform>) -> AppResult<bool> {
    Ok(platform.display_icc_profile().ok().flatten().is_some())
}

#[tauri::command]
pub fn get_display_lut(platform: State<'_, CurrentPlatform>) -> AppResult<Response> {
    let bytes = match platform.display_icc_profile().ok().flatten() {
        Some(icc) => crate::color::display_lut::display_lut_bytes(&icc).unwrap_or_default(),
        None => Vec::new(),
    };
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn reveal_in_file_manager(image_id: String, state: State<'_, AppState>, platform: State<'_, CurrentPlatform>) -> AppResult<()> {
    let path = state
        .services
        .registry
        .resolve(&image_id)
        .ok_or_else(|| AppError::Io(format!("unknown image id: {image_id}")))?;
    platform.reveal_in_file_manager(&path)
}

#[tauri::command]
pub fn open_with_external(image_id: String, app_path: PathBuf, state: State<'_, AppState>, platform: State<'_, CurrentPlatform>) -> AppResult<()> {
    ensure_app_bundle(&app_path)?;
    let path = state
        .services
        .registry
        .resolve(&image_id)
        .ok_or_else(|| AppError::Io(format!("unknown image id: {image_id}")))?;
    let app = ExternalApp {
        id: String::new(),
        name: String::new(),
        path: app_path,
    };
    platform.open_with_app(&app, &[path])
}
