use std::path::PathBuf;

use super::build_metadata;
use crate::types_meta::SensorType;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("tests").join("fixtures").join("tier1")
}

#[test]
fn print_fixture_metadata() {
    let dir = fixtures_dir();
    for name in [
        "canon-eos-5d-mark-iii.cr2",
        "apple-iphone-12-pro.dng",
        "fujifilm-x-t5.raf",
        "leica-m-monochrom.dng",
        "sony-a1.arw",
    ] {
        let path = dir.join(name);
        if !path.is_file() {
            eprintln!("[meta] {name} missing");
            continue;
        }
        let meta = build_metadata(&path);
        eprintln!(
            "[meta] {name}: make={:?} model={:?} sensor={:?} cfa={:?} iso={:?} shutter={:?} f={:?} focal={:?} crop={:?} matrix={} gps={} warnings={:?}",
            meta.camera.make,
            meta.camera.model,
            meta.camera.sensor_type,
            meta.camera.cfa_pattern,
            meta.exposure.iso,
            meta.exposure.shutter_speed,
            meta.exposure.f_number,
            meta.exposure.focal_length,
            meta.camera.crop_factor,
            meta.raw.as_ref().map(|raw| raw.has_color_matrix).unwrap_or(false),
            meta.gps.is_some(),
            meta.warnings,
        );
        if let Some(raw) = &meta.raw {
            eprintln!(
                "        raw: dng={} ver={:?} black={:?} white={:?} asn={:?} previews={} compression={:?}",
                raw.is_dng, raw.dng_version, raw.black_level, raw.white_level, raw.as_shot_neutral, raw.embedded_previews.len(), raw.compression,
            );
        }
    }
}

#[test]
fn canon_5d3_core_exposure_is_present() {
    let path = fixtures_dir().join("canon-eos-5d-mark-iii.cr2");
    if !path.is_file() {
        eprintln!("skipping canon_5d3_core_exposure_is_present: fixture not present");
        return;
    }
    let meta = build_metadata(&path);
    assert!(meta.camera.make.as_deref().is_some_and(|make| make.to_ascii_lowercase().contains("canon")), "make={:?}", meta.camera.make);
    assert_eq!(meta.camera.sensor_type, SensorType::Bayer);
    assert!(meta.camera.cfa_pattern.as_deref().is_some_and(|pattern| pattern.len() == 4), "cfa={:?}", meta.camera.cfa_pattern);
    let Some(iso) = meta.exposure.iso else {
        panic!("iso missing");
    };
    assert!((50..=409_600).contains(&iso), "iso out of range: {iso}");
    let Some(shutter) = meta.exposure.shutter_speed else {
        panic!("shutter missing");
    };
    assert!(shutter.num > 0 && shutter.den > 0, "shutter={shutter:?}");
    let Some(f_number) = meta.exposure.f_number else {
        panic!("fNumber missing");
    };
    assert!(f_number > 0.0, "fNumber={f_number}");
    let Some(raw) = meta.raw else {
        panic!("raw section missing");
    };
    assert!(raw.has_color_matrix, "expected a color matrix for 5D3");
    assert!(!raw.embedded_previews.is_empty(), "expected embedded previews");
}
