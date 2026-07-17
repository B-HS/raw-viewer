use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::error::{AppError, AppResult};
use crate::scan::{self, image_id};
use crate::types_meta::{FsChangeKind, FsChangedPayload};

pub const DEBOUNCE: Duration = Duration::from_millis(200);

pub type EmitFn = Arc<dyn Fn(FsChangedPayload) + Send + Sync>;
pub type InvalidateFn = Arc<dyn Fn(&str) + Send + Sync>;

enum WatchMsg {
    Event(FsChangeKind, Vec<PathBuf>),
    Shutdown,
}

pub fn classify(kind: &EventKind, paths: &[PathBuf]) -> Option<(FsChangeKind, Vec<PathBuf>)> {
    let change = match kind {
        EventKind::Create(_) => FsChangeKind::Created,
        EventKind::Remove(_) => FsChangeKind::Removed,
        EventKind::Modify(_) => FsChangeKind::Modified,
        _ => return None,
    };
    let supported: Vec<PathBuf> = paths.iter().filter(|path| scan::is_supported(path)).cloned().collect();
    if supported.is_empty() {
        None
    } else {
        Some((change, supported))
    }
}

struct Shared {
    watcher: Mutex<Option<RecommendedWatcher>>,
    current: Mutex<Option<PathBuf>>,
    tx: Sender<WatchMsg>,
}

pub struct WatchService {
    shared: Arc<Shared>,
}

impl WatchService {
    pub fn new(emit: EmitFn, invalidate: InvalidateFn) -> Self {
        Self::configure(emit, invalidate, DEBOUNCE)
    }

    pub fn configure(emit: EmitFn, invalidate: InvalidateFn, debounce: Duration) -> Self {
        let (tx, rx) = channel();
        let shared = Arc::new(Shared {
            watcher: Mutex::new(None),
            current: Mutex::new(None),
            tx,
        });
        let _ = std::thread::Builder::new()
            .name("watch-debounce".to_owned())
            .spawn(move || run_debounce(rx, emit, invalidate, debounce));
        Self { shared }
    }

    pub fn watch(&self, dir: &Path) -> AppResult<()> {
        let tx = self.shared.tx.clone();
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
            if let Ok(event) = result {
                if let Some((kind, paths)) = classify(&event.kind, &event.paths) {
                    let _ = tx.send(WatchMsg::Event(kind, paths));
                }
            }
        })
        .map_err(|error| AppError::Io(format!("watch init: {error}")))?;
        watcher
            .watch(dir, RecursiveMode::NonRecursive)
            .map_err(|error| AppError::Io(format!("watch start: {error}")))?;
        {
            let mut slot = self.shared.watcher.lock().unwrap_or_else(PoisonError::into_inner);
            *slot = Some(watcher);
        }
        {
            let mut current = self.shared.current.lock().unwrap_or_else(PoisonError::into_inner);
            *current = Some(dir.to_owned());
        }
        tracing::info!(dir = %dir.display(), "watching directory");
        Ok(())
    }

    pub fn current(&self) -> Option<PathBuf> {
        self.shared.current.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }
}

impl Drop for WatchService {
    fn drop(&mut self) {
        let _ = self.shared.tx.send(WatchMsg::Shutdown);
        let mut slot = self.shared.watcher.lock().unwrap_or_else(PoisonError::into_inner);
        *slot = None;
    }
}

fn run_debounce(rx: Receiver<WatchMsg>, emit: EmitFn, invalidate: InvalidateFn, debounce: Duration) {
    let mut buffer: HashMap<FsChangeKind, Vec<PathBuf>> = HashMap::new();
    loop {
        let message = if buffer.is_empty() {
            rx.recv().map_err(|_| RecvTimeoutError::Disconnected)
        } else {
            rx.recv_timeout(debounce)
        };
        match message {
            Ok(WatchMsg::Event(kind, paths)) => {
                let bucket = buffer.entry(kind).or_default();
                for path in paths {
                    if !bucket.contains(&path) {
                        bucket.push(path);
                    }
                }
            }
            Ok(WatchMsg::Shutdown) => return,
            Err(RecvTimeoutError::Timeout) => flush(&mut buffer, &emit, &invalidate),
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn flush(buffer: &mut HashMap<FsChangeKind, Vec<PathBuf>>, emit: &EmitFn, invalidate: &InvalidateFn) {
    for (kind, paths) in buffer.drain() {
        if paths.is_empty() {
            continue;
        }
        if kind == FsChangeKind::Modified {
            for path in &paths {
                invalidate(&image_id(path));
            }
        }
        emit(FsChangedPayload { kind, paths });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind, RemoveKind};

    #[test]
    fn classify_maps_kinds_and_filters_extensions() {
        let raw = PathBuf::from("/a/IMG_1.CR2");
        let text = PathBuf::from("/a/notes.txt");
        assert_eq!(
            classify(&EventKind::Create(CreateKind::File), &[raw.clone(), text.clone()]),
            Some((FsChangeKind::Created, vec![raw.clone()]))
        );
        assert_eq!(classify(&EventKind::Remove(RemoveKind::File), std::slice::from_ref(&raw)), Some((FsChangeKind::Removed, vec![raw.clone()])));
        assert_eq!(
            classify(&EventKind::Modify(ModifyKind::Any), std::slice::from_ref(&raw)),
            Some((FsChangeKind::Modified, vec![raw]))
        );
        assert_eq!(classify(&EventKind::Create(CreateKind::File), &[text]), None);
        assert_eq!(classify(&EventKind::Access(notify::event::AccessKind::Any), &[PathBuf::from("/a/IMG.CR2")]), None);
    }

    #[test]
    fn tempdir_create_emits_debounced_fs_changed() {
        let dir = std::env::temp_dir().join(format!("raw-viewer-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        if std::fs::create_dir_all(&dir).is_err() {
            eprintln!("skipping tempdir_create_emits_debounced_fs_changed: cannot create temp dir");
            return;
        }

        let captured: Arc<Mutex<Vec<FsChangedPayload>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&captured);
        let emit: EmitFn = Arc::new(move |payload| {
            sink.lock().unwrap_or_else(PoisonError::into_inner).push(payload);
        });
        let invalidated: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let inv_sink = Arc::clone(&invalidated);
        let invalidate: InvalidateFn = Arc::new(move |id: &str| {
            inv_sink.lock().unwrap_or_else(PoisonError::into_inner).push(id.to_owned());
        });

        let service = WatchService::configure(emit, invalidate, Duration::from_millis(80));
        if let Err(error) = service.watch(&dir) {
            panic!("watch failed: {error}");
        }

        let file = dir.join("dropped.CR2");
        let _ = std::fs::write(&file, b"raw");

        let mut seen = false;
        for _ in 0..80 {
            std::thread::sleep(Duration::from_millis(100));
            let events = captured.lock().unwrap_or_else(PoisonError::into_inner);
            if events.iter().any(|payload| payload.paths.iter().any(|path| path.ends_with("dropped.CR2"))) {
                seen = true;
                break;
            }
        }
        assert!(seen, "expected a debounced fs:changed event for the created file");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
