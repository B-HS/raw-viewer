use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::edit::{default_edit_state, EditService};
use crate::error::{AppError, AppResult};
use crate::types::EditState;

pub const PRESET_SECTIONS: [&str; 8] = ["wb", "lens", "geometry", "tone", "curves", "color", "detail", "effects"];

const MERGE_RETRIES: usize = 8;

pub fn apply_mask(dst: &mut EditState, src: &EditState, mask: &[String]) {
    for key in mask {
        match key.as_str() {
            "wb" => dst.wb = src.wb.clone(),
            "lens" => dst.lens = src.lens.clone(),
            "geometry" => {
                dst.geometry = src.geometry.clone();
                dst.crop = src.crop.clone();
            }
            "tone" => dst.tone = src.tone.clone(),
            "curves" => {
                dst.curves = src.curves.clone();
                dst.base_curve = src.base_curve;
            }
            "color" => dst.color = src.color.clone(),
            "detail" => dst.detail = src.detail.clone(),
            "effects" => dst.effects = src.effects.clone(),
            other => tracing::warn!(section = %other, "unknown preset mask section ignored"),
        }
    }
}

pub fn masked_from_default(src: &EditState, mask: &[String]) -> EditState {
    let mut state = default_edit_state();
    apply_mask(&mut state, src, mask);
    state
}

pub fn copy_settings(edits: &EditService, source: &EditState, mask: &[String], targets: &[(String, PathBuf, bool)]) -> AppResult<()> {
    for (image_id, path, is_raw) in targets {
        merge_onto_target(edits, image_id, path, *is_raw, source, mask, None)?;
    }
    Ok(())
}

pub fn merge_onto_target(
    edits: &EditService,
    image_id: &str,
    path: &std::path::Path,
    is_raw: bool,
    source: &EditState,
    mask: &[String],
    applied_preset: Option<&str>,
) -> AppResult<()> {
    for _ in 0..MERGE_RETRIES {
        let envelope = edits.get_or_load(image_id, path, is_raw)?;
        let mut state = envelope.state;
        apply_mask(&mut state, source, mask);
        if let Some(name) = applied_preset {
            state.meta.applied_preset = Some(name.to_owned());
        }
        state.meta.modified_at = now_ms() as f64;
        match edits.set(image_id, path, is_raw, state, envelope.edit_version) {
            Ok(_) => return Ok(()),
            Err(AppError::Conflict) => continue,
            Err(error) => return Err(error),
        }
    }
    Err(AppError::Conflict)
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_mask_copies_only_listed_sections() {
        let mut source = default_edit_state();
        source.tone.exposure = 1.5;
        source.tone.contrast = 30.0;
        source.color.saturation = 40.0;
        source.effects.clarity = 20.0;

        let mut dst = default_edit_state();
        apply_mask(&mut dst, &source, &["tone".to_owned()]);

        assert_eq!(dst.tone.exposure, 1.5);
        assert_eq!(dst.tone.contrast, 30.0);
        assert_eq!(dst.color.saturation, 0.0);
        assert_eq!(dst.effects.clarity, 0.0);
    }

    #[test]
    fn geometry_section_carries_crop_and_curves_section_carries_base_curve() {
        use crate::types::{BaseCurveMode, CropState};

        let mut source = default_edit_state();
        source.geometry.rotate90 = 1;
        source.crop = Some(CropState {
            enabled: true,
            left: 0.1,
            top: 0.1,
            right: 0.9,
            bottom: 0.9,
            aspect: "16:9".to_owned(),
        });
        source.base_curve = BaseCurveMode::Filmic;

        let mut dst = default_edit_state();
        apply_mask(&mut dst, &source, &["geometry".to_owned(), "curves".to_owned()]);

        assert_eq!(dst.geometry.rotate90, 1);
        assert!(dst.crop.is_some());
        assert_eq!(dst.base_curve, BaseCurveMode::Filmic);
    }

    #[test]
    fn masked_from_default_resets_unlisted_sections() {
        let mut source = default_edit_state();
        source.tone.exposure = 2.0;
        source.color.saturation = 50.0;

        let masked = masked_from_default(&source, &["tone".to_owned()]);
        assert_eq!(masked.tone.exposure, 2.0);
        assert_eq!(masked.color.saturation, 0.0);
        assert_eq!(masked.color, default_edit_state().color);
    }

    #[test]
    fn unknown_section_is_ignored() {
        let source = default_edit_state();
        let mut dst = default_edit_state();
        apply_mask(&mut dst, &source, &["bogus".to_owned()]);
        assert_eq!(dst, default_edit_state());
    }
}
