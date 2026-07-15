use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

#[derive(Default)]
struct Inner {
    pending: Vec<PathBuf>,
    ready: bool,
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
}
