use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::types::ProxyLevel;

pub const APP_CACHE_DIR: &str = "app.raw-viewer";

// SPEC-GAP: contract lists only l1/{k}.zst, but flip + color_matrix must survive a disk cache hit or a re-decoded L1 would render with wrong orientation/color. They are persisted in a sibling l1/{k}.meta (the .zst stays exactly "zstd of the AETH body"). The cached body is the full AETH body (16B header + payload), matching the pixel-store body and this task's wording.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct L1Meta {
    flip: u8,
    has_color_profile: bool,
    color_matrix: Option<Vec<f32>>,
}

pub struct CachedL1 {
    pub body: Vec<u8>,
    pub flip: u8,
    pub has_color_profile: bool,
    pub color_matrix: Option<Vec<f32>>,
}

pub struct DiskCache {
    root: PathBuf,
}

pub const CACHE_SCHEMA_VERSION: u32 = 2;

pub fn derive_key(path_bytes: &[u8], mtime_nanos: u128, size: u64) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&CACHE_SCHEMA_VERSION.to_le_bytes());
    hasher.update(path_bytes);
    hasher.update(&mtime_nanos.to_le_bytes());
    hasher.update(&size.to_le_bytes());
    hasher.finalize().to_hex().to_string()
}

fn key_for(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos();
    Some(derive_key(path.as_os_str().as_encoded_bytes(), mtime, meta.len()))
}

impl DiskCache {
    pub fn new() -> Self {
        let root = dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join(APP_CACHE_DIR);
        Self::with_root(root)
    }

    pub fn with_root(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn shard_path(&self, level_dir: &str, key: &str, ext: &str) -> PathBuf {
        let prefix = key.get(0..2).unwrap_or(key);
        self.root.join(level_dir).join(prefix).join(format!("{key}.{ext}"))
    }

    fn write_atomic(path: &Path, data: &[u8]) {
        if let Some(parent) = path.parent() {
            if fs::create_dir_all(parent).is_err() {
                return;
            }
        }
        let _ = fs::write(path, data);
    }

    pub fn store_l0(&self, path: &Path, jpeg: &[u8]) {
        if let Some(key) = key_for(path) {
            Self::write_atomic(&self.shard_path("l0", &key, "jpg"), jpeg);
        }
    }

    pub fn load_l0(&self, path: &Path) -> Option<Vec<u8>> {
        let key = key_for(path)?;
        fs::read(self.shard_path("l0", &key, "jpg")).ok()
    }

    pub fn store_l1(&self, path: &Path, body: &[u8], flip: u8, has_color_profile: bool, color_matrix: Option<&[f32]>) {
        let key = match key_for(path) {
            Some(key) => key,
            None => return,
        };
        let compressed = match zstd::encode_all(body, 1) {
            Ok(compressed) => compressed,
            Err(error) => {
                tracing::warn!(%error, "l1 zstd encode failed");
                return;
            }
        };
        Self::write_atomic(&self.shard_path("l1", &key, "zst"), &compressed);
        let meta = L1Meta {
            flip,
            has_color_profile,
            color_matrix: color_matrix.map(<[f32]>::to_vec),
        };
        if let Ok(json) = serde_json::to_vec(&meta) {
            Self::write_atomic(&self.shard_path("l1", &key, "meta"), &json);
        }
    }

    fn read_l1_body(&self, key: &str) -> Option<Vec<u8>> {
        let compressed = fs::read(self.shard_path("l1", key, "zst")).ok()?;
        zstd::decode_all(compressed.as_slice()).ok()
    }

    pub fn load_l1(&self, path: &Path) -> Option<CachedL1> {
        let key = key_for(path)?;
        let body = self.read_l1_body(&key)?;
        let meta = fs::read(self.shard_path("l1", &key, "meta"))
            .ok()
            .and_then(|raw| serde_json::from_slice::<L1Meta>(&raw).ok())
            .unwrap_or(L1Meta {
                flip: 0,
                has_color_profile: false,
                color_matrix: None,
            });
        Some(CachedL1 {
            body,
            flip: meta.flip,
            has_color_profile: meta.has_color_profile,
            color_matrix: meta.color_matrix,
        })
    }

    // SPEC-GAP: L2 is intentionally not disk-cached (Phase 1 contract §disk cache); serve/decode always recomputes L2.
    pub fn load_body(&self, path: &Path, level: ProxyLevel) -> Option<Vec<u8>> {
        match level {
            ProxyLevel::L0 => self.load_l0(path),
            ProxyLevel::L1 => {
                let key = key_for(path)?;
                self.read_l1_body(&key)
            }
            ProxyLevel::L2 => None,
        }
    }
}

// SPEC-GAP: eviction / 10GB LRU cap and index.sqlite are deferred (Phase 1 contract §disk cache); cache grows unbounded for now.

impl Default for DiskCache {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("raw-viewer-cache-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        base
    }

    #[test]
    fn derive_key_changes_with_mtime_and_size() {
        let path = b"/abs/IMG_1.CR2";
        let base = derive_key(path, 1_000, 500);
        assert_eq!(base, derive_key(path, 1_000, 500));
        assert_ne!(base, derive_key(path, 2_000, 500));
        assert_ne!(base, derive_key(path, 1_000, 600));
        assert_ne!(base, derive_key(b"/abs/IMG_2.CR2", 1_000, 500));
    }

    #[test]
    fn l1_roundtrip_preserves_body_and_meta() {
        let root = temp_root("l1");
        let cache = DiskCache::with_root(root.clone());
        let file = root.join("source.raw");
        let _ = fs::create_dir_all(&root);
        let _ = fs::write(&file, vec![1u8, 2, 3, 4, 5]);

        let body: Vec<u8> = (0..4096u32).map(|value| (value % 251) as u8).collect();
        let matrix = [0.9f32, 0.1, -0.05, 0.2, 0.8, 0.0, -0.01, 0.15, 1.02];
        cache.store_l1(&file, &body, 6, true, Some(&matrix));

        let loaded = cache.load_l1(&file);
        assert!(loaded.is_some());
        if let Some(loaded) = loaded {
            assert_eq!(loaded.body, body);
            assert_eq!(loaded.flip, 6);
            assert!(loaded.has_color_profile);
            assert_eq!(loaded.color_matrix, Some(matrix.to_vec()));
        }
        assert_eq!(cache.load_body(&file, ProxyLevel::L1), Some(body));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn l0_roundtrip_and_l2_not_cached() {
        let root = temp_root("l0");
        let cache = DiskCache::with_root(root.clone());
        let file = root.join("source.raw");
        let _ = fs::create_dir_all(&root);
        let _ = fs::write(&file, vec![9u8, 9, 9]);

        let jpeg = vec![0xFFu8, 0xD8, 0xFF, 0xD9];
        cache.store_l0(&file, &jpeg);
        assert_eq!(cache.load_l0(&file), Some(jpeg.clone()));
        assert_eq!(cache.load_body(&file, ProxyLevel::L0), Some(jpeg));
        assert_eq!(cache.load_body(&file, ProxyLevel::L2), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_entry_returns_none() {
        let root = temp_root("miss");
        let cache = DiskCache::with_root(root.clone());
        let file = root.join("nope.raw");
        let _ = fs::create_dir_all(&root);
        let _ = fs::write(&file, vec![0u8]);
        assert!(cache.load_l0(&file).is_none());
        assert!(cache.load_l1(&file).is_none());
        let _ = fs::remove_dir_all(&root);
    }
}
