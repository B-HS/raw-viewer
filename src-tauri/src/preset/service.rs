use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::catalog::{Catalog, PresetRecord};
use crate::edit::EditService;
use crate::error::{AppError, AppResult};
use crate::preset::bundled::bundled_presets;
use crate::preset::mask::{masked_from_default, merge_onto_target};
use crate::types::EditState;
use crate::types_preset::{PresetInfo, PresetSource};

pub struct PresetService {
    catalog: Catalog,
}

impl PresetService {
    pub fn open_default() -> AppResult<Self> {
        Ok(Self::with_catalog(Catalog::open_default()?))
    }

    pub fn open_memory() -> AppResult<Self> {
        Ok(Self::with_catalog(Catalog::open_memory()?))
    }

    pub fn with_catalog(catalog: Catalog) -> Self {
        let service = Self { catalog };
        if let Err(error) = service.seed_builtins() {
            tracing::warn!(%error, "preset builtin seeding failed");
        }
        service
    }

    fn seed_builtins(&self) -> AppResult<()> {
        if self.catalog.count_builtin_presets()? > 0 {
            return Ok(());
        }
        let now = now_ms();
        for preset in bundled_presets() {
            let mask: Vec<String> = preset.mask.iter().map(|value| (*value).to_owned()).collect();
            let normalized = masked_from_default(&preset.state, &mask);
            let record = PresetRecord {
                id: new_id(),
                name: preset.name.to_owned(),
                folder: preset.folder.to_owned(),
                edit_state: serialize_state(&normalized)?,
                field_mask: serialize_mask(&mask)?,
                source: PresetSource::Native.as_str().to_owned(),
                builtin: true,
                created_at: now,
            };
            self.catalog.insert_preset(&record)?;
        }
        tracing::info!("seeded builtin presets");
        Ok(())
    }

    pub fn list(&self) -> AppResult<Vec<PresetInfo>> {
        let records = self.catalog.list_presets()?;
        records.into_iter().map(record_to_info).collect()
    }

    pub fn save(&self, name: String, folder: String, source: &EditState, mask: Vec<String>) -> AppResult<PresetInfo> {
        self.save_with_source(name, folder, source, mask, PresetSource::Native)
    }

    pub fn save_with_source(&self, name: String, folder: String, source: &EditState, mask: Vec<String>, origin: PresetSource) -> AppResult<PresetInfo> {
        let normalized = masked_from_default(source, &mask);
        let record = PresetRecord {
            id: new_id(),
            name,
            folder,
            edit_state: serialize_state(&normalized)?,
            field_mask: serialize_mask(&mask)?,
            source: origin.as_str().to_owned(),
            builtin: false,
            created_at: now_ms(),
        };
        self.catalog.insert_preset(&record)?;
        record_to_info(record)
    }

    pub fn load_state(&self, preset_id: &str) -> AppResult<EditState> {
        let record = self
            .catalog
            .load_preset(preset_id)?
            .ok_or_else(|| AppError::Io(format!("unknown preset id: {preset_id}")))?;
        deserialize_state(&record.edit_state)
    }

    pub fn delete(&self, preset_id: &str) -> AppResult<()> {
        self.catalog.delete_preset(preset_id)?;
        Ok(())
    }

    pub fn apply(&self, edits: &EditService, preset_id: &str, targets: &[(String, PathBuf, bool)]) -> AppResult<()> {
        let record = self
            .catalog
            .load_preset(preset_id)?
            .ok_or_else(|| AppError::Io(format!("unknown preset id: {preset_id}")))?;
        let source = deserialize_state(&record.edit_state)?;
        let mask = deserialize_mask(&record.field_mask)?;
        for (image_id, path, is_raw) in targets {
            merge_onto_target(edits, image_id, path, *is_raw, &source, &mask, Some(&record.name))?;
        }
        Ok(())
    }
}

fn record_to_info(record: PresetRecord) -> AppResult<PresetInfo> {
    Ok(PresetInfo {
        id: record.id,
        name: record.name,
        folder: record.folder,
        field_mask: deserialize_mask(&record.field_mask)?,
        source: PresetSource::parse(&record.source),
        builtin: record.builtin,
        created_at: record.created_at as f64,
    })
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn serialize_state(state: &EditState) -> AppResult<String> {
    serde_json::to_string(state).map_err(|error| AppError::Internal(error.to_string()))
}

fn deserialize_state(json: &str) -> AppResult<EditState> {
    serde_json::from_str(json).map_err(|error| AppError::Internal(error.to_string()))
}

fn serialize_mask(mask: &[String]) -> AppResult<String> {
    serde_json::to_string(mask).map_err(|error| AppError::Internal(error.to_string()))
}

fn deserialize_mask(json: &str) -> AppResult<Vec<String>> {
    serde_json::from_str(json).map_err(|error| AppError::Internal(error.to_string()))
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edit::default_edit_state;

    struct Fixture {
        dir: PathBuf,
    }

    impl Fixture {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("raw-viewer-preset-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            let _ = std::fs::create_dir_all(&dir);
            Self { dir }
        }

        fn image(&self, name: &str) -> (String, PathBuf) {
            let path = self.dir.join(name);
            let _ = std::fs::write(&path, b"raw-bytes");
            (crate::scan::image_id(&path), path)
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
    fn seeds_ten_builtin_presets_on_first_open() {
        let service = memory_service();
        let presets = service.list().unwrap_or_default();
        assert_eq!(presets.len(), 10);
        assert!(presets.iter().all(|preset| preset.builtin));
        assert!(presets.iter().all(|preset| preset.source == PresetSource::Native));
    }

    #[test]
    fn seeding_is_idempotent_across_reopen() {
        let fixture = Fixture::new("seed-idem");
        let db = fixture.dir.join("catalog.sqlite");

        let first = {
            let catalog = Catalog::open_at(&db).unwrap_or_else(|error| panic!("open_at failed: {error}"));
            PresetService::with_catalog(catalog).list().unwrap_or_default().len()
        };
        let second = {
            let catalog = Catalog::open_at(&db).unwrap_or_else(|error| panic!("reopen failed: {error}"));
            PresetService::with_catalog(catalog).list().unwrap_or_default().len()
        };
        assert_eq!(first, 10);
        assert_eq!(second, 10);
    }

    #[test]
    fn save_then_list_and_delete_roundtrip() {
        let service = memory_service();
        let mut source = default_edit_state();
        source.tone.exposure = 1.25;
        source.color.saturation = 40.0;

        let saved = service
            .save("My Look".to_owned(), "Custom".to_owned(), &source, vec!["tone".to_owned()])
            .unwrap_or_else(|error| panic!("save failed: {error}"));
        assert_eq!(saved.name, "My Look");
        assert_eq!(saved.folder, "Custom");
        assert_eq!(saved.field_mask, vec!["tone".to_owned()]);
        assert!(!saved.builtin);
        assert_eq!(saved.source, PresetSource::Native);

        let listed = service.list().unwrap_or_default();
        assert_eq!(listed.len(), 11);
        assert!(listed.iter().any(|preset| preset.id == saved.id));

        let _ = service.delete(&saved.id);
        let after = service.list().unwrap_or_default();
        assert_eq!(after.len(), 10);
        assert!(!after.iter().any(|preset| preset.id == saved.id));
    }

    #[test]
    fn save_stores_only_masked_sections() {
        let service = memory_service();
        let mut source = default_edit_state();
        source.tone.exposure = 2.0;
        source.color.saturation = 55.0;

        let saved = service
            .save("ToneOnly".to_owned(), String::new(), &source, vec!["tone".to_owned()])
            .unwrap_or_else(|error| panic!("save failed: {error}"));

        let Some(record) = service.catalog.load_preset(&saved.id).ok().flatten() else {
            panic!("preset record missing after save");
        };
        let stored: EditState = match serde_json::from_str(&record.edit_state) {
            Ok(state) => state,
            Err(error) => panic!("stored edit_state parse failed: {error}"),
        };
        assert_eq!(stored.tone.exposure, 2.0);
        assert_eq!(stored.color.saturation, 0.0);
    }

    #[test]
    fn apply_merges_masked_sections_bumps_version_and_persists() {
        let fixture = Fixture::new("apply");
        let (image_id, path) = fixture.image("target.cr2");

        let presets = memory_service();
        let mut source = default_edit_state();
        source.tone.exposure = 1.5;
        let preset = presets
            .save("Boost".to_owned(), String::new(), &source, vec!["tone".to_owned()])
            .unwrap_or_else(|error| panic!("save failed: {error}"));

        let edits = EditService::open_memory().unwrap_or_else(|error| panic!("edit open_memory failed: {error}"));
        let mut pre_edit = default_edit_state();
        pre_edit.color.saturation = 20.0;
        let base_version = edits.set(&image_id, &path, true, pre_edit, 0).unwrap_or_else(|error| panic!("set failed: {error}"));

        let _ = presets.apply(&edits, &preset.id, &[(image_id.clone(), path.clone(), true)]);

        let envelope = edits.get_or_load(&image_id, &path, true).unwrap_or_else(|error| panic!("get_or_load failed: {error}"));
        assert_eq!(envelope.edit_version, base_version + 1);
        assert_eq!(envelope.state.tone.exposure, 1.5);
        assert_eq!(envelope.state.color.saturation, 20.0);
        assert_eq!(envelope.state.meta.applied_preset.as_deref(), Some("Boost"));
    }

    #[test]
    fn apply_unknown_preset_errors() {
        let fixture = Fixture::new("apply-missing");
        let (image_id, path) = fixture.image("t.cr2");
        let presets = memory_service();
        let edits = EditService::open_memory().unwrap_or_else(|error| panic!("edit open_memory failed: {error}"));
        let result = presets.apply(&edits, "does-not-exist", &[(image_id, path, true)]);
        assert!(matches!(result, Err(AppError::Io(_))));
    }
}
