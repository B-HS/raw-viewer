use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::catalog::{Catalog, OrganizeRow};
use crate::edit::default_edit_state;
use crate::error::AppResult;
use crate::types::EditState;
use crate::types_meta::{Flag, OrganizeEntry};
use crate::xmp::{self, OrganizeFields};

pub const XMP_DEBOUNCE: Duration = Duration::from_secs(4);
const TIMER_POLL: Duration = Duration::from_millis(250);

struct Entry {
    path: PathBuf,
    fields: OrganizeFields,
    xmp_deadline: Option<Instant>,
}

struct FlushTask {
    path: PathBuf,
    fields: OrganizeFields,
}

struct Shared {
    catalog: Catalog,
    entries: Mutex<HashMap<String, Entry>>,
    sidecar_enabled: bool,
    xmp_debounce: Duration,
    shutdown: AtomicBool,
    wake: (Mutex<bool>, Condvar),
}

pub struct OrganizeService {
    shared: Arc<Shared>,
}

impl OrganizeService {
    pub fn open_default() -> AppResult<Self> {
        Ok(Self::with_catalog(Catalog::open_default()?))
    }

    pub fn open_memory() -> AppResult<Self> {
        Ok(Self::with_catalog(Catalog::open_memory()?))
    }

    pub fn with_catalog(catalog: Catalog) -> Self {
        Self::configure(catalog, true, XMP_DEBOUNCE)
    }

    pub fn configure(catalog: Catalog, sidecar_enabled: bool, xmp_debounce: Duration) -> Self {
        let shared = Arc::new(Shared {
            catalog,
            entries: Mutex::new(HashMap::new()),
            sidecar_enabled,
            xmp_debounce,
            shutdown: AtomicBool::new(false),
            wake: (Mutex::new(false), Condvar::new()),
        });
        let timer_shared = Arc::clone(&shared);
        let _ = std::thread::Builder::new()
            .name("organize-flush-timer".to_owned())
            .spawn(move || run_timer(timer_shared));
        Self { shared }
    }

    pub fn set_rating(&self, items: &[(String, PathBuf)], rating: u8) -> AppResult<()> {
        let clamped = rating.min(5);
        for (image_id, path) in items {
            let mut fields = self.shared.current_fields(image_id, path)?;
            fields.rating = clamped;
            self.shared.catalog.set_rating(path, clamped, now_ms())?;
            self.shared.stage(image_id, path, fields);
        }
        Ok(())
    }

    pub fn set_flag(&self, items: &[(String, PathBuf)], flag: Option<Flag>) -> AppResult<()> {
        for (image_id, path) in items {
            let mut fields = self.shared.current_fields(image_id, path)?;
            fields.flag = flag;
            self.shared.catalog.set_flag(path, flag.map(Flag::as_str), now_ms())?;
            self.shared.stage(image_id, path, fields);
        }
        Ok(())
    }

    pub fn set_label(&self, items: &[(String, PathBuf)], label: Option<String>) -> AppResult<()> {
        for (image_id, path) in items {
            let mut fields = self.shared.current_fields(image_id, path)?;
            fields.label = label.clone();
            self.shared.catalog.set_label(path, label.as_deref(), now_ms())?;
            self.shared.stage(image_id, path, fields);
        }
        Ok(())
    }

    pub fn get_organize(&self, items: &[(String, PathBuf)]) -> AppResult<Vec<OrganizeEntry>> {
        let mut out = Vec::with_capacity(items.len());
        for (image_id, path) in items {
            let fields = self.shared.current_fields(image_id, path)?;
            out.push(OrganizeEntry {
                image_id: image_id.clone(),
                rating: fields.rating,
                flag: fields.flag,
                label: fields.label,
            });
        }
        Ok(out)
    }

    pub fn flush_all(&self) {
        self.shared.flush(true);
    }
}

impl Drop for OrganizeService {
    fn drop(&mut self) {
        self.shared.shutdown.store(true, Ordering::Relaxed);
        let (lock, cvar) = &self.shared.wake;
        {
            let mut guard = lock.lock().unwrap_or_else(PoisonError::into_inner);
            *guard = true;
        }
        cvar.notify_all();
    }
}

fn run_timer(shared: Arc<Shared>) {
    loop {
        if shared.shutdown.load(Ordering::Relaxed) {
            return;
        }
        shared.flush(false);
        let (lock, cvar) = &shared.wake;
        let guard = lock.lock().unwrap_or_else(PoisonError::into_inner);
        let _ = cvar.wait_timeout(guard, TIMER_POLL);
    }
}

impl Shared {
    fn current_fields(&self, image_id: &str, path: &Path) -> AppResult<OrganizeFields> {
        {
            let entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some(entry) = entries.get(image_id) {
                return Ok(entry.fields.clone());
            }
        }
        let catalog_fields = self.catalog.load_organize(path)?.map(row_to_fields).unwrap_or_default();
        if catalog_fields.is_empty() {
            if let Ok(sidecar) = xmp::read_organize(path) {
                if !sidecar.is_empty() {
                    self.import(path, &sidecar)?;
                    return Ok(sidecar);
                }
            }
        }
        Ok(catalog_fields)
    }

    fn import(&self, path: &Path, fields: &OrganizeFields) -> AppResult<()> {
        let now = now_ms();
        self.catalog.set_rating(path, fields.rating, now)?;
        self.catalog.set_flag(path, fields.flag.map(Flag::as_str), now)?;
        self.catalog.set_label(path, fields.label.as_deref(), now)?;
        Ok(())
    }

    fn stage(&self, image_id: &str, path: &Path, fields: OrganizeFields) {
        let deadline = Instant::now() + self.xmp_debounce;
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        entries.insert(
            image_id.to_owned(),
            Entry {
                path: path.to_owned(),
                fields,
                xmp_deadline: Some(deadline),
            },
        );
    }

    fn flush(&self, force: bool) {
        let tasks = self.collect(force);
        for task in tasks {
            self.run_task(task);
        }
    }

    fn collect(&self, force: bool) -> Vec<FlushTask> {
        let now = Instant::now();
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        let mut tasks = Vec::new();
        for entry in entries.values_mut() {
            let due = entry.xmp_deadline.is_some_and(|deadline| force || now >= deadline);
            if !due {
                continue;
            }
            tasks.push(FlushTask {
                path: entry.path.clone(),
                fields: entry.fields.clone(),
            });
            entry.xmp_deadline = None;
        }
        tasks
    }

    fn run_task(&self, task: FlushTask) {
        if !self.sidecar_enabled {
            return;
        }
        let edit_state = self.load_edit_state(&task.path);
        let skip = task.fields.is_empty() && self.catalog.edit_state_json(&task.path).ok().flatten().is_none() && !xmp::sidecar_path(&task.path).exists();
        if skip {
            return;
        }
        match xmp::write_sidecar_full(&task.path, &edit_state, &task.fields) {
            Ok(()) => {
                if let Some(mtime) = xmp::sidecar_mtime_ns(&task.path) {
                    if let Err(error) = self.catalog.update_sidecar_mtime(&task.path, mtime) {
                        tracing::warn!(%error, "organize sidecar mtime update failed");
                    }
                }
            }
            Err(error) => tracing::warn!(%error, "organize sidecar flush failed"),
        }
    }

    fn load_edit_state(&self, path: &Path) -> EditState {
        match self.catalog.edit_state_json(path) {
            Ok(Some(json)) => serde_json::from_str::<EditState>(&json).unwrap_or_else(|_| default_edit_state()),
            _ => default_edit_state(),
        }
    }
}

fn row_to_fields(row: OrganizeRow) -> OrganizeFields {
    OrganizeFields {
        rating: row.rating,
        flag: row.flag.as_deref().and_then(Flag::parse),
        label: row.label,
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        dir: PathBuf,
    }

    impl Fixture {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("raw-viewer-organize-{tag}-{}", std::process::id()));
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

    fn memory_service() -> OrganizeService {
        match OrganizeService::open_memory() {
            Ok(service) => service,
            Err(error) => panic!("open_memory failed: {error}"),
        }
    }

    #[test]
    fn set_and_get_rating_flag_label() {
        let fixture = Fixture::new("crud");
        let a = fixture.image("a.cr2");
        let b = fixture.image("b.cr2");
        let service = memory_service();

        let items = vec![a.clone(), b.clone()];
        let _ = service.set_rating(&items, 4);
        let _ = service.set_flag(std::slice::from_ref(&a), Some(Flag::Pick));
        let _ = service.set_label(std::slice::from_ref(&b), Some("Blue".to_owned()));

        let loaded = service.get_organize(&items).ok();
        let Some(entries) = loaded else {
            panic!("get_organize returned nothing");
        };
        let entry_a = entries.iter().find(|entry| entry.image_id == a.0);
        let entry_b = entries.iter().find(|entry| entry.image_id == b.0);
        assert!(matches!(entry_a, Some(entry) if entry.rating == 4 && entry.flag == Some(Flag::Pick) && entry.label.is_none()));
        assert!(matches!(entry_b, Some(entry) if entry.rating == 4 && entry.flag.is_none() && entry.label.as_deref() == Some("Blue")));
    }

    #[test]
    fn clearing_flag_and_rating_zero_persists() {
        let fixture = Fixture::new("clear");
        let a = fixture.image("a.cr2");
        let service = memory_service();
        let items = vec![a.clone()];
        let _ = service.set_rating(&items, 5);
        let _ = service.set_flag(&items, Some(Flag::Reject));
        let _ = service.set_flag(&items, None);
        let _ = service.set_rating(&items, 0);
        let loaded = service.get_organize(&items).ok().and_then(|list| list.into_iter().next());
        assert!(matches!(loaded, Some(entry) if entry.rating == 0 && entry.flag.is_none()));
    }

    #[test]
    fn xmp_debounce_writes_sidecar_and_roundtrips() {
        let fixture = Fixture::new("xmp");
        let catalog_path = fixture.dir.join("catalog.sqlite");
        let a = fixture.image("shot.cr2");
        let catalog = match Catalog::open_at(&catalog_path) {
            Ok(catalog) => catalog,
            Err(error) => panic!("open_at failed: {error}"),
        };
        let service = OrganizeService::configure(catalog, true, Duration::from_millis(20));
        let items = vec![a.clone()];
        let _ = service.set_rating(&items, 3);
        let _ = service.set_label(&items, Some("Green".to_owned()));
        std::thread::sleep(TIMER_POLL + Duration::from_millis(300));

        let sidecar = xmp::sidecar_path(&a.1);
        assert!(sidecar.exists(), "expected sidecar written by debounce");
        let organize = xmp::read_organize(&a.1).ok();
        assert!(matches!(organize, Some(fields) if fields.rating == 3 && fields.label.as_deref() == Some("Green")));
    }

    #[test]
    fn imports_rating_from_existing_sidecar() {
        let fixture = Fixture::new("import");
        let a = fixture.image("legacy.cr2");
        let sidecar = OrganizeFields {
            rating: 5,
            flag: Some(Flag::Pick),
            label: Some("Purple".to_owned()),
        };
        if let Err(error) = xmp::write_sidecar_full(&a.1, &default_edit_state(), &sidecar) {
            panic!("write_sidecar_full failed: {error}");
        }
        let service = memory_service();
        let loaded = service.get_organize(std::slice::from_ref(&a)).ok().and_then(|list| list.into_iter().next());
        assert!(matches!(loaded, Some(entry) if entry.rating == 5 && entry.flag == Some(Flag::Pick) && entry.label.as_deref() == Some("Purple")));
    }
}
