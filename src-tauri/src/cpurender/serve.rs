use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

pub const AETH_MAGIC: &[u8; 4] = b"AETH";
pub const AETH_HEADER_LEN: usize = 16;
pub const AETH_FMT_U8: u8 = 0;
pub const AETH_CHANNELS_RGBA: u8 = 4;

const MAX_FRAMES: usize = 6;

pub fn serialize_cpu_aeth(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(AETH_HEADER_LEN + rgba.len());
    out.extend_from_slice(AETH_MAGIC);
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    out.push(AETH_FMT_U8);
    out.push(AETH_CHANNELS_RGBA);
    out.extend_from_slice(&[0u8, 0u8]);
    out.extend_from_slice(rgba);
    out
}

struct Slot {
    body: Arc<Vec<u8>>,
    rev: u32,
    tick: u64,
}

#[derive(Default)]
struct Inner {
    frames: HashMap<String, Slot>,
    tick: u64,
    next_rev: u32,
}

#[derive(Default)]
pub struct CpuFrameStore {
    inner: Mutex<Inner>,
}

impl CpuFrameStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn put(&self, image_id: &str, body: Arc<Vec<u8>>) -> u32 {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.tick += 1;
        inner.next_rev += 1;
        let tick = inner.tick;
        let rev = inner.next_rev;
        inner.frames.insert(image_id.to_owned(), Slot { body, rev, tick });
        while inner.frames.len() > MAX_FRAMES {
            let victim = inner.frames.iter().min_by_key(|(_, slot)| slot.tick).map(|(key, _)| key.clone());
            match victim {
                Some(key) => {
                    inner.frames.remove(&key);
                }
                None => break,
            }
        }
        rev
    }

    pub fn get(&self, image_id: &str) -> Option<Arc<Vec<u8>>> {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.tick += 1;
        let tick = inner.tick;
        let slot = inner.frames.get_mut(image_id)?;
        slot.tick = tick;
        Some(Arc::clone(&slot.body))
    }

    pub fn rev(&self, image_id: &str) -> Option<u32> {
        let inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.frames.get(image_id).map(|slot| slot.rev)
    }

    pub fn remove(&self, image_id: &str) {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.frames.remove(image_id);
    }

    pub fn len(&self) -> usize {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner).frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_aeth_header_declares_u8_rgba() {
        let body = serialize_cpu_aeth(2, 1, &[10, 20, 30, 40, 50, 60, 70, 80]);
        assert_eq!(&body[0..4], AETH_MAGIC.as_slice());
        assert_eq!(u32::from_le_bytes([body[4], body[5], body[6], body[7]]), 2);
        assert_eq!(u32::from_le_bytes([body[8], body[9], body[10], body[11]]), 1);
        assert_eq!(body[12], AETH_FMT_U8);
        assert_eq!(body[13], AETH_CHANNELS_RGBA);
        assert_eq!(body.len(), AETH_HEADER_LEN + 8);
        assert_eq!(&body[AETH_HEADER_LEN..], &[10, 20, 30, 40, 50, 60, 70, 80]);
    }

    #[test]
    fn put_bumps_rev_and_serves_latest_body() {
        let store = CpuFrameStore::new();
        let rev1 = store.put("a", Arc::new(vec![1, 2, 3]));
        let rev2 = store.put("a", Arc::new(vec![4, 5, 6]));
        assert_eq!(rev1, 1);
        assert_eq!(rev2, 2);
        assert_eq!(store.get("a").map(|body| body.to_vec()), Some(vec![4, 5, 6]));
        assert_eq!(store.rev("a"), Some(2));
        assert!(store.get("missing").is_none());
    }

    #[test]
    fn store_caps_frame_count() {
        let store = CpuFrameStore::new();
        for i in 0..(MAX_FRAMES + 3) {
            store.put(&format!("id-{i}"), Arc::new(vec![i as u8]));
        }
        assert!(store.len() <= MAX_FRAMES);
        assert!(store.get(&format!("id-{}", MAX_FRAMES + 2)).is_some());
        assert!(store.get("id-0").is_none());
    }

    #[test]
    fn remove_drops_frame() {
        let store = CpuFrameStore::new();
        store.put("a", Arc::new(vec![9]));
        store.remove("a");
        assert!(store.get("a").is_none());
    }
}
