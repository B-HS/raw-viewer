use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

#[derive(Default)]
struct Inner {
    pending: Vec<PathBuf>,
    ready: bool,
    per_window: HashMap<String, Vec<PathBuf>>,
    next_window: u32,
}

#[derive(Default)]
pub struct OpenQueue {
    inner: Mutex<Inner>,
}

impl OpenQueue {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn accept(&self, path: PathBuf) -> Option<PathBuf> {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        if inner.ready {
            Some(path)
        } else {
            inner.pending.push(path);
            None
        }
    }

    pub fn ready_and_drain(&self) -> Vec<PathBuf> {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.ready = true;
        std::mem::take(&mut inner.pending)
    }

    pub fn next_window_label(&self) -> String {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.next_window += 1;
        format!("window-{}", inner.next_window)
    }

    pub fn enqueue_for_window(&self, label: &str, path: PathBuf) {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.per_window.entry(label.to_owned()).or_default().push(path);
    }

    pub fn drain_window(&self, label: &str) -> Vec<PathBuf> {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.per_window.remove(label).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffers_until_ready_then_emits_directly() {
        let queue = OpenQueue::new();
        assert_eq!(queue.accept(PathBuf::from("/a.cr2")), None);
        assert_eq!(queue.accept(PathBuf::from("/b.cr2")), None);
        let drained = queue.ready_and_drain();
        assert_eq!(drained, vec![PathBuf::from("/a.cr2"), PathBuf::from("/b.cr2")]);
        assert_eq!(queue.accept(PathBuf::from("/c.cr2")), Some(PathBuf::from("/c.cr2")));
    }

    #[test]
    fn window_labels_increment_and_never_reuse() {
        let queue = OpenQueue::new();
        assert_eq!(queue.next_window_label(), "window-1");
        assert_eq!(queue.next_window_label(), "window-2");
        assert_eq!(queue.next_window_label(), "window-3");
    }

    #[test]
    fn per_window_entries_are_isolated_and_drained_once() {
        let queue = OpenQueue::new();
        let a = queue.next_window_label();
        let b = queue.next_window_label();
        queue.enqueue_for_window(&a, PathBuf::from("/a1.cr2"));
        queue.enqueue_for_window(&a, PathBuf::from("/a2.cr2"));
        queue.enqueue_for_window(&b, PathBuf::from("/b1.cr2"));
        assert_eq!(queue.drain_window(&b), vec![PathBuf::from("/b1.cr2")]);
        assert_eq!(queue.drain_window(&a), vec![PathBuf::from("/a1.cr2"), PathBuf::from("/a2.cr2")]);
        assert!(queue.drain_window(&a).is_empty());
        assert!(queue.drain_window("window-unknown").is_empty());
    }

    #[test]
    fn per_window_queue_does_not_touch_main_cold_start() {
        let queue = OpenQueue::new();
        let label = queue.next_window_label();
        queue.enqueue_for_window(&label, PathBuf::from("/w.cr2"));
        assert_eq!(queue.accept(PathBuf::from("/main.cr2")), None);
        assert_eq!(queue.ready_and_drain(), vec![PathBuf::from("/main.cr2")]);
        assert_eq!(queue.drain_window(&label), vec![PathBuf::from("/w.cr2")]);
    }
}
