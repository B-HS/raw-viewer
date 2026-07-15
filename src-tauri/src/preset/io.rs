use std::path::Path;

use crate::edit::default_edit_state;
use crate::error::AppResult;
use crate::preset::PresetService;
use crate::types::EditState;
use crate::types_preset::{PresetInfo, PresetSource};
use crate::xmp;

const AETHER_STATE_MARKER: &str = "aether:state=\"";

pub fn export_preset(presets: &PresetService, preset_id: &str, path: &Path) -> AppResult<()> {
    let state = presets.load_state(preset_id)?;
    let xml = xmp::to_preset_xmp_string(&state)?;
    std::fs::write(path, xml)?;
    Ok(())
}

pub fn import_preset(presets: &PresetService, path: &Path) -> AppResult<PresetInfo> {
    let xml = std::fs::read_to_string(path)?;
    let state = xmp::from_xmp_string(&xml)?;
    let source = if xml.contains(AETHER_STATE_MARKER) {
        PresetSource::Native
    } else {
        PresetSource::LrImport
    };
    let name = preset_name_from_path(path);
    // SPEC-GAP: sidecar/crs XMP carries no explicit section mask, so an imported preset's
    // mask is re-derived from non-default sections; a section deliberately masked to a
    // default value is not preserved across export/import.
    let mask = sections_differing_from_default(&state);
    presets.save_with_source(name, String::new(), &state, mask, source)
}

fn preset_name_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.to_owned())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "Imported Preset".to_owned())
}

fn sections_differing_from_default(state: &EditState) -> Vec<String> {
    let base = default_edit_state();
    let mut sections = Vec::new();
    if state.wb != base.wb {
        sections.push("wb".to_owned());
    }
    if state.lens != base.lens {
        sections.push("lens".to_owned());
    }
    if state.geometry != base.geometry || state.crop != base.crop {
        sections.push("geometry".to_owned());
    }
    if state.tone != base.tone {
        sections.push("tone".to_owned());
    }
    if state.curves != base.curves || state.base_curve != base.base_curve {
        sections.push("curves".to_owned());
    }
    if state.color != base.color {
        sections.push("color".to_owned());
    }
    if state.detail != base.detail {
        sections.push("detail".to_owned());
    }
    if state.effects != base.effects {
        sections.push("effects".to_owned());
    }
    sections
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::WbMode;

    struct Fixture {
        dir: std::path::PathBuf,
    }

    impl Fixture {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("raw-viewer-preset-io-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            let _ = std::fs::create_dir_all(&dir);
            Self { dir }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn memory_service() -> PresetService {
        match PresetService::open_memory() {
            Ok(service) => service,
            Err(error) => panic!("open_memory failed: {error}"),
        }
    }

    #[test]
    fn native_preset_round_trips_through_xmp() {
        let fixture = Fixture::new("native");
        let service = memory_service();

        let mut source = default_edit_state();
        source.wb.mode = WbMode::Custom;
        source.wb.temp = 5100.0;
        source.tone.exposure = 0.8;
        source.color.saturation = 30.0;
        let saved = service
            .save("Warm Look".to_owned(), "Custom".to_owned(), &source, vec!["wb".to_owned(), "tone".to_owned(), "color".to_owned()])
            .unwrap_or_else(|error| panic!("save failed: {error}"));

        let path = fixture.dir.join("warm-look.xmp");
        export_preset(&service, &saved.id, &path).unwrap_or_else(|error| panic!("export failed: {error}"));
        assert!(path.is_file());

        let imported = import_preset(&service, &path).unwrap_or_else(|error| panic!("import failed: {error}"));
        assert_eq!(imported.source, PresetSource::Native);
        assert_eq!(imported.name, "warm-look");

        let exported_state = service.load_state(&saved.id).unwrap_or_else(|error| panic!("load exported failed: {error}"));
        let imported_state = service.load_state(&imported.id).unwrap_or_else(|error| panic!("load imported failed: {error}"));
        assert_eq!(imported_state, exported_state);
        assert_eq!(imported_state.wb.temp, 5100.0);
        assert_eq!(imported_state.tone.exposure, 0.8);
        assert_eq!(imported_state.color.saturation, 30.0);
    }

    #[test]
    fn crs_only_file_imports_as_lr_import() {
        let fixture = Fixture::new("crs");
        let service = memory_service();
        let path = fixture.dir.join("lightroom-look.xmp");
        let xml = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF>
  <rdf:Description rdf:about=""
    crs:Temperature="4800"
    crs:Exposure2012="+0.30"
    crs:Contrast2012="+20"
    crs:Vibrance="+15">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        std::fs::write(&path, xml).unwrap_or_else(|error| panic!("write failed: {error}"));

        let imported = import_preset(&service, &path).unwrap_or_else(|error| panic!("import failed: {error}"));
        assert_eq!(imported.source, PresetSource::LrImport);
        assert_eq!(imported.name, "lightroom-look");
        assert!(imported.field_mask.contains(&"wb".to_owned()));
        assert!(imported.field_mask.contains(&"tone".to_owned()));
        assert!(imported.field_mask.contains(&"color".to_owned()));
        assert!(!imported.field_mask.contains(&"detail".to_owned()));

        let state = service.load_state(&imported.id).unwrap_or_else(|error| panic!("load failed: {error}"));
        assert_eq!(state.wb.temp, 4800.0);
        assert!((state.tone.exposure - 0.30).abs() < 1e-9);
        assert_eq!(state.tone.contrast, 20.0);
        assert_eq!(state.color.vibrance, 15.0);
    }

    #[test]
    fn sections_differing_reports_only_changed_groups() {
        let mut state = default_edit_state();
        state.detail.sharpen_amount = 60.0;
        let sections = sections_differing_from_default(&state);
        assert_eq!(sections, vec!["detail".to_owned()]);
    }
}
