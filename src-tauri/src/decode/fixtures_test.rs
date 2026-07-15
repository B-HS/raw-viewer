use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
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

fn divergence(actual: &super::DecodedRaw, expected: &super::DecodedRaw) -> usize {
    actual
        .rgb_f16
        .iter()
        .zip(expected.rgb_f16.iter())
        .filter(|(lhs, rhs)| lhs.to_bits() != rhs.to_bits())
        .count()
}

#[test]
fn concurrent_decode_stays_byte_identical_to_isolated() -> Result<(), DecodeError> {
    let target_names = ["canon-eos-5d-mark-iii.cr2", "fujifilm-x-t5.raf", "leica-m-monochrom.dng"];
    let cancel: CancelFlag = Arc::new(AtomicBool::new(false));

    let mut references: Vec<(String, PathBuf, super::DecodedRaw)> = Vec::new();
    for name in target_names {
        let path = fixtures_dir().join(name);
        if !path.is_file() {
            continue;
        }
        let decoded = decode_half(&path, &cancel)?;
        assert!(decoded.width > 0 && decoded.height > 0, "empty isolated decode for {name}");
        assert_eq!(
            decoded.rgb_f16.len(),
            decoded.width as usize * decoded.height as usize * 3,
            "isolated buffer length must equal width*height*3 for {name}",
        );
        let ratio = decoded.width as f64 / decoded.height as f64;
        assert!(ratio > 0.3 && ratio < 3.0, "implausible processed aspect ratio {ratio} for {name}");
        references.push((name.to_owned(), path, decoded));
    }
    if references.is_empty() {
        return Ok(());
    }

    let contention: Vec<PathBuf> = ["nikon-d850.nef", "panasonic-s5.rw2", "om-system-om-1.orf", "pentax-k-3-mark-iii.pef"]
        .into_iter()
        .map(|name| fixtures_dir().join(name))
        .filter(|path| path.is_file())
        .collect();

    for round in 0..3 {
        let stop = Arc::new(AtomicBool::new(false));
        let mut load = Vec::new();
        for path in &contention {
            let path = path.clone();
            let stop = Arc::clone(&stop);
            load.push(std::thread::spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    let cancel: CancelFlag = Arc::new(AtomicBool::new(false));
                    let _ = decode_half(&path, &cancel);
                }
            }));
        }

        let mut probes = Vec::new();
        for (name, path, _) in &references {
            let name = name.clone();
            let path = path.clone();
            probes.push(std::thread::spawn(move || {
                let cancel: CancelFlag = Arc::new(AtomicBool::new(false));
                (name, decode_half(&path, &cancel))
            }));
        }

        let mut outcomes = Vec::new();
        for probe in probes {
            match probe.join() {
                Ok(value) => outcomes.push(value),
                Err(_) => panic!("target decode thread panicked in round {round}"),
            }
        }
        stop.store(true, Ordering::Relaxed);
        for handle in load {
            let _ = handle.join();
        }

        for (name, result) in outcomes {
            let Some((_, _, reference)) = references.iter().find(|(candidate, _, _)| *candidate == name) else {
                continue;
            };
            let decoded = match result {
                Ok(decoded) => decoded,
                Err(error) => panic!("{name} failed to decode under concurrency (round {round}): {error}"),
            };
            assert_eq!(decoded.width, reference.width, "{name} width drifted under concurrency (round {round})");
            assert_eq!(decoded.height, reference.height, "{name} height drifted under concurrency (round {round})");
            assert_eq!(
                decoded.rgb_f16.len(),
                reference.rgb_f16.len(),
                "{name} buffer length drifted under concurrency (round {round})",
            );
            let diverged = divergence(&decoded, reference);
            assert_eq!(
                diverged, 0,
                "{name} decoded differently under concurrency (round {round}): {diverged}/{} samples differ",
                reference.rgb_f16.len(),
            );
        }
    }

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
