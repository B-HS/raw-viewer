pub mod bundled;
pub mod mask;
mod service;

pub use mask::{apply_mask, copy_settings, masked_from_default, merge_onto_target, PRESET_SECTIONS};
pub use service::PresetService;

#[cfg(test)]
mod copy_tests {
    use std::path::PathBuf;

    use crate::edit::{default_edit_state, EditService};
    use crate::preset::copy_settings;

    struct Fixture {
        dir: PathBuf,
    }

    impl Fixture {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("raw-viewer-preset-copy-{tag}-{}", std::process::id()));
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

    #[test]
    fn copy_settings_applies_masked_sections_to_all_targets() {
        let fixture = Fixture::new("multi");
        let a = fixture.image("a.cr2");
        let b = fixture.image("b.cr2");
        let edits = EditService::open_memory().unwrap_or_else(|error| panic!("edit open_memory failed: {error}"));

        let mut source = default_edit_state();
        source.color.saturation = 40.0;
        source.tone.exposure = 1.0;

        let targets = vec![(a.0.clone(), a.1.clone(), true), (b.0.clone(), b.1.clone(), true)];
        let result = copy_settings(&edits, &source, &["color".to_owned()], &targets);
        assert!(result.is_ok());

        for (id, path) in [(&a.0, &a.1), (&b.0, &b.1)] {
            let envelope = edits.get_or_load(id, path, true).unwrap_or_else(|error| panic!("get_or_load failed: {error}"));
            assert_eq!(envelope.state.color.saturation, 40.0);
            assert_eq!(envelope.state.tone.exposure, 0.0);
            assert_eq!(envelope.edit_version, 1);
            assert_eq!(envelope.state.meta.applied_preset, None);
        }
    }
}
