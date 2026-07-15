use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use super::{decode_full, decode_half, extract_thumb, CancelFlag, DecodeError};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("tests").join("fixtures").join("tier1")
}

fn extension(path: &PathBuf) -> String {
    path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase()
}

fn file_name(path: &PathBuf) -> String {
    path.file_name().and_then(|value| value.to_str()).unwrap_or("").to_owned()
}

fn list_fixtures() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(fixtures_dir()) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = file_name(&path);
            if name.starts_with('.') || name.ends_with(".part") || name.ends_with(".partial") || name.ends_with(".tmp") {
                continue;
            }
            out.push(path);
        }
    }
    out
}

#[test]
fn tier1_corpus_thumb_and_half_decode() -> Result<(), DecodeError> {
    let files = list_fixtures();
    assert!(!files.is_empty(), "fixtures missing - run scripts/fetch-fixtures.sh (looked in {:?})", fixtures_dir());

    let cancel: CancelFlag = Arc::new(AtomicBool::new(false));
    let mainstream = ["cr2", "cr3", "arw", "nef", "raf"];

    for path in &files {
        let ext = extension(path);
        let name = file_name(path);

        if ext == "x3f" {
            // SPEC-GAP: LibRaw X3F parsing is compiled out (build.rs lacks -DUSE_X3FTOOLS) so open_file rejects Foveon files; X3F is a documented unsupported sensor (PRD §3.3), so a thumbnail failure is tolerated here.
            match extract_thumb(path) {
                Ok(thumb) => assert!(!thumb.jpeg.is_empty(), "empty x3f thumbnail for {name}"),
                Err(error) => eprintln!("[fixture] {name:<28} x3f unavailable: {error}"),
            }
            continue;
        }

        let thumb_dims = match extract_thumb(path) {
            Ok(thumb) => {
                assert!(!thumb.jpeg.is_empty(), "empty thumbnail for {name}");
                assert_eq!(&thumb.jpeg[0..2], &[0xFF, 0xD8], "thumbnail is not a JPEG SOI for {name}");
                (thumb.width, thumb.height)
            }
            Err(error) => {
                assert!(error.to_string().contains("no JPEG thumbnail"), "unexpected thumbnail error for {name}: {error}");
                assert!(!mainstream.contains(&ext.as_str()), "mainstream fixture {name} must expose a JPEG thumbnail");
                (0, 0)
            }
        };

        let decoded = decode_half(path, &cancel)?;
        assert!(decoded.width > 0 && decoded.height > 0, "empty half decode for {name}");
        assert_eq!(decoded.rgb_f16.len(), decoded.width as usize * decoded.height as usize * 3, "rgb length mismatch for {name}");

        if mainstream.contains(&ext.as_str()) {
            assert!(decoded.cam_to_rec2020.is_some(), "expected a color matrix for mainstream fixture {name}");
        }

        let matrix = match decoded.cam_to_rec2020 {
            Some(values) => format!("Some(r0={:.4},{:.4},{:.4})", values[0], values[1], values[2]),
            None => "None".to_owned(),
        };
        eprintln!(
            "[fixture] {name:<28} thumb={}x{} half={}x{} flip={} matrix={matrix}",
            thumb_dims.0, thumb_dims.1, decoded.width, decoded.height, decoded.flip,
        );
    }

    Ok(())
}

#[test]
fn canon_5d3_full_decode() -> Result<(), DecodeError> {
    let path = fixtures_dir().join("canon-eos-5d-mark-iii.cr2");
    if !path.is_file() {
        eprintln!("skipping canon_5d3_full_decode: fixture not present");
        return Ok(());
    }

    let cancel: CancelFlag = Arc::new(AtomicBool::new(false));
    let decoded = decode_full(&path, &cancel)?;
    assert!(decoded.width > 0 && decoded.height > 0);
    assert_eq!(decoded.rgb_f16.len(), decoded.width as usize * decoded.height as usize * 3);
    assert!(decoded.cam_to_rec2020.is_some(), "expected a color matrix for canon 5D3");
    Ok(())
}

#[test]
fn precancelled_flag_stops_decode() {
    let files = list_fixtures();
    let target = files.into_iter().find(|path| extension(path) != "x3f");
    let Some(path) = target else {
        return;
    };

    let cancel: CancelFlag = Arc::new(AtomicBool::new(true));
    let result = decode_half(&path, &cancel);
    assert!(matches!(result, Err(DecodeError::Cancelled)), "expected Cancelled for a pre-cancelled decode");
}
