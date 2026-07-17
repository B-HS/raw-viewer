use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Emitter, Runtime};

use crate::types::{DecodeFailedPayload, LevelReadyPayload, ProxyLevel};

pub const EVENT_LEVEL_READY: &str = "image:level-ready";
pub const EVENT_DECODE_FAILED: &str = "image:decode-failed";
pub const EVENT_FS_CHANGED: &str = "fs:changed";
pub const EVENT_FILE_OPEN_REQUEST: &str = "file:open-request";
pub const EVENT_DOCK_OPEN: &str = "dock:open";
pub const EVENT_RECENTS_CHANGED: &str = "recents:changed";
pub const EVENT_EXPORT_PROGRESS: &str = "export:progress";

#[derive(Default)]
pub struct RevCounters {
    inner: Mutex<HashMap<(String, ProxyLevel), u32>>,
}

impl RevCounters {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    pub fn next(&self, image_id: &str, level: ProxyLevel) -> u32 {
        let mut guard = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let counter = guard.entry((image_id.to_owned(), level)).or_insert(0);
        *counter += 1;
        *counter
    }
}

pub fn emit_level_ready<R: Runtime>(app: &AppHandle<R>, payload: LevelReadyPayload) {
    if let Err(error) = app.emit(EVENT_LEVEL_READY, payload) {
        tracing::warn!(%error, "emit level-ready failed");
    }
}

pub fn emit_decode_failed<R: Runtime>(app: &AppHandle<R>, payload: DecodeFailedPayload) {
    if let Err(error) = app.emit(EVENT_DECODE_FAILED, payload) {
        tracing::warn!(%error, "emit decode-failed failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rev_counter_starts_at_one_and_increments_per_key() {
        let revs = RevCounters::new();
        assert_eq!(revs.next("a", ProxyLevel::L0), 1);
        assert_eq!(revs.next("a", ProxyLevel::L0), 2);
        assert_eq!(revs.next("a", ProxyLevel::L1), 1);
        assert_eq!(revs.next("b", ProxyLevel::L0), 1);
        assert_eq!(revs.next("a", ProxyLevel::L0), 3);
    }
}
