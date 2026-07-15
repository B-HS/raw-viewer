use std::path::PathBuf;

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};
use crate::export::{dng, finish, ExportService};
use crate::pipeline::AppState;
use crate::types_export::{ExportPhase, ExportProgressPayload, RasterExportRequest};

fn header_str(request: &Request<'_>, name: &str) -> AppResult<String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_owned())
        .ok_or_else(|| AppError::Internal(format!("missing export header: {name}")))
}

fn header_u32(request: &Request<'_>, name: &str) -> AppResult<u32> {
    header_str(request, name)?
        .parse::<u32>()
        .map_err(|_| AppError::Internal(format!("invalid export header: {name}")))
}

#[tauri::command]
pub async fn export_begin(request: RasterExportRequest, export: State<'_, ExportService>) -> AppResult<String> {
    export.begin(request)
}

#[tauri::command]
pub fn export_tile(request: Request<'_>, export: State<'_, ExportService>) -> AppResult<()> {
    let job_id = header_str(&request, "x-export-job")?;
    let x = header_u32(&request, "x-tile-x")?;
    let y = header_u32(&request, "x-tile-y")?;
    let width = header_u32(&request, "x-tile-w")?;
    let height = header_u32(&request, "x-tile-h")?;
    let body = match request.body() {
        InvokeBody::Raw(bytes) => bytes.as_slice(),
        InvokeBody::Json(_) => return Err(AppError::Internal("export_tile requires a raw body".to_owned())),
    };
    export.ingest_tile(&job_id, x, y, width, height, body)
}

#[tauri::command]
pub async fn export_finish(job_id: String, app: AppHandle, state: State<'_, AppState>, export: State<'_, ExportService>) -> AppResult<PathBuf> {
    let job = export.take(&job_id).ok_or_else(|| AppError::Internal(format!("unknown export job: {job_id}")))?;
    let source = state
        .services
        .registry
        .resolve(&job.request.image_id)
        .ok_or_else(|| AppError::Internal(format!("unknown image id: {}", job.request.image_id)))?;
    let handle = app.clone();
    let progress_id = job_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        finish::finish_job(&job, &source, |done, total| {
            let _ = handle.emit(
                "export:progress",
                ExportProgressPayload {
                    job_id: progress_id.clone(),
                    phase: ExportPhase::Encode,
                    done,
                    total,
                },
            );
        })
    })
    .await
    .map_err(|error| AppError::Internal(format!("export task failed: {error}")))?
}

#[tauri::command]
pub async fn export_cancel(job_id: String, export: State<'_, ExportService>) -> AppResult<()> {
    export.cancel(&job_id);
    Ok(())
}

#[tauri::command]
pub async fn export_dng(image_id: String, out_dir: PathBuf, state: State<'_, AppState>) -> AppResult<PathBuf> {
    let source = state
        .services
        .registry
        .resolve(&image_id)
        .ok_or_else(|| AppError::Internal(format!("unknown image id: {image_id}")))?;
    tauri::async_runtime::spawn_blocking(move || dng::run_convert(&dng::binary_path(), &source, &out_dir))
        .await
        .map_err(|error| AppError::Internal(format!("dng task failed: {error}")))?
}
