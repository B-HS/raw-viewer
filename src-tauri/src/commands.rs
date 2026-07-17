use std::path::{Path, PathBuf};

use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};

use crate::cpurender::{render_and_store, CpuFrameStore};
use crate::edit::EditService;
use crate::error::{AppError, AppResult};
use crate::organize::OrganizeService;
use crate::pipeline::AppState;
use crate::platform::OpenQueue;
use crate::preset::{self, PresetService};
use crate::scan::{self, Registry};
use crate::types::{EditState, EditStateEnvelope, OpenResult, PendingOpenRequest, ScanBatch, ScanSummary};
use crate::types_cpurender::{CpuFrameReadyPayload, EVENT_CPU_FRAME_READY};
use crate::types_meta::{Flag, ImageMetadata, OrganizeEntry};
use crate::types_performance::{L2Policy, PerfSettings};
use crate::types_preset::PresetInfo;
use crate::watch::WatchService;
use crate::{geocode, meta, trashbin};

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
pub async fn frontend_ready(window: tauri::Window, queue: State<'_, OpenQueue>) -> AppResult<Vec<PendingOpenRequest>> {
    let label = window.label().to_owned();
    tracing::info!(%label, "frontend ready");
    if label != "main" {
        return Ok(queue.drain_window(&label).into_iter().map(|path| PendingOpenRequest { path }).collect());
    }
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
pub async fn open_in_new_window(path: PathBuf, app: AppHandle, queue: State<'_, OpenQueue>) -> AppResult<String> {
    let label = queue.next_window_label();
    queue.enqueue_for_window(&label, path);
    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::default())
        .title("raw-viewer")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .build()
        .map_err(|error| {
            queue.drain_window(&label);
            AppError::Io(format!("create window: {error}"))
        })?;
    Ok(label)
}

#[tauri::command]
pub async fn open_path(path: PathBuf, window: tauri::Window, state: State<'_, AppState>, edits: State<'_, EditService>) -> AppResult<OpenResult> {
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
    state.pipeline.navigate(window.label(), entry.image_id.clone(), Vec::new(), Vec::new());
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
    window: tauri::Window,
    state: State<'_, AppState>,
    edits: State<'_, EditService>,
) -> AppResult<()> {
    edits.on_navigate(&image_id);
    state.pipeline.navigate(window.label(), image_id, prev_ids, next_ids);
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
pub async fn render_cpu_frame(
    image_id: String,
    max_edge: u32,
    app: AppHandle,
    state: State<'_, AppState>,
    edits: State<'_, EditService>,
    cpu_frames: State<'_, CpuFrameStore>,
) -> AppResult<CpuFrameReadyPayload> {
    let span = tracing::info_span!("render_cpu_frame", image_id = %image_id, max_edge);
    let _guard = span.enter();
    let payload = render_and_store(&state.services, &edits, &cpu_frames, &image_id, max_edge)?;
    if let Err(error) = app.emit(EVENT_CPU_FRAME_READY, payload.clone()) {
        tracing::warn!(%error, "emit cpu:frame-ready failed");
    }
    Ok(payload)
}

#[tauri::command]
pub async fn set_performance_settings(preload_radius: u32, l2_policy: L2Policy, isolated_decode: bool, state: State<'_, AppState>) -> AppResult<()> {
    state.pipeline.set_settings(PerfSettings {
        preload_radius,
        l2_policy,
        isolated_decode,
    });
    Ok(())
}

#[tauri::command]
pub async fn get_performance_settings(state: State<'_, AppState>) -> AppResult<PerfSettings> {
    Ok(state.pipeline.settings())
}

#[tauri::command]
pub async fn request_l2(image_id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.pipeline.request_l2(image_id);
    Ok(())
}

#[tauri::command]
pub async fn get_reverse_geocode(image_id: String, state: State<'_, AppState>) -> AppResult<Option<String>> {
    let path = resolve_path(&state.services.registry, &image_id)?;
    let span = tracing::info_span!("get_reverse_geocode", image_id = %image_id);
    let _guard = span.enter();
    let resolved = tauri::async_runtime::spawn_blocking(move || {
        let exif = meta::exif::ExifData::read(&path);
        let gps = meta::gps::from_exif(&exif)?;
        geocode::reverse(gps.lat, gps.lng)
    })
    .await
    .ok()
    .flatten();
    Ok(resolved)
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
pub async fn export_preset(preset_id: String, path: PathBuf, presets: State<'_, PresetService>) -> AppResult<()> {
    preset::io::export_preset(&presets, &preset_id, &path)
}

#[tauri::command]
pub async fn import_preset(path: PathBuf, presets: State<'_, PresetService>) -> AppResult<PresetInfo> {
    preset::io::import_preset(&presets, &path)
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

#[tauri::command]
pub fn toggle_fullscreen(window: tauri::Window) -> AppResult<bool> {
    let next = !window.is_fullscreen().map_err(|error| AppError::Internal(error.to_string()))?;
    window.set_fullscreen(next).map_err(|error| AppError::Internal(error.to_string()))?;
    Ok(next)
}

#[tauri::command]
pub fn fullscreen_state(window: tauri::Window) -> AppResult<bool> {
    window.is_fullscreen().map_err(|error| AppError::Internal(error.to_string()))
}

#[tauri::command]
pub fn register_image(path: PathBuf, state: State<'_, AppState>) -> AppResult<crate::types::ImageEntry> {
    let canonical = path.canonicalize().map_err(|error| AppError::Io(error.to_string()))?;
    if !canonical.is_file() || !scan::is_supported(&canonical) {
        return Err(AppError::Io(format!("unsupported or missing file: {}", canonical.display())));
    }
    let entry = scan::make_entry(canonical);
    state.services.registry.insert(entry.image_id.clone(), entry.path.clone());
    Ok(entry)
}

#[tauri::command]
pub async fn probe_capture_dates(image_ids: Vec<String>, state: State<'_, AppState>) -> AppResult<std::collections::HashMap<String, Option<f64>>> {
    let mut result = std::collections::HashMap::with_capacity(image_ids.len());
    for id in image_ids {
        let capture = state.services.registry.resolve(&id).and_then(|path| meta::capture_ms(&path)).map(|ms| ms as f64);
        result.insert(id, capture);
    }
    Ok(result)
}

fn validate_file_name(name: &str) -> AppResult<()> {
    if name.trim().is_empty() || name.contains('/') || name.contains('\\') || name.starts_with('.') {
        return Err(AppError::Io(format!("invalid file name: {name}")));
    }
    Ok(())
}

fn move_sidecar(old_path: &Path, new_path: &Path) {
    let old_sidecar = crate::xmp::sidecar_path(old_path);
    if old_sidecar.is_file() {
        if let Err(error) = std::fs::rename(&old_sidecar, crate::xmp::sidecar_path(new_path)) {
            tracing::warn!(%error, "sidecar rename failed");
        }
    }
}

#[tauri::command]
pub async fn rename_image(
    image_id: String,
    new_name: String,
    state: State<'_, AppState>,
    edits: State<'_, EditService>,
) -> AppResult<crate::types::ImageEntry> {
    validate_file_name(&new_name)?;
    let old_path = resolve_path(&state.services.registry, &image_id)?;
    let old_ext = old_path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    let new_ext = Path::new(&new_name).extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if old_ext != new_ext {
        return Err(AppError::Io(format!("extension must stay .{old_ext}")));
    }
    let parent = old_path.parent().ok_or_else(|| AppError::Io("no parent directory".into()))?;
    let new_path = parent.join(&new_name);
    if new_path.exists() {
        return Err(AppError::Io(format!("already exists: {new_name}")));
    }
    edits.flush_all();
    std::fs::rename(&old_path, &new_path).map_err(|error| AppError::Io(error.to_string()))?;
    move_sidecar(&old_path, &new_path);
    let _ = edits.reassign_path(&old_path, &new_path);
    state.services.registry.remove(&image_id);
    state.services.store.remove(&image_id);
    let entry = scan::make_entry(new_path);
    state.services.registry.insert(entry.image_id.clone(), entry.path.clone());
    Ok(entry)
}

#[tauri::command]
pub async fn move_images(
    image_ids: Vec<String>,
    dest_dir: PathBuf,
    state: State<'_, AppState>,
    edits: State<'_, EditService>,
) -> AppResult<Vec<String>> {
    if !dest_dir.is_dir() {
        return Err(AppError::Io(format!("not a directory: {}", dest_dir.display())));
    }
    edits.flush_all();
    let mut moved = Vec::new();
    let mut failed: Vec<String> = Vec::new();
    for image_id in image_ids {
        let Some(old_path) = state.services.registry.resolve(&image_id) else {
            failed.push(image_id);
            continue;
        };
        let Some(file_name) = old_path.file_name() else {
            failed.push(image_id);
            continue;
        };
        let new_path = dest_dir.join(file_name);
        if new_path.exists() || std::fs::rename(&old_path, &new_path).is_err() {
            failed.push(image_id);
            continue;
        }
        move_sidecar(&old_path, &new_path);
        let _ = edits.reassign_path(&old_path, &new_path);
        state.services.registry.remove(&image_id);
        state.services.store.remove(&image_id);
        moved.push(image_id);
    }
    if !failed.is_empty() {
        return Err(AppError::Io(format!("{} file(s) could not be moved", failed.len())));
    }
    Ok(moved)
}

#[tauri::command]
pub async fn copy_images(image_ids: Vec<String>, dest_dir: PathBuf, state: State<'_, AppState>) -> AppResult<u32> {
    if !dest_dir.is_dir() {
        return Err(AppError::Io(format!("not a directory: {}", dest_dir.display())));
    }
    let mut copied = 0u32;
    let mut failed = 0u32;
    for image_id in image_ids {
        let Some(path) = state.services.registry.resolve(&image_id) else {
            failed += 1;
            continue;
        };
        let Some(file_name) = path.file_name() else {
            failed += 1;
            continue;
        };
        let target = dest_dir.join(file_name);
        if target.exists() || std::fs::copy(&path, &target).is_err() {
            failed += 1;
            continue;
        }
        let sidecar = crate::xmp::sidecar_path(&path);
        if sidecar.is_file() {
            let _ = std::fs::copy(&sidecar, crate::xmp::sidecar_path(&target));
        }
        copied += 1;
    }
    if failed > 0 {
        return Err(AppError::Io(format!("{failed} file(s) could not be copied")));
    }
    Ok(copied)
}
