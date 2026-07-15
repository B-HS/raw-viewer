use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::catalog::Catalog;
use crate::error::AppResult;
use crate::lens::db::LensIndex;
use crate::lens::matching::{self, LensQuery};
use crate::types_lens::{LensProfileMatch, LensProfileSummary};

pub const LIST_LIMIT: usize = 50;

pub struct LensService {
    catalog: Catalog,
    db_dir: PathBuf,
    index: OnceLock<LensIndex>,
}

impl LensService {
    pub fn open_default(db_dir: PathBuf) -> AppResult<Self> {
        Ok(Self::with_catalog(Catalog::open_default()?, db_dir))
    }

    pub fn open_memory(db_dir: PathBuf) -> AppResult<Self> {
        Ok(Self::with_catalog(Catalog::open_memory()?, db_dir))
    }

    pub fn with_catalog(catalog: Catalog, db_dir: PathBuf) -> Self {
        Self {
            catalog,
            db_dir,
            index: OnceLock::new(),
        }
    }

    fn index(&self) -> &LensIndex {
        self.index.get_or_init(|| LensIndex::load_dir(&self.db_dir))
    }

    pub fn find_profile(&self, query: &LensQuery) -> AppResult<Option<LensProfileMatch>> {
        let override_profile = matching::lens_key(query.lens_make.as_deref(), query.lens_model.as_deref())
            .map(|key| self.catalog.load_lens_override(&key))
            .transpose()?
            .flatten();
        Ok(matching::find_profile(self.index(), query, override_profile.as_deref()))
    }

    pub fn list_profiles(&self, query: &str) -> Vec<LensProfileSummary> {
        matching::search_profiles(self.index(), query, LIST_LIMIT)
            .into_iter()
            .map(|(id, name)| LensProfileSummary { id, name })
            .collect()
    }

    pub fn set_override(&self, lens_key: &str, profile_id: &str) -> AppResult<()> {
        self.catalog.set_lens_override(lens_key, profile_id, now_ms())
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"<?xml version="1.0"?>
<lensdatabase version="2">
    <mount><name>Canon EF</name></mount>
    <camera>
        <maker>Canon</maker>
        <model>Canon EOS 5D Mark III</model>
        <mount>Canon EF</mount>
        <cropfactor>1</cropfactor>
    </camera>
    <lens>
        <maker>Canon</maker>
        <model>Canon EF 50mm f/1.8 STM</model>
        <mount>Canon EF</mount>
        <focal value="50"/>
        <cropfactor>1</cropfactor>
        <calibration>
            <distortion model="poly3" focal="50" k1="-0.008"/>
        </calibration>
    </lens>
</lensdatabase>
"#;

    fn service_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("raw-viewer-lens-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("slr-canon.xml"), FIXTURE);
        dir
    }

    fn memory_service(dir: PathBuf) -> LensService {
        match LensService::open_memory(dir) {
            Ok(service) => service,
            Err(error) => panic!("open_memory failed: {error}"),
        }
    }

    #[test]
    fn lazy_loads_database_and_lists_profiles() {
        let dir = service_dir("list");
        let service = memory_service(dir.clone());
        let profiles = service.list_profiles("50mm");
        assert!(matches!(profiles.first(), Some(profile) if profile.name.contains("50mm")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn override_persists_and_redirects_find_profile() {
        let dir = service_dir("override");
        let service = memory_service(dir.clone());
        let profile_id = service.list_profiles("50mm").first().map(|profile| profile.id.clone()).unwrap_or_default();
        assert!(!profile_id.is_empty());

        let unknown = LensQuery {
            camera_make: Some("Canon".to_owned()),
            camera_model: Some("Canon EOS 5D Mark III".to_owned()),
            lens_make: Some("Canon".to_owned()),
            lens_model: Some("Mystery Lens 999".to_owned()),
            focal: Some(50.0),
            aperture: Some(1.8),
            distance: None,
        };
        assert!(service.find_profile(&unknown).ok().flatten().is_none());

        if let Some(key) = matching::lens_key(unknown.lens_make.as_deref(), unknown.lens_model.as_deref()) {
            let _ = service.set_override(&key, &profile_id);
        }
        let matched = service.find_profile(&unknown).ok().flatten().unwrap_or_else(|| panic!("override should redirect to profile"));
        assert_eq!(matched.lens_name, "Canon EF 50mm f/1.8 STM");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
