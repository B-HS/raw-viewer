use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{PoisonError, RwLock};

use crate::types::{ImageEntry, ScanBatch, ScanSummary};

pub mod pairing;

pub const BATCH_SIZE: usize = 100;

const RAW_EXTS: &[&str] = &[
    "cr2", "cr3", "arw", "sr2", "srf", "nef", "nrw", "raf", "dng", "orf", "rw2", "pef", "raw", "rwl", "3fr", "fff", "iiq", "erf", "mrw", "dcr",
    "kdc", "mos", "gpr", "x3f",
];

const OTHER_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "gif", "avif", "heic", "heif"];

pub fn image_id(abs_path: &Path) -> String {
    blake3::hash(abs_path.to_string_lossy().as_bytes()).to_hex().to_string()
}

fn ext_lower(path: &Path) -> Option<String> {
    path.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase())
}

pub fn is_raw_ext(path: &Path) -> bool {
    ext_lower(path).is_some_and(|ext| RAW_EXTS.contains(&ext.as_str()))
}

pub fn is_supported(path: &Path) -> bool {
    ext_lower(path).is_some_and(|ext| RAW_EXTS.contains(&ext.as_str()) || OTHER_EXTS.contains(&ext.as_str()))
}

fn is_excluded_name(name: &str) -> bool {
    name.starts_with('.') || name == "Thumbs.db" || name == "@eaDir"
}

fn is_animated_file(path: &Path) -> bool {
    let Some(ext) = ext_lower(path) else { return false };
    if ext == "gif" {
        return true;
    }
    if ext != "webp" {
        return false;
    }
    use std::io::Read;
    let Ok(mut file) = std::fs::File::open(path) else { return false };
    let mut header = [0u8; 21];
    if file.read_exact(&mut header).is_err() {
        return false;
    }
    &header[0..4] == b"RIFF" && &header[8..16] == b"WEBPVP8X" && header[20] & 0x02 != 0
}

pub fn make_entry(abs_path: PathBuf) -> ImageEntry {
    let file_name = abs_path.file_name().and_then(|value| value.to_str()).unwrap_or_default().to_owned();
    let is_raw = is_raw_ext(&abs_path);
    let id = image_id(&abs_path);
    let metadata = std::fs::metadata(&abs_path).ok();
    let modified_ms = metadata
        .as_ref()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as f64);
    let file_size = metadata.map(|meta| meta.len() as f64);
    let is_animated = is_animated_file(&abs_path);
    ImageEntry {
        image_id: id,
        path: abs_path,
        file_name,
        is_raw,
        modified_ms,
        file_size,
        is_animated,
    }
}

#[derive(Default)]
pub struct Registry {
    map: RwLock<HashMap<String, PathBuf>>,
}

impl Registry {
    pub fn new() -> Self {
        Self {
            map: RwLock::new(HashMap::new()),
        }
    }

    pub fn insert(&self, id: String, abs_path: PathBuf) {
        let mut guard = self.map.write().unwrap_or_else(PoisonError::into_inner);
        guard.insert(id, abs_path);
    }

    pub fn register(&self, abs_path: PathBuf) -> String {
        let id = image_id(&abs_path);
        self.insert(id.clone(), abs_path);
        id
    }

    pub fn resolve(&self, id: &str) -> Option<PathBuf> {
        let guard = self.map.read().unwrap_or_else(PoisonError::into_inner);
        guard.get(id).cloned()
    }

    pub fn remove(&self, id: &str) -> Option<PathBuf> {
        let mut guard = self.map.write().unwrap_or_else(PoisonError::into_inner);
        guard.remove(id)
    }
}

pub fn scan_stream(dir: &Path, registry: &Registry, mut on_batch: impl FnMut(ScanBatch)) -> ScanSummary {
    let mut buffer: Vec<ImageEntry> = Vec::with_capacity(BATCH_SIZE);
    let mut total: u32 = 0;
    let raw_stems = pairing::raw_stems(dir);
    if let Ok(read) = std::fs::read_dir(dir) {
        for entry in read.flatten() {
            let path = entry.path();
            let name = match path.file_name().and_then(|value| value.to_str()) {
                Some(name) => name,
                None => continue,
            };
            if is_excluded_name(name) {
                continue;
            }
            if !path.is_file() || !is_supported(&path) {
                continue;
            }
            if pairing::is_paired_secondary(&path, &raw_stems) {
                continue;
            }
            let image_entry = make_entry(path.clone());
            registry.insert(image_entry.image_id.clone(), path);
            buffer.push(image_entry);
            total = total.saturating_add(1);
            if buffer.len() >= BATCH_SIZE {
                on_batch(ScanBatch {
                    entries: std::mem::take(&mut buffer),
                    done: false,
                });
            }
        }
    }
    on_batch(ScanBatch {
        entries: std::mem::take(&mut buffer),
        done: true,
    });
    ScanSummary { total }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_file(dir: &Path, name: &str) {
        let _ = std::fs::write(dir.join(name), b"x");
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("raw-viewer-scan-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let _ = std::fs::create_dir_all(&base);
        base
    }

    #[test]
    fn image_id_is_stable_for_same_path() {
        let path = PathBuf::from("/tmp/IMG_1.CR2");
        assert_eq!(image_id(&path), image_id(&path));
        assert_ne!(image_id(&path), image_id(&PathBuf::from("/tmp/IMG_2.CR2")));
    }

    #[test]
    fn raw_and_general_extensions_are_classified() {
        assert!(is_raw_ext(Path::new("/a/B.CR3")));
        assert!(is_raw_ext(Path::new("/a/b.x3f")));
        assert!(!is_raw_ext(Path::new("/a/b.jpg")));
        assert!(is_supported(Path::new("/a/b.JPEG")));
        assert!(is_supported(Path::new("/a/b.heic")));
        assert!(!is_supported(Path::new("/a/b.txt")));
        assert!(!is_supported(Path::new("/a/b")));
    }

    #[test]
    fn scan_excludes_hidden_and_junk_and_flags_raw() {
        let dir = temp_dir("basic");
        write_file(&dir, "IMG_1.CR2");
        write_file(&dir, "IMG_2.JPG");
        write_file(&dir, ".hidden.cr2");
        write_file(&dir, ".DS_Store");
        write_file(&dir, "Thumbs.db");
        write_file(&dir, "notes.txt");
        let _ = std::fs::create_dir_all(dir.join("@eaDir"));
        let _ = std::fs::create_dir_all(dir.join("subfolder"));

        let registry = Registry::new();
        let mut collected: Vec<ImageEntry> = Vec::new();
        let mut batches = 0;
        let summary = scan_stream(&dir, &registry, |batch| {
            batches += 1;
            collected.extend(batch.entries);
        });

        assert_eq!(summary.total, 2);
        assert_eq!(collected.len(), 2);
        assert!(batches >= 1);
        let raw = collected.iter().find(|entry| entry.file_name == "IMG_1.CR2");
        let jpg = collected.iter().find(|entry| entry.file_name == "IMG_2.JPG");
        assert!(matches!(raw, Some(entry) if entry.is_raw));
        assert!(matches!(jpg, Some(entry) if !entry.is_raw));
        if let Some(raw) = raw {
            assert_eq!(registry.resolve(&raw.image_id), Some(dir.join("IMG_1.CR2")));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_excludes_paired_jpeg_and_keeps_standalone_jpeg() {
        let dir = temp_dir("pairing");
        write_file(&dir, "IMG_1.CR2");
        write_file(&dir, "IMG_1.JPG");
        write_file(&dir, "IMG_2.JPG");

        let registry = Registry::new();
        let mut collected: Vec<ImageEntry> = Vec::new();
        let summary = scan_stream(&dir, &registry, |batch| collected.extend(batch.entries));

        assert_eq!(summary.total, 2);
        assert!(collected.iter().any(|entry| entry.file_name == "IMG_1.CR2"));
        assert!(collected.iter().any(|entry| entry.file_name == "IMG_2.JPG"));
        assert!(!collected.iter().any(|entry| entry.file_name == "IMG_1.JPG"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_streams_in_batches_of_100_with_final_done() {
        let dir = temp_dir("batches");
        for index in 0..250 {
            write_file(&dir, &format!("IMG_{index:04}.cr2"));
        }
        let registry = Registry::new();
        let mut sizes: Vec<usize> = Vec::new();
        let mut done_flags: Vec<bool> = Vec::new();
        let summary = scan_stream(&dir, &registry, |batch| {
            sizes.push(batch.entries.len());
            done_flags.push(batch.done);
        });
        assert_eq!(summary.total, 250);
        assert_eq!(sizes.iter().sum::<usize>(), 250);
        assert_eq!(sizes.first(), Some(&100));
        assert_eq!(sizes.get(1), Some(&100));
        assert_eq!(done_flags.last(), Some(&true));
        assert_eq!(done_flags.iter().filter(|done| **done).count(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod animated_tests {
    use super::*;

    #[test]
    fn gif_is_always_treated_as_animated() {
        let dir = std::env::temp_dir().join(format!("raw-viewer-anim-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let gif = dir.join("a.gif");
        let _ = std::fs::write(&gif, b"GIF89a");
        assert!(is_animated_file(&gif));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn webp_animation_flag_is_detected() {
        let dir = std::env::temp_dir().join(format!("raw-viewer-anim-webp-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let animated = dir.join("anim.webp");
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&24u32.to_le_bytes());
        bytes.extend_from_slice(b"WEBPVP8X");
        bytes.extend_from_slice(&10u32.to_le_bytes());
        bytes.push(0x02);
        bytes.extend_from_slice(&[0u8; 9]);
        let _ = std::fs::write(&animated, &bytes);
        assert!(is_animated_file(&animated));

        let still = dir.join("still.webp");
        let mut still_bytes = bytes.clone();
        still_bytes[20] = 0x00;
        let _ = std::fs::write(&still, &still_bytes);
        assert!(!is_animated_file(&still));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
