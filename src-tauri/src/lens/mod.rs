pub mod db;
pub mod matching;
pub mod service;

#[cfg(test)]
mod tests;

use tauri::State;

use crate::error::AppResult;
use crate::lens::matching::LensQuery;
use crate::meta;
use crate::pipeline::AppState;
use crate::types_lens::{LensProfileMatch, LensProfileSummary};

pub use service::LensService;

fn query_from_metadata(metadata: &crate::types_meta::ImageMetadata) -> LensQuery {
    LensQuery {
        camera_make: metadata.camera.make.clone(),
        camera_model: metadata.camera.model.clone(),
        lens_make: metadata.lens.make.clone(),
        lens_model: metadata.lens.model.clone(),
        focal: metadata.exposure.focal_length,
        aperture: metadata.exposure.f_number,
        distance: metadata.exposure.subject_distance,
    }
}

#[tauri::command]
pub async fn find_lens_profile(image_id: String, state: State<'_, AppState>, lens: State<'_, LensService>) -> AppResult<Option<LensProfileMatch>> {
    let path = match state.services.registry.resolve(&image_id) {
        Some(path) => path,
        None => return Ok(None),
    };
    let span = tracing::info_span!("find_lens_profile", image_id = %image_id);
    let _guard = span.enter();
    let metadata = meta::build_metadata(&path);
    let query = query_from_metadata(&metadata);
    lens.find_profile(&query)
}

#[tauri::command]
pub async fn list_lens_profiles(query: String, lens: State<'_, LensService>) -> AppResult<Vec<LensProfileSummary>> {
    Ok(lens.list_profiles(&query))
}

#[tauri::command]
pub async fn set_lens_override(lens_key: String, profile_id: String, lens: State<'_, LensService>) -> AppResult<()> {
    lens.set_override(&lens_key, &profile_id)
}
