use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::catalog::Catalog;
use crate::edit::defaults::{initial_edit_state, is_default};
use crate::error::{AppError, AppResult};
use crate::types::{EditState, EditStateEnvelope};
use crate::xmp;

pub const CATALOG_DEBOUNCE: Duration = Duration::from_secs(2);
pub const XMP_DEBOUNCE: Duration = Duration::from_secs(10);
const TIMER_POLL: Duration = Duration::from_millis(250);

struct Entry {
    path: PathBuf,
    is_raw: bool,
    state: EditState,
    edit_version: u32,
    content_key: Option<String>,
    catalog_deadline: Option<Instant>,
    xmp_deadline: Option<Instant>,
}

struct FlushTask {
    path: PathBuf,
    state: EditState,
    edit_version: u32,
    content_key: Option<String>,
    do_catalog: bool,
    do_xmp: bool,
}

struct Inner {
    entries: HashMap<String, Entry>,
    current: Option<String>,
}

struct Shared {
    catalog: Catalog,
    inner: Mutex<Inner>,
    sidecar_enabled: bool,
    catalog_debounce: Duration,
    xmp_debounce: Duration,
    shutdown: AtomicBool,
    wake: (Mutex<bool>, Condvar),
}

pub struct EditService {
    shared: Arc<Shared>,
}

impl EditService {
    pub fn open_default() -> AppResult<Self> {
        Ok(Self::with_catalog(Catalog::open_default()?))
    }

    pub fn open_memory() -> AppResult<Self> {
        Ok(Self::with_catalog(Catalog::open_memory()?))
    }

    pub fn with_catalog(catalog: Catalog) -> Self {
        Self::configure(catalog, true, CATALOG_DEBOUNCE, XMP_DEBOUNCE)
    }

    pub fn configure(catalog: Catalog, sidecar_enabled: bool, catalog_debounce: Duration, xmp_debounce: Duration) -> Self {
        let shared = Arc::new(Shared {
            catalog,
            inner: Mutex::new(Inner {
                entries: HashMap::new(),
                current: None,
            }),
            sidecar_enabled,
            catalog_debounce,
            xmp_debounce,
            shutdown: AtomicBool::new(false),
            wake: (Mutex::new(false), Condvar::new()),
        });
        let timer_shared = Arc::clone(&shared);
        let _ = std::thread::Builder::new()
            .name("edit-flush-timer".to_owned())
            .spawn(move || run_timer(timer_shared));
        Self { shared }
    }

    pub fn get_or_load(&self, image_id: &str, path: &Path, is_raw: bool) -> AppResult<EditStateEnvelope> {
        self.shared.get_or_load(image_id, path, is_raw)
    }

    pub fn set(&self, image_id: &str, path: &Path, is_raw: bool, state: EditState, expected_version: u32) -> AppResult<u32> {
        self.shared.set(image_id, path, is_raw, state, expected_version)
    }

    pub fn reset(&self, image_id: &str, path: &Path, is_raw: bool) -> AppResult<EditStateEnvelope> {
        self.shared.reset(image_id, path, is_raw)
    }

    pub fn on_navigate(&self, next_id: &str) {
        self.shared.on_navigate(next_id);
    }

    pub fn flush_all(&self) {
        self.shared.flush(true, None);
    }

    pub fn reassign_path(&self, old_path: &Path, new_path: &Path) -> AppResult<bool> {
        self.shared.catalog.reassign_path(old_path, new_path, now_ms())
    }
}

impl Drop for EditService {
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
        shared.flush(false, None);
        let (lock, cvar) = &shared.wake;
        let guard = lock.lock().unwrap_or_else(PoisonError::into_inner);
        let _ = cvar.wait_timeout(guard, TIMER_POLL);
    }
}

impl Shared {
    fn get_or_load(&self, image_id: &str, path: &Path, is_raw: bool) -> AppResult<EditStateEnvelope> {
        {
            let inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some(entry) = inner.entries.get(image_id) {
                return Ok(envelope(&entry.state, entry.edit_version));
            }
        }
        let (state, version, content_key) = self.load_persisted(path, is_raw)?;
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let entry = inner.entries.entry(image_id.to_owned()).or_insert_with(|| Entry {
            path: path.to_owned(),
            is_raw,
            state,
            edit_version: version,
            content_key,
            catalog_deadline: None,
            xmp_deadline: None,
        });
        Ok(envelope(&entry.state, entry.edit_version))
    }

    fn load_persisted(&self, path: &Path, is_raw: bool) -> AppResult<(EditState, u32, Option<String>)> {
        let record = self.catalog.load_by_path(path)?;
        let content_key = content_key_for(path).or_else(|| record.as_ref().and_then(|value| value.content_key.clone()));
        let sidecar_mtime = xmp::sidecar_mtime_ns(path);
        let xmp_authoritative = match (sidecar_mtime, &record) {
            (Some(mtime), Some(value)) => value.sidecar_mtime_ns.is_none_or(|synced| mtime > synced),
            (Some(_), None) => true,
            (None, _) => false,
        };
        if xmp_authoritative {
            match xmp::read_sidecar(path) {
                Ok(state) => {
                    let base = record.as_ref().map(|value| value.edit_version).unwrap_or(0);
                    let new_version = base + 1;
                    if let Ok(json) = serialize_state(&state) {
                        if let Err(error) =
                            self.catalog
                                .set_edit_forced(path, Some(&json), new_version, content_key.as_deref(), sidecar_mtime, now_ms())
                        {
                            tracing::warn!(%error, "catalog sync from newer sidecar failed");
                        }
                    }
                    return Ok((state, new_version, content_key));
                }
                Err(error) => tracing::warn!(%error, "sidecar parse failed; falling back to catalog"),
            }
        }
        match record {
            Some(record) => {
                let version = record.edit_version;
                match record.edit_state {
                    Some(json) => match serde_json::from_str::<EditState>(&json) {
                        Ok(state) => Ok((state, version, content_key)),
                        Err(error) => {
                            tracing::warn!(%error, "catalog edit_state parse failed; using initial state");
                            Ok((initial_edit_state(path, is_raw), version, content_key))
                        }
                    },
                    None => Ok((initial_edit_state(path, is_raw), version, content_key)),
                }
            }
            None => Ok((initial_edit_state(path, is_raw), 0, content_key)),
        }
    }

    fn set(&self, image_id: &str, path: &Path, is_raw: bool, state: EditState, expected_version: u32) -> AppResult<u32> {
        let content_key = content_key_for(path);
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let current_version = match inner.entries.get(image_id) {
            Some(entry) => entry.edit_version,
            None => self.catalog.load_by_path(path)?.map(|value| value.edit_version).unwrap_or(0),
        };
        if current_version != expected_version {
            return Err(AppError::Conflict);
        }
        let new_version = current_version + 1;
        let now = Instant::now();
        match inner.entries.get_mut(image_id) {
            Some(entry) => {
                entry.state = state;
                entry.path = path.to_owned();
                entry.is_raw = is_raw;
                entry.edit_version = new_version;
                if content_key.is_some() {
                    entry.content_key = content_key;
                }
                entry.catalog_deadline = Some(now + self.catalog_debounce);
                entry.xmp_deadline = Some(now + self.xmp_debounce);
            }
            None => {
                inner.entries.insert(
                    image_id.to_owned(),
                    Entry {
                        path: path.to_owned(),
                        is_raw,
                        state,
                        edit_version: new_version,
                        content_key,
                        catalog_deadline: Some(now + self.catalog_debounce),
                        xmp_deadline: Some(now + self.xmp_debounce),
                    },
                );
            }
        }
        inner.current = Some(image_id.to_owned());
        Ok(new_version)
    }

    fn reset(&self, image_id: &str, path: &Path, is_raw: bool) -> AppResult<EditStateEnvelope> {
        let fresh = initial_edit_state(path, is_raw);
        let json = serialize_state(&fresh)?;
        let content_key = content_key_for(path);
        let sidecar_mtime = xmp::sidecar_mtime_ns(path);
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let current_version = match inner.entries.get(image_id) {
            Some(entry) => entry.edit_version,
            None => self.catalog.load_by_path(path)?.map(|value| value.edit_version).unwrap_or(0),
        };
        let new_version = current_version + 1;
        self.catalog
            .set_edit_forced(path, Some(&json), new_version, content_key.as_deref(), sidecar_mtime, now_ms())?;
        let now = Instant::now();
        inner.entries.insert(
            image_id.to_owned(),
            Entry {
                path: path.to_owned(),
                is_raw,
                state: fresh.clone(),
                edit_version: new_version,
                content_key,
                catalog_deadline: None,
                xmp_deadline: Some(now + self.xmp_debounce),
            },
        );
        inner.current = Some(image_id.to_owned());
        Ok(envelope(&fresh, new_version))
    }

    fn on_navigate(&self, next_id: &str) {
        let previous = {
            let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
            let previous = inner.current.clone();
            inner.current = Some(next_id.to_owned());
            previous
        };
        if let Some(previous) = previous {
            if previous != next_id {
                self.flush(true, Some(&previous));
            }
        }
    }

    fn flush(&self, force: bool, only: Option<&str>) {
        let tasks = self.collect(force, only);
        for task in tasks {
            self.run_task(task);
        }
    }

    fn collect(&self, force: bool, only: Option<&str>) -> Vec<FlushTask> {
        let now = Instant::now();
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let mut tasks = Vec::new();
        for (id, entry) in inner.entries.iter_mut() {
            if only.is_some_and(|target| target != id) {
                continue;
            }
            let catalog_due = entry.catalog_deadline.is_some_and(|deadline| force || now >= deadline);
            let xmp_due = entry.xmp_deadline.is_some_and(|deadline| force || now >= deadline);
            if !catalog_due && !xmp_due {
                continue;
            }
            tasks.push(FlushTask {
                path: entry.path.clone(),
                state: entry.state.clone(),
                edit_version: entry.edit_version,
                content_key: entry.content_key.clone(),
                do_catalog: catalog_due,
                do_xmp: xmp_due,
            });
            if catalog_due {
                entry.catalog_deadline = None;
            }
            if xmp_due {
                entry.xmp_deadline = None;
            }
        }
        tasks
    }

    fn run_task(&self, task: FlushTask) {
        let json = match serialize_state(&task.state) {
            Ok(json) => json,
            Err(error) => {
                tracing::warn!(%error, "edit flush serialization failed");
                return;
            }
        };
        if task.do_catalog {
            if let Err(error) = self.catalog.set_edit_forced(
                &task.path,
                Some(&json),
                task.edit_version,
                task.content_key.as_deref(),
                xmp::sidecar_mtime_ns(&task.path),
                now_ms(),
            ) {
                tracing::warn!(%error, "catalog flush failed");
            }
        }
        if task.do_xmp && self.sidecar_enabled {
            match xmp::write_sidecar(&task.path, &task.state) {
                Ok(()) => {
                    if let Some(mtime) = xmp::sidecar_mtime_ns(&task.path) {
                        if let Err(error) = self.catalog.update_sidecar_mtime(&task.path, mtime) {
                            tracing::warn!(%error, "catalog sidecar mtime update failed");
                        }
                    }
                }
                Err(error) => tracing::warn!(%error, "sidecar flush failed"),
            }
        }
    }
}

fn envelope(state: &EditState, edit_version: u32) -> EditStateEnvelope {
    EditStateEnvelope {
        state: state.clone(),
        edit_version,
        is_default: is_default(state),
    }
}

fn serialize_state(state: &EditState) -> AppResult<String> {
    serde_json::to_string(state).map_err(|error| AppError::Internal(error.to_string()))
}

fn content_key_for(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos();
    Some(crate::cache::derive_key(path.as_os_str().as_encoded_bytes(), mtime, meta.len()))
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edit::defaults::default_edit_state;

    struct Fixture {
        dir: PathBuf,
    }

    impl Fixture {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("raw-viewer-edit-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            let _ = std::fs::create_dir_all(&dir);
            Self { dir }
        }

        fn image(&self, name: &str) -> PathBuf {
            let path = self.dir.join(name);
            let _ = std::fs::write(&path, b"image-bytes");
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn memory_service() -> EditService {
        match EditService::open_memory() {
            Ok(service) => service,
            Err(error) => panic!("open_memory failed: {error}"),
        }
    }

    #[test]
    fn set_then_get_reflects_version_and_is_default() {
        let fixture = Fixture::new("set-get");
        let image = fixture.image("a.jpg");
        let service = memory_service();

        let initial = service.get_or_load("a", &image, false).ok();
        assert!(matches!(initial, Some(ref envelope) if envelope.edit_version == 0));

        let mut edited = default_edit_state();
        edited.tone.exposure = 1.25;
        let version = service.set("a", &image, false, edited.clone(), 0).ok();
        assert_eq!(version, Some(1));

        let loaded = service.get_or_load("a", &image, false).ok();
        assert!(matches!(loaded, Some(ref envelope) if envelope.edit_version == 1 && !envelope.is_default));
        if let Some(envelope) = loaded {
            assert_eq!(envelope.state.tone.exposure, 1.25);
        }
    }

    #[test]
    fn set_with_stale_version_conflicts() {
        let fixture = Fixture::new("conflict");
        let image = fixture.image("b.jpg");
        let service = memory_service();
        let _ = service.get_or_load("b", &image, false);
        let _ = service.set("b", &image, false, default_edit_state(), 0);
        let conflict = service.set("b", &image, false, default_edit_state(), 0);
        assert!(matches!(conflict, Err(AppError::Conflict)));
    }

    #[test]
    fn flush_all_persists_to_catalog_and_sidecar() {
        let fixture = Fixture::new("flush");
        let catalog_path = fixture.dir.join("catalog.sqlite");
        let image = fixture.image("c.jpg");

        let mut edited = default_edit_state();
        edited.color.saturation = 33.0;
        {
            let catalog = match Catalog::open_at(&catalog_path) {
                Ok(catalog) => catalog,
                Err(error) => panic!("open_at failed: {error}"),
            };
            let service = EditService::with_catalog(catalog);
            let _ = service.set("c", &image, false, edited.clone(), 0);
            service.flush_all();
            assert!(xmp::sidecar_path(&image).exists());
        }

        let catalog = match Catalog::open_at(&catalog_path) {
            Ok(catalog) => catalog,
            Err(error) => panic!("reopen failed: {error}"),
        };
        let reopened = EditService::with_catalog(catalog);
        let loaded = reopened.get_or_load("c", &image, false).ok();
        if let Some(envelope) = loaded {
            assert_eq!(envelope.state.color.saturation, 33.0);
            assert_eq!(envelope.edit_version, 1);
        } else {
            panic!("reload returned nothing");
        }
    }

    #[test]
    fn reset_returns_initial_and_clears_edits() {
        let fixture = Fixture::new("reset");
        let image = fixture.image("d.jpg");
        let service = memory_service();
        let mut edited = default_edit_state();
        edited.tone.exposure = -2.0;
        let _ = service.set("d", &image, false, edited, 0);

        let reset = service.reset("d", &image, false).ok();
        if let Some(envelope) = reset {
            assert_eq!(envelope.state.tone.exposure, 0.0);
            assert_eq!(envelope.edit_version, 2);
        } else {
            panic!("reset returned nothing");
        }
    }

    #[test]
    fn newer_sidecar_overrides_catalog() {
        let fixture = Fixture::new("external");
        let image = fixture.image("e.jpg");
        let service = memory_service();

        let mut external = default_edit_state();
        external.tone.contrast = 40.0;
        if let Err(error) = xmp::write_sidecar(&image, &external) {
            panic!("write_sidecar failed: {error}");
        }

        let loaded = service.get_or_load("e", &image, false).ok();
        if let Some(envelope) = loaded {
            assert_eq!(envelope.state.tone.contrast, 40.0);
        } else {
            panic!("load returned nothing");
        }
    }

    #[test]
    fn debounced_flush_writes_after_deadline() {
        let fixture = Fixture::new("debounce");
        let catalog_path = fixture.dir.join("catalog.sqlite");
        let image = fixture.image("f.jpg");
        let catalog = match Catalog::open_at(&catalog_path) {
            Ok(catalog) => catalog,
            Err(error) => panic!("open_at failed: {error}"),
        };
        let service = EditService::configure(catalog, true, Duration::from_millis(20), Duration::from_millis(40));
        let mut edited = default_edit_state();
        edited.effects.dehaze = 10.0;
        let _ = service.set("f", &image, false, edited, 0);
        std::thread::sleep(TIMER_POLL + Duration::from_millis(300));

        let catalog = match Catalog::open_at(&catalog_path) {
            Ok(catalog) => catalog,
            Err(error) => panic!("reopen failed: {error}"),
        };
        let record = catalog.load_by_path(&image).ok().flatten();
        assert!(matches!(record, Some(ref value) if value.edit_state.is_some() && value.edit_version == 1));
    }
}
