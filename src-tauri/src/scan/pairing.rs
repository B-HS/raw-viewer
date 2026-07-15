use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::scan::{image_id, is_raw_ext};
use crate::types_platform::PairInfo;

const JPEG_EXTS: &[&str] = &["jpg", "jpeg"];

fn stem_lower(path: &Path) -> Option<String> {
    path.file_stem().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase())
}

fn is_jpeg(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .is_some_and(|value| JPEG_EXTS.contains(&value.as_str()))
}

pub fn raw_stems(dir: &Path) -> HashSet<String> {
    let mut set = HashSet::new();
    if let Ok(read) = std::fs::read_dir(dir) {
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_file() && is_raw_ext(&path) {
                if let Some(stem) = stem_lower(&path) {
                    set.insert(stem);
                }
            }
        }
    }
    set
}

pub fn is_paired_secondary(path: &Path, raw_stems: &HashSet<String>) -> bool {
    is_jpeg(path) && stem_lower(path).is_some_and(|stem| raw_stems.contains(&stem))
}

pub fn find_pairs(dir: &Path) -> Vec<PairInfo> {
    let mut raws: HashMap<String, PathBuf> = HashMap::new();
    let mut jpegs: HashMap<String, PathBuf> = HashMap::new();
    if let Ok(read) = std::fs::read_dir(dir) {
        for entry in read.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(stem) = stem_lower(&path) else {
                continue;
            };
            if is_raw_ext(&path) {
                raws.entry(stem).or_insert(path);
            } else if is_jpeg(&path) {
                jpegs.entry(stem).or_insert(path);
            }
        }
    }
    let mut pairs: Vec<PairInfo> = raws
        .into_iter()
        .filter_map(|(stem, raw_path)| {
            jpegs.get(&stem).map(|jpeg_path| PairInfo {
                raw_id: image_id(&raw_path),
                jpeg_path: jpeg_path.clone(),
            })
        })
        .collect();
    pairs.sort_by(|a, b| a.jpeg_path.cmp(&b.jpeg_path));
    pairs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("raw-viewer-pairing-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let _ = std::fs::create_dir_all(&base);
        base
    }

    fn write(dir: &Path, name: &str) {
        let _ = std::fs::write(dir.join(name), b"x");
    }

    #[test]
    fn secondary_jpeg_is_detected_only_with_matching_raw_stem() {
        let dir = temp_dir("secondary");
        write(&dir, "IMG_1.CR2");
        write(&dir, "IMG_1.JPG");
        write(&dir, "IMG_2.JPG");
        let stems = raw_stems(&dir);
        assert!(is_paired_secondary(&dir.join("IMG_1.JPG"), &stems));
        assert!(!is_paired_secondary(&dir.join("IMG_2.JPG"), &stems));
        assert!(!is_paired_secondary(&dir.join("IMG_1.CR2"), &stems));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_pairs_maps_raw_to_jpeg_by_stem() {
        let dir = temp_dir("find");
        write(&dir, "A.ARW");
        write(&dir, "A.jpg");
        write(&dir, "B.RAF");
        write(&dir, "B.JPEG");
        write(&dir, "C.NEF");
        let pairs = find_pairs(&dir);
        assert_eq!(pairs.len(), 2);
        let a = pairs.iter().find(|pair| pair.jpeg_path == dir.join("A.jpg"));
        let b = pairs.iter().find(|pair| pair.jpeg_path == dir.join("B.JPEG"));
        assert!(matches!(a, Some(pair) if pair.raw_id == image_id(&dir.join("A.ARW"))));
        assert!(matches!(b, Some(pair) if pair.raw_id == image_id(&dir.join("B.RAF"))));
        assert!(!pairs.iter().any(|pair| pair.raw_id == image_id(&dir.join("C.NEF"))));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
