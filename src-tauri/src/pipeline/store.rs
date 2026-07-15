use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use half::f16;

use crate::types::ProxyLevel;

pub const DEFAULT_BUDGET_BYTES: usize = 1_500_000_000;

pub const AETH_MAGIC: &[u8; 4] = b"AETH";
pub const AETH_HEADER_LEN: usize = 16;
pub const AETH_FMT_F16: u8 = 2;
pub const AETH_CHANNELS: u8 = 3;

pub fn serialize_aeth(width: u32, height: u32, rgb: &[f16]) -> Vec<u8> {
    let mut out = Vec::with_capacity(AETH_HEADER_LEN + rgb.len() * 2);
    out.extend_from_slice(AETH_MAGIC);
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    out.push(AETH_FMT_F16);
    out.push(AETH_CHANNELS);
    out.extend_from_slice(&[0u8, 0u8]);
    for value in rgb {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AethHeader {
    pub width: u32,
    pub height: u32,
    pub fmt: u8,
    pub channels: u8,
}

pub fn parse_aeth_header(body: &[u8]) -> Option<AethHeader> {
    if body.len() < AETH_HEADER_LEN || &body[0..4] != AETH_MAGIC.as_slice() {
        return None;
    }
    Some(AethHeader {
        width: u32::from_le_bytes([body[4], body[5], body[6], body[7]]),
        height: u32::from_le_bytes([body[8], body[9], body[10], body[11]]),
        fmt: body[12],
        channels: body[13],
    })
}

struct Slot {
    body: Arc<Vec<u8>>,
    bytes: usize,
    last_used: u64,
}

struct Inner {
    map: HashMap<(String, ProxyLevel), Slot>,
    total: usize,
    tick: u64,
    current: Option<String>,
}

pub struct PixelStore {
    inner: Mutex<Inner>,
    budget: usize,
}

impl PixelStore {
    pub fn new(budget: usize) -> Self {
        Self {
            inner: Mutex::new(Inner {
                map: HashMap::new(),
                total: 0,
                tick: 0,
                current: None,
            }),
            budget,
        }
    }

    pub fn set_current(&self, image_id: Option<String>) {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.current = image_id;
    }

    pub fn contains(&self, image_id: &str, level: ProxyLevel) -> bool {
        let inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.map.contains_key(&(image_id.to_owned(), level))
    }

    pub fn get(&self, image_id: &str, level: ProxyLevel) -> Option<Arc<Vec<u8>>> {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.tick += 1;
        let tick = inner.tick;
        let slot = inner.map.get_mut(&(image_id.to_owned(), level))?;
        slot.last_used = tick;
        Some(Arc::clone(&slot.body))
    }

    pub fn insert(&self, image_id: String, level: ProxyLevel, body: Arc<Vec<u8>>) {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.tick += 1;
        let tick = inner.tick;
        let bytes = body.len();
        let key = (image_id, level);
        if let Some(previous) = inner.map.insert(
            key,
            Slot {
                body,
                bytes,
                last_used: tick,
            },
        ) {
            inner.total = inner.total.saturating_sub(previous.bytes);
        }
        inner.total = inner.total.saturating_add(bytes);
        self.evict(&mut inner);
    }

    pub fn remove(&self, image_id: &str) {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        for level in [ProxyLevel::L0, ProxyLevel::L1, ProxyLevel::L2] {
            if let Some(slot) = inner.map.remove(&(image_id.to_owned(), level)) {
                inner.total = inner.total.saturating_sub(slot.bytes);
            }
        }
    }

    fn evict(&self, inner: &mut Inner) {
        while inner.total > self.budget {
            let victim = inner
                .map
                .iter()
                .filter(|((id, _), _)| inner.current.as_deref() != Some(id.as_str()))
                .min_by_key(|(_, slot)| slot.last_used)
                .map(|(key, _)| key.clone());
            match victim {
                Some(key) => {
                    if let Some(slot) = inner.map.remove(&key) {
                        inner.total = inner.total.saturating_sub(slot.bytes);
                    }
                }
                None => break,
            }
        }
    }

    pub fn total_bytes(&self) -> usize {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner).total
    }

    pub fn len(&self) -> usize {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner).map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aeth_roundtrip_preserves_header_and_payload() {
        let rgb = vec![
            f16::from_f32(0.0),
            f16::from_f32(0.25),
            f16::from_f32(0.5),
            f16::from_f32(0.75),
            f16::from_f32(1.0),
            f16::from_f32(0.125),
        ];
        let body = serialize_aeth(2, 1, &rgb);
        assert_eq!(body.len(), AETH_HEADER_LEN + rgb.len() * 2);
        let header = parse_aeth_header(&body);
        assert_eq!(
            header,
            Some(AethHeader {
                width: 2,
                height: 1,
                fmt: AETH_FMT_F16,
                channels: AETH_CHANNELS,
            })
        );
        let mut decoded = Vec::new();
        for chunk in body[AETH_HEADER_LEN..].chunks_exact(2) {
            decoded.push(f16::from_le_bytes([chunk[0], chunk[1]]));
        }
        assert_eq!(decoded, rgb);
    }

    #[test]
    fn parse_rejects_bad_magic_and_short_body() {
        assert_eq!(parse_aeth_header(b"XXXX0000000000000"), None);
        assert_eq!(parse_aeth_header(b"AETH"), None);
    }

    fn body(size: usize) -> Arc<Vec<u8>> {
        Arc::new(vec![7u8; size])
    }

    #[test]
    fn store_get_and_insert_roundtrip() {
        let store = PixelStore::new(DEFAULT_BUDGET_BYTES);
        assert!(store.is_empty());
        store.insert("a".to_owned(), ProxyLevel::L0, body(10));
        assert!(store.contains("a", ProxyLevel::L0));
        assert_eq!(store.get("a", ProxyLevel::L0).map(|value| value.len()), Some(10));
        assert_eq!(store.get("a", ProxyLevel::L1), None);
        assert_eq!(store.total_bytes(), 10);
    }

    #[test]
    fn lru_evicts_least_recently_used_over_budget() {
        let store = PixelStore::new(100);
        store.insert("a".to_owned(), ProxyLevel::L0, body(40));
        store.insert("b".to_owned(), ProxyLevel::L0, body(40));
        let _touch = store.get("a", ProxyLevel::L0);
        store.insert("c".to_owned(), ProxyLevel::L0, body(40));
        assert!(store.total_bytes() <= 100);
        assert!(store.contains("a", ProxyLevel::L0));
        assert!(store.contains("c", ProxyLevel::L0));
        assert!(!store.contains("b", ProxyLevel::L0));
    }

    #[test]
    fn remove_drops_all_levels_and_reclaims_bytes() {
        let store = PixelStore::new(DEFAULT_BUDGET_BYTES);
        store.insert("a".to_owned(), ProxyLevel::L0, body(10));
        store.insert("a".to_owned(), ProxyLevel::L1, body(20));
        store.insert("b".to_owned(), ProxyLevel::L0, body(5));
        store.remove("a");
        assert!(!store.contains("a", ProxyLevel::L0));
        assert!(!store.contains("a", ProxyLevel::L1));
        assert!(store.contains("b", ProxyLevel::L0));
        assert_eq!(store.total_bytes(), 5);
    }

    #[test]
    fn current_image_is_never_evicted() {
        let store = PixelStore::new(100);
        store.set_current(Some("keep".to_owned()));
        store.insert("keep".to_owned(), ProxyLevel::L2, body(80));
        store.insert("keep".to_owned(), ProxyLevel::L1, body(80));
        store.insert("other".to_owned(), ProxyLevel::L0, body(80));
        assert!(store.contains("keep", ProxyLevel::L2));
        assert!(store.contains("keep", ProxyLevel::L1));
        assert!(!store.contains("other", ProxyLevel::L0));
    }
}
