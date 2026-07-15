use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::catalog::Catalog;
use crate::error::AppResult;
use crate::types_platform::RecentEntry;

const RECENTS_KEEP: usize = 20;

pub struct RecentsService {
    catalog: Catalog,
}

impl RecentsService {
    pub fn open_default() -> AppResult<Self> {
        Ok(Self { catalog: Catalog::open_default()? })
    }

    pub fn open_memory() -> AppResult<Self> {
        Ok(Self { catalog: Catalog::open_memory()? })
    }

    pub fn record(&self, path: &Path) -> AppResult<()> {
        self.catalog.upsert_recent(path, now_ms(), RECENTS_KEEP)
    }

    pub fn list(&self, limit: usize) -> AppResult<Vec<RecentEntry>> {
        let rows = self.catalog.list_recents(RECENTS_KEEP)?;
        let mut out = Vec::with_capacity(limit.min(rows.len()));
        for row in rows {
            let path = PathBuf::from(&row.path);
            if !path.exists() {
                continue;
            }
            let filename = path.file_name().and_then(|value| value.to_str()).unwrap_or_default().to_owned();
            out.push(RecentEntry {
                path,
                filename,
                opened_at: row.opened_at,
            });
            if out.len() >= limit {
                break;
            }
        }
        Ok(out)
    }

    pub fn clear(&self) -> AppResult<()> {
        self.catalog.clear_recents()
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("raw-viewer-recents-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("shot.cr2");
        let _ = std::fs::write(&path, b"x");
        path
    }

    fn service() -> RecentsService {
        match RecentsService::open_memory() {
            Ok(service) => service,
            Err(error) => panic!("open_memory failed: {error}"),
        }
    }

    #[test]
    fn record_then_list_returns_existing_paths() {
        let path = temp_file("record");
        let service = service();
        let _ = service.record(&path);
        let listed = service.list(10).unwrap_or_default();
        assert_eq!(listed.len(), 1);
        assert!(matches!(listed.first(), Some(entry) if entry.path == path && entry.filename == "shot.cr2"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap_or(Path::new("/")));
    }

    #[test]
    fn missing_paths_are_filtered_and_clear_empties() {
        let path = temp_file("missing");
        let service = service();
        let _ = service.record(&path);
        let _ = std::fs::remove_dir_all(path.parent().unwrap_or(Path::new("/")));
        assert!(service.list(10).unwrap_or_default().is_empty());
        let _ = service.clear();
        assert!(service.list(10).unwrap_or_default().is_empty());
    }
}
