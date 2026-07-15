use std::path::Path;
use std::sync::{Mutex, PoisonError};

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};

const APP_DATA_DIR: &str = "app.raw-viewer";

const MIGRATIONS: &[(&str, &str)] = &[
    ("001_init", include_str!("migrations/001_init.sql")),
    ("002_organize", include_str!("migrations/002_organize.sql")),
    ("003_presets", include_str!("migrations/003_presets.sql")),
    ("004_recents", include_str!("migrations/004_recents.sql")),
    ("005_lens_overrides", include_str!("migrations/005_lens_overrides.sql")),
];

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OrganizeRow {
    pub rating: u8,
    pub flag: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogRecord {
    pub edit_state: Option<String>,
    pub edit_version: u32,
    pub sidecar_mtime_ns: Option<i64>,
    pub content_key: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresetRecord {
    pub id: String,
    pub name: String,
    pub folder: String,
    pub edit_state: String,
    pub field_mask: String,
    pub source: String,
    pub builtin: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecentRow {
    pub path: String,
    pub opened_at: i64,
}

pub struct Catalog {
    conn: Mutex<Connection>,
}

fn db_err(error: rusqlite::Error) -> AppError {
    AppError::Internal(format!("catalog: {error}"))
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

impl Catalog {
    pub fn open_default() -> AppResult<Self> {
        let dir = dirs::data_dir().ok_or_else(|| AppError::Internal("no data directory".to_owned()))?.join(APP_DATA_DIR);
        std::fs::create_dir_all(&dir)?;
        Self::open_at(&dir.join("catalog.sqlite"))
    }

    pub fn open_at(path: &Path) -> AppResult<Self> {
        let conn = Connection::open(path).map_err(db_err)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
            .map_err(db_err)?;
        let catalog = Self { conn: Mutex::new(conn) };
        catalog.migrate()?;
        Ok(catalog)
    }

    pub fn open_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory().map_err(db_err)?;
        conn.execute_batch("PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;").map_err(db_err)?;
        let catalog = Self { conn: Mutex::new(conn) };
        catalog.migrate()?;
        Ok(catalog)
    }

    fn migrate(&self) -> AppResult<()> {
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);")
            .map_err(db_err)?;
        let current: i64 = conn
            .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |row| row.get(0))
            .map_err(db_err)?;
        for (index, (name, sql)) in MIGRATIONS.iter().enumerate() {
            let version = (index + 1) as i64;
            if version > current {
                conn.execute_batch(sql).map_err(db_err)?;
                conn.execute("INSERT INTO schema_version (version) VALUES (?1)", params![version]).map_err(db_err)?;
                tracing::info!(version, migration = name, "catalog migration applied");
            }
        }
        Ok(())
    }

    pub fn schema_version(&self) -> AppResult<i64> {
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |row| row.get(0))
            .map_err(db_err)
    }

    pub fn load_by_path(&self, path: &Path) -> AppResult<Option<CatalogRecord>> {
        let key = path_key(path);
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.query_row(
            "SELECT edit_state, edit_version, sidecar_mtime_ns, content_key, updated_at FROM images WHERE path = ?1",
            params![key],
            |row| {
                Ok(CatalogRecord {
                    edit_state: row.get(0)?,
                    edit_version: row.get::<_, i64>(1)? as u32,
                    sidecar_mtime_ns: row.get(2)?,
                    content_key: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(db_err)
    }

    pub fn set_edit_checked(
        &self,
        path: &Path,
        edit_state: Option<&str>,
        expected_version: u32,
        content_key: Option<&str>,
        sidecar_mtime_ns: Option<i64>,
        updated_at: i64,
    ) -> AppResult<u32> {
        let key = path_key(path);
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        let current: u32 = conn
            .query_row("SELECT edit_version FROM images WHERE path = ?1", params![key], |row| row.get::<_, i64>(0))
            .optional()
            .map_err(db_err)?
            .map(|value| value as u32)
            .unwrap_or(0);
        if current != expected_version {
            return Err(AppError::Conflict);
        }
        let new_version = current + 1;
        write_row(&conn, &key, edit_state, new_version, content_key, sidecar_mtime_ns, updated_at)?;
        Ok(new_version)
    }

    pub fn set_edit_forced(
        &self,
        path: &Path,
        edit_state: Option<&str>,
        version: u32,
        content_key: Option<&str>,
        sidecar_mtime_ns: Option<i64>,
        updated_at: i64,
    ) -> AppResult<()> {
        let key = path_key(path);
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        write_row(&conn, &key, edit_state, version, content_key, sidecar_mtime_ns, updated_at)
    }

    pub fn update_sidecar_mtime(&self, path: &Path, sidecar_mtime_ns: i64) -> AppResult<()> {
        let key = path_key(path);
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.execute("UPDATE images SET sidecar_mtime_ns = ?1 WHERE path = ?2", params![sidecar_mtime_ns, key])
            .map_err(db_err)?;
        Ok(())
    }

    pub fn set_rating(&self, path: &Path, rating: u8, updated_at: i64) -> AppResult<()> {
        let key = path_key(path);
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.execute(
            "INSERT INTO images (path, rating, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at",
            params![key, rating as i64, updated_at],
        )
        .map_err(db_err)?;
        Ok(())
    }

    pub fn set_flag(&self, path: &Path, flag: Option<&str>, updated_at: i64) -> AppResult<()> {
        let key = path_key(path);
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.execute(
            "INSERT INTO images (path, flag, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET flag = excluded.flag, updated_at = excluded.updated_at",
            params![key, flag, updated_at],
        )
        .map_err(db_err)?;
        Ok(())
    }

    pub fn set_label(&self, path: &Path, label: Option<&str>, updated_at: i64) -> AppResult<()> {
        let key = path_key(path);
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.execute(
            "INSERT INTO images (path, label, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at",
            params![key, label, updated_at],
        )
        .map_err(db_err)?;
        Ok(())
    }

    pub fn load_organize(&self, path: &Path) -> AppResult<Option<OrganizeRow>> {
        let key = path_key(path);
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.query_row("SELECT rating, flag, label FROM images WHERE path = ?1", params![key], |row| {
            Ok(OrganizeRow {
                rating: row.get::<_, i64>(0)?.clamp(0, 5) as u8,
                flag: row.get(1)?,
                label: row.get(2)?,
            })
        })
        .optional()
        .map_err(db_err)
    }

    pub fn edit_state_json(&self, path: &Path) -> AppResult<Option<String>> {
        Ok(self.load_by_path(path)?.and_then(|record| record.edit_state))
    }

    pub fn insert_preset(&self, record: &PresetRecord) -> AppResult<()> {
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.execute(
            "INSERT INTO presets (id, name, folder, edit_state, field_mask, source, builtin, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                folder = excluded.folder,
                edit_state = excluded.edit_state,
                field_mask = excluded.field_mask,
                source = excluded.source,
                builtin = excluded.builtin,
                created_at = excluded.created_at",
            params![
                record.id,
                record.name,
                record.folder,
                record.edit_state,
                record.field_mask,
                record.source,
                record.builtin as i64,
                record.created_at,
            ],
        )
        .map_err(db_err)?;
        Ok(())
    }

    pub fn list_presets(&self) -> AppResult<Vec<PresetRecord>> {
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        let mut statement = conn
            .prepare("SELECT id, name, folder, edit_state, field_mask, source, builtin, created_at FROM presets ORDER BY folder, name, created_at")
            .map_err(db_err)?;
        let rows = statement.query_map([], row_to_preset).map_err(db_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(db_err)?);
        }
        Ok(out)
    }

    pub fn load_preset(&self, id: &str) -> AppResult<Option<PresetRecord>> {
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.query_row(
            "SELECT id, name, folder, edit_state, field_mask, source, builtin, created_at FROM presets WHERE id = ?1",
            params![id],
            row_to_preset,
        )
        .optional()
        .map_err(db_err)
    }

    pub fn delete_preset(&self, id: &str) -> AppResult<bool> {
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        let affected = conn.execute("DELETE FROM presets WHERE id = ?1", params![id]).map_err(db_err)?;
        Ok(affected > 0)
    }

    pub fn count_builtin_presets(&self) -> AppResult<i64> {
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.query_row("SELECT COUNT(*) FROM presets WHERE builtin = 1", [], |row| row.get(0))
            .map_err(db_err)
    }

    pub fn upsert_recent(&self, path: &Path, opened_at: i64, keep: usize) -> AppResult<()> {
        let key = path_key(path);
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.execute(
            "INSERT INTO recents (path, opened_at) VALUES (?1, ?2)
             ON CONFLICT(path) DO UPDATE SET opened_at = excluded.opened_at",
            params![key, opened_at],
        )
        .map_err(db_err)?;
        conn.execute(
            "DELETE FROM recents WHERE path NOT IN (SELECT path FROM recents ORDER BY opened_at DESC LIMIT ?1)",
            params![keep as i64],
        )
        .map_err(db_err)?;
        Ok(())
    }

    pub fn list_recents(&self, limit: usize) -> AppResult<Vec<RecentRow>> {
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        let mut statement = conn
            .prepare("SELECT path, opened_at FROM recents ORDER BY opened_at DESC LIMIT ?1")
            .map_err(db_err)?;
        let rows = statement
            .query_map(params![limit as i64], |row| {
                Ok(RecentRow {
                    path: row.get(0)?,
                    opened_at: row.get(1)?,
                })
            })
            .map_err(db_err)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(db_err)?);
        }
        Ok(out)
    }

    pub fn clear_recents(&self) -> AppResult<()> {
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.execute("DELETE FROM recents", []).map_err(db_err)?;
        Ok(())
    }

    pub fn set_lens_override(&self, lens_key: &str, profile_id: &str, updated_at: i64) -> AppResult<()> {
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.execute(
            "INSERT INTO lens_overrides (lens_key, profile_id, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(lens_key) DO UPDATE SET profile_id = excluded.profile_id, updated_at = excluded.updated_at",
            params![lens_key, profile_id, updated_at],
        )
        .map_err(db_err)?;
        Ok(())
    }

    pub fn load_lens_override(&self, lens_key: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        conn.query_row("SELECT profile_id FROM lens_overrides WHERE lens_key = ?1", params![lens_key], |row| row.get(0))
            .optional()
            .map_err(db_err)
    }
}

fn row_to_preset(row: &rusqlite::Row) -> rusqlite::Result<PresetRecord> {
    Ok(PresetRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        folder: row.get(2)?,
        edit_state: row.get(3)?,
        field_mask: row.get(4)?,
        source: row.get(5)?,
        builtin: row.get::<_, i64>(6)? != 0,
        created_at: row.get(7)?,
    })
}

fn write_row(
    conn: &Connection,
    key: &str,
    edit_state: Option<&str>,
    version: u32,
    content_key: Option<&str>,
    sidecar_mtime_ns: Option<i64>,
    updated_at: i64,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO images (path, content_key, edit_state, edit_version, sidecar_mtime_ns, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(path) DO UPDATE SET
            content_key = excluded.content_key,
            edit_state = excluded.edit_state,
            edit_version = excluded.edit_version,
            sidecar_mtime_ns = excluded.sidecar_mtime_ns,
            updated_at = excluded.updated_at",
        params![key, content_key, edit_state, version as i64, sidecar_mtime_ns, updated_at],
    )
    .map_err(db_err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog() -> Catalog {
        match Catalog::open_memory() {
            Ok(catalog) => catalog,
            Err(error) => panic!("open_memory failed: {error}"),
        }
    }

    #[test]
    fn migrate_creates_schema_and_records_version() {
        let catalog = catalog();
        assert_eq!(catalog.schema_version().ok(), Some(MIGRATIONS.len() as i64));
    }

    #[test]
    fn checked_insert_then_optimistic_conflict() {
        let catalog = catalog();
        let path = Path::new("/abs/IMG_1.CR2");
        let version = catalog.set_edit_checked(path, Some("{\"a\":1}"), 0, Some("key"), Some(1000), 42);
        assert_eq!(version.ok(), Some(1));

        let stale = catalog.set_edit_checked(path, Some("{\"a\":2}"), 0, Some("key"), Some(1000), 43);
        assert!(matches!(stale, Err(AppError::Conflict)));

        let fresh = catalog.set_edit_checked(path, Some("{\"a\":2}"), 1, Some("key"), Some(1000), 44);
        assert_eq!(fresh.ok(), Some(2));
    }

    #[test]
    fn load_returns_stored_record() {
        let catalog = catalog();
        let path = Path::new("/abs/IMG_2.CR2");
        let _ = catalog.set_edit_forced(path, Some("{\"x\":true}"), 7, Some("ck"), Some(2000), 99);
        let record = catalog.load_by_path(path).ok().flatten();
        assert_eq!(
            record,
            Some(CatalogRecord {
                edit_state: Some("{\"x\":true}".to_owned()),
                edit_version: 7,
                sidecar_mtime_ns: Some(2000),
                content_key: Some("ck".to_owned()),
                updated_at: 99,
            })
        );
    }

    #[test]
    fn forced_write_allows_null_edit_state_and_updates_sidecar_mtime() {
        let catalog = catalog();
        let path = Path::new("/abs/IMG_3.CR2");
        let _ = catalog.set_edit_forced(path, None, 3, None, None, 10);
        let _ = catalog.update_sidecar_mtime(path, 5555);
        let record = catalog.load_by_path(path).ok().flatten();
        assert!(matches!(record, Some(ref r) if r.edit_state.is_none() && r.sidecar_mtime_ns == Some(5555) && r.edit_version == 3));
    }

    #[test]
    fn missing_path_loads_none() {
        let catalog = catalog();
        assert_eq!(catalog.load_by_path(Path::new("/nope")).ok(), Some(None));
    }

    #[test]
    fn organize_columns_upsert_independently() {
        let catalog = catalog();
        let path = Path::new("/abs/IMG_ORG.CR2");
        let _ = catalog.set_rating(path, 4, 10);
        let _ = catalog.set_flag(path, Some("pick"), 11);
        let _ = catalog.set_label(path, Some("Red"), 12);
        let row = catalog.load_organize(path).ok().flatten();
        assert_eq!(
            row,
            Some(OrganizeRow {
                rating: 4,
                flag: Some("pick".to_owned()),
                label: Some("Red".to_owned()),
            })
        );
        let _ = catalog.set_flag(path, None, 13);
        let cleared = catalog.load_organize(path).ok().flatten();
        assert!(matches!(cleared, Some(ref value) if value.rating == 4 && value.flag.is_none() && value.label.as_deref() == Some("Red")));
    }

    #[test]
    fn lens_override_upserts_and_loads() {
        let catalog = catalog();
        assert_eq!(catalog.load_lens_override("canon|ef 16-35").ok(), Some(None));
        let _ = catalog.set_lens_override("canon|ef 16-35", "profile-a", 10);
        assert_eq!(catalog.load_lens_override("canon|ef 16-35").ok().flatten().as_deref(), Some("profile-a"));
        let _ = catalog.set_lens_override("canon|ef 16-35", "profile-b", 11);
        assert_eq!(catalog.load_lens_override("canon|ef 16-35").ok().flatten().as_deref(), Some("profile-b"));
    }

    #[test]
    fn recents_upsert_caps_and_orders_by_recency() {
        let catalog = catalog();
        for index in 0..25 {
            let path = std::path::PathBuf::from(format!("/abs/IMG_{index}.CR2"));
            let _ = catalog.upsert_recent(&path, index as i64, 20);
        }
        let rows = catalog.list_recents(20).unwrap_or_default();
        assert_eq!(rows.len(), 20);
        assert_eq!(rows.first().map(|row| row.path.as_str()), Some("/abs/IMG_24.CR2"));
        assert_eq!(rows.last().map(|row| row.path.as_str()), Some("/abs/IMG_5.CR2"));

        let _ = catalog.upsert_recent(Path::new("/abs/IMG_5.CR2"), 100, 20);
        let rows = catalog.list_recents(1).unwrap_or_default();
        assert_eq!(rows.first().map(|row| row.path.as_str()), Some("/abs/IMG_5.CR2"));

        let _ = catalog.clear_recents();
        assert!(catalog.list_recents(20).unwrap_or_default().is_empty());
    }

    #[test]
    fn edit_and_organize_columns_coexist_across_connections() -> Result<(), Box<dyn std::error::Error>> {
        let dir = std::env::temp_dir().join(format!("raw-viewer-catalog-coexist-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir)?;
        let db = dir.join("catalog.sqlite");
        let path = Path::new("/abs/IMG_SHARED.CR2");

        let edits = Catalog::open_at(&db)?;
        let organize = Catalog::open_at(&db)?;

        edits.set_edit_forced(path, Some("{\"tone\":1}"), 3, Some("ck"), Some(2000), 100)?;
        organize.set_rating(path, 5, 101)?;

        let record = edits.load_by_path(path)?;
        let row = organize.load_organize(path)?;
        assert!(matches!(record, Some(ref value) if value.edit_state.as_deref() == Some("{\"tone\":1}") && value.edit_version == 3));
        assert_eq!(row, Some(OrganizeRow { rating: 5, flag: None, label: None }));

        edits.set_edit_forced(path, Some("{\"tone\":2}"), 4, Some("ck"), Some(2000), 102)?;
        let preserved = organize.load_organize(path)?;
        assert_eq!(preserved, Some(OrganizeRow { rating: 5, flag: None, label: None }));

        std::fs::remove_dir_all(&dir)?;
        Ok(())
    }
}
