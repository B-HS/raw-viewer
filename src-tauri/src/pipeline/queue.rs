use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::Instant;

use crate::types::ProxyLevel;

pub type CancelFlag = Arc<AtomicBool>;

pub struct Job {
    pub priority: u32,
    pub seq: u64,
    pub image_id: String,
    pub level: ProxyLevel,
    pub cancel: CancelFlag,
    pub enqueued_at: Instant,
}

impl PartialEq for Job {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority && self.seq == other.seq
    }
}

impl Eq for Job {}

impl Ord for Job {
    fn cmp(&self, other: &Self) -> Ordering {
        other.priority.cmp(&self.priority).then_with(|| other.seq.cmp(&self.seq))
    }
}

impl PartialOrd for Job {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

struct Inner {
    heap: BinaryHeap<Job>,
    seq: u64,
    shutdown: bool,
}

pub struct JobQueue {
    inner: Mutex<Inner>,
    signal: Condvar,
}

impl Default for JobQueue {
    fn default() -> Self {
        Self::new()
    }
}

impl JobQueue {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                heap: BinaryHeap::new(),
                seq: 0,
                shutdown: false,
            }),
            signal: Condvar::new(),
        }
    }

    pub fn push(&self, priority: u32, image_id: String, level: ProxyLevel, cancel: CancelFlag) {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.seq += 1;
        let seq = inner.seq;
        inner.heap.push(Job {
            priority,
            seq,
            image_id,
            level,
            cancel,
            enqueued_at: Instant::now(),
        });
        drop(inner);
        self.signal.notify_one();
    }

    pub fn pop_blocking(&self) -> Option<Job> {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        loop {
            if let Some(job) = inner.heap.pop() {
                return Some(job);
            }
            if inner.shutdown {
                return None;
            }
            inner = self.signal.wait(inner).unwrap_or_else(PoisonError::into_inner);
        }
    }

    pub fn try_pop(&self) -> Option<Job> {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.heap.pop()
    }

    pub fn shutdown(&self) {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.shutdown = true;
        drop(inner);
        self.signal.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flag() -> CancelFlag {
        Arc::new(AtomicBool::new(false))
    }

    fn drain(queue: &JobQueue) -> Vec<(u32, String, ProxyLevel)> {
        let mut out = Vec::new();
        while let Some(job) = queue.try_pop() {
            out.push((job.priority, job.image_id, job.level));
        }
        out
    }

    #[test]
    fn pops_lowest_priority_number_first() {
        let queue = JobQueue::new();
        queue.push(100, "n0".to_owned(), ProxyLevel::L0, flag());
        queue.push(0, "cur".to_owned(), ProxyLevel::L0, flag());
        queue.push(10, "cur".to_owned(), ProxyLevel::L1, flag());
        let order = drain(&queue);
        assert_eq!(order[0].0, 0);
        assert_eq!(order[1].0, 10);
        assert_eq!(order[2].0, 100);
    }

    #[test]
    fn equal_priority_is_fifo_by_insertion() {
        let queue = JobQueue::new();
        queue.push(100, "a".to_owned(), ProxyLevel::L0, flag());
        queue.push(100, "b".to_owned(), ProxyLevel::L0, flag());
        queue.push(100, "c".to_owned(), ProxyLevel::L0, flag());
        let order: Vec<String> = drain(&queue).into_iter().map(|(_, id, _)| id).collect();
        assert_eq!(order, vec!["a".to_owned(), "b".to_owned(), "c".to_owned()]);
    }

    #[test]
    fn shutdown_unblocks_pop() {
        let queue = Arc::new(JobQueue::new());
        let worker = {
            let queue = Arc::clone(&queue);
            std::thread::spawn(move || queue.pop_blocking().is_none())
        };
        queue.shutdown();
        assert_eq!(worker.join().ok(), Some(true));
    }
}
