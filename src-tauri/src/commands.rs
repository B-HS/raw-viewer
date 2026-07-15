use std::path::{Path, PathBuf};

use tauri::ipc::Channel;
use tauri::State;

use crate::edit::EditService;
use crate::error::{AppError, AppResult};
use crate::organize::OrganizeService;
use crate::pipeline::AppState;
use crate::platform::OpenQueue;
use crate::preset::{self, PresetService};
use crate::scan::{self, Registry};
use crate::types::{EditState, EditStateEnvelope, OpenResult, PendingOpenRequest, ScanBatch, ScanSummary};
use crate::types_meta::{Flag, ImageMetadata, OrganizeEntry};
use crate::types_preset::PresetInfo;
use crate::watch::WatchService;
use crate::{meta, trashbin};

fn resolve_path(registry: &Registry, image_id: &str) -> AppResult<PathBuf> {
    registry.resolve(image_id).ok_or_else(|| AppError::Io(format!("unknown image id: {image_id}")))
}

fn resolve_items(registry: &Registry, image_ids: &[String]) -> Vec<(String, PathBuf)> {
    image_ids.iter().filter_map(|id| registry.resolve(id).map(|path| (id.clone(), path))).collect()
}

fn resolve_targets(registry: &Registry, image_ids: &[String]) -> Vec<(String, PathBuf, bool)> {
    image_ids
        .iter()
        .filter_map(|id| registry.resolve(id).map(|path| (id.clone(), scan::is_raw_ext(&path), path)))
        .map(|(id, is_raw, path)| (id, path, is_raw))
        .collect()
}

#[tauri::command]
pub async fn frontend_ready(queue: State<'_, OpenQueue>) -> AppResult<Vec<PendingOpenRequest>> {
    tracing::info!("frontend ready");
    let mut pending: Vec<PendingOpenRequest> = std::env::var("RAW_VIEWER_OPEN")
        .ok()
        .map(|path| PendingOpenRequest { path: PathBuf::from(path) })
        .into_iter()
        .collect();
    for path in queue.ready_and_drain() {
        pending.push(PendingOpenRequest { path });
    }
    Ok(pending)
}

#[tauri::command]
pub async fn open_path(path: PathBuf, state: State<'_, AppState>, edits: State<'_, EditService>) -> AppResult<OpenResult> {
    let span = tracing::info_span!("open_path", path = %path.display());
    let _guard = span.enter();
    let canonical = std::fs::canonicalize(&path)?;
    if !canonical.is_file() {
        return Err(AppError::Io(format!("not a file: {}", canonical.display())));
    }
    let entry = scan::make_entry(canonical.clone());
    state.services.registry.insert(entry.image_id.clone(), canonical.clone());
    let dir = canonical.parent().map(Path::to_path_buf).unwrap_or(canonical);
    edits.on_navigate(&entry.image_id);
    state.pipeline.navigate(entry.image_id.clone(), Vec::new(), Vec::new());
    Ok(OpenResult { entry, dir })
}

#[tauri::command]
pub async fn scan_directory(dir: PathBuf, on_batch: Channel<ScanBatch>, state: State<'_, AppState>) -> AppResult<ScanSummary> {
    let span = tracing::info_span!("scan_directory", dir = %dir.display());
    let _guard = span.enter();
    let root = std::fs::canonicalize(&dir).unwrap_or(dir);
    let summary = scan::scan_stream(&root, &state.services.registry, |batch| {
        if let Err(error) = on_batch.send(batch) {
            tracing::warn!(%error, "scan batch send failed");
        }
    });
    tracing::info!(total = summary.total, "scan complete");
    Ok(summary)
}

#[tauri::command]
pub async fn navigate(
    image_id: String,
    prev_ids: Vec<String>,
    next_ids: Vec<String>,
    state: State<'_, AppState>,
    edits: State<'_, EditService>,
) -> AppResult<()> {
    edits.on_navigate(&image_id);
    state.pipeline.navigate(image_id, prev_ids, next_ids);
    Ok(())
}

#[tauri::command]
pub async fn get_edit_state(image_id: String, state: State<'_, AppState>, edits: State<'_, EditService>) -> AppResult<EditStateEnvelope> {
    let path = resolve_path(&state.services.registry, &image_id)?;
    let is_raw = scan::is_raw_ext(&path);
    edits.get_or_load(&image_id, &path, is_raw)
}

#[tauri::command]
pub async fn set_edit_state(
    image_id: String,
    state: EditState,
    edit_version: u32,
    app: State<'_, AppState>,
    edits: State<'_, EditService>,
) -> AppResult<u32> {
    let path = resolve_path(&app.services.registry, &image_id)?;
    let is_raw = scan::is_raw_ext(&path);
    edits.set(&image_id, &path, is_raw, state, edit_version)
}

#[tauri::command]
pub async fn reset_edit_state(image_id: String, state: State<'_, AppState>, edits: State<'_, EditService>) -> AppResult<EditStateEnvelope> {
    let path = resolve_path(&state.services.registry, &image_id)?;
    let is_raw = scan::is_raw_ext(&path);
    edits.reset(&image_id, &path, is_raw)
}

#[tauri::command]
pub async fn flush_edits(edits: State<'_, EditService>) -> AppResult<()> {
    edits.flush_all();
    Ok(())
}

#[tauri::command]
pub async fn get_metadata(image_id: String, state: State<'_, AppState>) -> AppResult<ImageMetadata> {
    let path = resolve_path(&state.services.registry, &image_id)?;
    let span = tracing::info_span!("get_metadata", image_id = %image_id);
    let _guard = span.enter();
    Ok(meta::build_metadata(&path))
}

#[tauri::command]
pub async fn set_rating(image_ids: Vec<String>, rating: u8, state: State<'_, AppState>, organize: State<'_, OrganizeService>) -> AppResult<()> {
    let items = resolve_items(&state.services.registry, &image_ids);
    organize.set_rating(&items, rating)
}

#[tauri::command]
pub async fn set_flag(image_ids: Vec<String>, flag: Option<Flag>, state: State<'_, AppState>, organize: State<'_, OrganizeService>) -> AppResult<()> {
    let items = resolve_items(&state.services.registry, &image_ids);
    organize.set_flag(&items, flag)
}

#[tauri::command]
pub async fn set_label(image_ids: Vec<String>, label: Option<String>, state: State<'_, AppState>, organize: State<'_, OrganizeService>) -> AppResult<()> {
    let items = resolve_items(&state.services.registry, &image_ids);
    organize.set_label(&items, label)
}

#[tauri::command]
pub async fn get_organize(image_ids: Vec<String>, state: State<'_, AppState>, organize: State<'_, OrganizeService>) -> AppResult<Vec<OrganizeEntry>> {
    let items = resolve_items(&state.services.registry, &image_ids);
    organize.get_organize(&items)
}

#[tauri::command]
pub async fn flush_organize(organize: State<'_, OrganizeService>) -> AppResult<()> {
    organize.flush_all();
    Ok(())
}

#[tauri::command]
pub async fn move_to_trash(image_ids: Vec<String>, state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let span = tracing::info_span!("move_to_trash", count = image_ids.len());
    let _guard = span.enter();
    Ok(trashbin::move_to_trash(&state.services.registry, &state.services.store, &image_ids))
}

#[tauri::command]
pub async fn watch_directory(dir: PathBuf, watch: State<'_, WatchService>) -> AppResult<()> {
    let root = std::fs::canonicalize(&dir).unwrap_or(dir);
    watch.watch(&root)
}

#[tauri::command]
pub async fn list_presets(presets: State<'_, PresetService>) -> AppResult<Vec<PresetInfo>> {
    presets.list()
}

#[tauri::command]
pub async fn save_preset(
    name: String,
    folder: String,
    image_id: String,
    mask: Vec<String>,
    state: State<'_, AppState>,
    edits: State<'_, EditService>,
    presets: State<'_, PresetService>,
) -> AppResult<PresetInfo> {
    let path = resolve_path(&state.services.registry, &image_id)?;
    let is_raw = scan::is_raw_ext(&path);
    let envelope = edits.get_or_load(&image_id, &path, is_raw)?;
    presets.save(name, folder, &envelope.state, mask)
}

#[tauri::command]
pub async fn apply_preset(
    preset_id: String,
    targets: Vec<String>,
    state: State<'_, AppState>,
    edits: State<'_, EditService>,
    presets: State<'_, PresetService>,
) -> AppResult<()> {
    let items = resolve_targets(&state.services.registry, &targets);
    presets.apply(&edits, &preset_id, &items)
}

#[tauri::command]
pub async fn delete_preset(preset_id: String, presets: State<'_, PresetService>) -> AppResult<()> {
    presets.delete(&preset_id)
}

#[tauri::command]
pub async fn copy_settings(
    from: String,
    to: Vec<String>,
    mask: Vec<String>,
    state: State<'_, AppState>,
    edits: State<'_, EditService>,
) -> AppResult<()> {
    let from_path = resolve_path(&state.services.registry, &from)?;
    let from_raw = scan::is_raw_ext(&from_path);
    let source = edits.get_or_load(&from, &from_path, from_raw)?;
    let items = resolve_targets(&state.services.registry, &to);
    preset::copy_settings(&edits, &source.state, &mask, &items)
}
