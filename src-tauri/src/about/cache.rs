use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cache::APP_CACHE_DIR;
use crate::error::AppResult;

#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CacheStats {
    pub l0_bytes: f64,
    pub l1_bytes: f64,
    pub total_bytes: f64,
}

#[derive(Debug, Clone, Copy, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum CacheKind {
    All,
    L0,
    L1,
}

fn cache_root() -> PathBuf {
    dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join(APP_CACHE_DIR)
}

fn dir_size(dir: &Path) -> u64 {
    let mut total = 0u64;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = match std::fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            match entry.file_type() {
                Ok(file_type) if file_type.is_dir() => stack.push(entry.path()),
                Ok(_) => {
                    if let Ok(meta) = entry.metadata() {
                        total = total.saturating_add(meta.len());
                    }
                }
                Err(_) => {}
            }
        }
    }
    total
}

fn remove_dir_contents(dir: &Path) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(file_type) if file_type.is_dir() => {
                remove_dir_contents(&path);
                let _ = std::fs::remove_dir(&path);
            }
            _ => {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

fn stats_at(root: &Path) -> CacheStats {
    CacheStats {
        l0_bytes: dir_size(&root.join("l0")) as f64,
        l1_bytes: dir_size(&root.join("l1")) as f64,
        total_bytes: dir_size(root) as f64,
    }
}

fn clear_at(root: &Path, kind: CacheKind) {
    match kind {
        CacheKind::L0 => remove_dir_contents(&root.join("l0")),
        CacheKind::L1 => remove_dir_contents(&root.join("l1")),
        CacheKind::All => {
            remove_dir_contents(&root.join("l0"));
            remove_dir_contents(&root.join("l1"));
        }
    }
}

#[tauri::command]
pub async fn get_cache_stats() -> AppResult<CacheStats> {
    Ok(stats_at(&cache_root()))
}

#[tauri::command]
pub async fn clear_cache(kind: CacheKind) -> AppResult<()> {
    clear_at(&cache_root(), kind);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("raw-viewer-cachestats-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    fn seed(root: &Path, rel: &str, len: usize) {
        let path = root.join(rel);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, vec![0u8; len]);
    }

    #[test]
    fn stats_sums_per_level_and_total() {
        let root = temp_root("stats");
        seed(&root, "l0/ab/one.jpg", 100);
        seed(&root, "l0/cd/two.jpg", 50);
        seed(&root, "l1/ab/one.zst", 200);
        seed(&root, "l1/ab/one.meta", 20);
        let stats = stats_at(&root);
        assert_eq!(stats.l0_bytes, 150.0);
        assert_eq!(stats.l1_bytes, 220.0);
        assert_eq!(stats.total_bytes, 370.0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn clear_l0_only_removes_l0() {
        let root = temp_root("clear-l0");
        seed(&root, "l0/ab/one.jpg", 100);
        seed(&root, "l1/ab/one.zst", 200);
        clear_at(&root, CacheKind::L0);
        let stats = stats_at(&root);
        assert_eq!(stats.l0_bytes, 0.0);
        assert_eq!(stats.l1_bytes, 200.0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn clear_all_removes_both_levels() {
        let root = temp_root("clear-all");
        seed(&root, "l0/ab/one.jpg", 100);
        seed(&root, "l1/ab/one.zst", 200);
        clear_at(&root, CacheKind::All);
        let stats = stats_at(&root);
        assert_eq!(stats.l0_bytes, 0.0);
        assert_eq!(stats.l1_bytes, 0.0);
        assert_eq!(stats.total_bytes, 0.0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn stats_on_missing_root_is_zero() {
        let root = temp_root("missing");
        let stats = stats_at(&root);
        assert_eq!(stats.l0_bytes, 0.0);
        assert_eq!(stats.l1_bytes, 0.0);
        assert_eq!(stats.total_bytes, 0.0);
    }
}
