use std::collections::HashMap;
use std::path::PathBuf;

use serde::Deserialize;

use crate::cpurender::color;
use crate::cpurender::luts;
use crate::types::{BaseCurveMode, CurvesState};

fn fixture(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures-parity").join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {path:?}: {error} (run: bun scripts/gen-parity-vectors.ts)"))
}

fn load<T: for<'de> Deserialize<'de>>(name: &str) -> T {
    serde_json::from_str(&fixture(name)).unwrap_or_else(|error| panic!("parse {name}: {error}"))
}

#[derive(Deserialize)]
struct BaseCurveFixture {
    modes: HashMap<String, Vec<u8>>,
}

#[test]
fn basecurve_lut_matches_ts_byte_for_byte() {
    let data: BaseCurveFixture = load("basecurve.json");
    let modes = [
        ("linear", BaseCurveMode::Linear),
        ("standard", BaseCurveMode::Standard),
        ("filmic", BaseCurveMode::Filmic),
        ("camera-match", BaseCurveMode::CameraMatch),
    ];
    for (key, mode) in modes {
        let expected = data.modes.get(key).unwrap_or_else(|| panic!("missing base mode {key}"));
        let actual = luts::build_base_curve_lut(mode);
        assert_eq!(expected.len(), actual.len(), "{key} length");
        for (i, (want, got)) in expected.iter().zip(actual.iter()).enumerate() {
            assert_eq!(want, got, "base curve {key} sample {i}: ts={want} rust={got}");
        }
    }
}

#[derive(Deserialize)]
struct WbCase {
    temp: f64,
    tint: f64,
    #[serde(rename = "tempShift")]
    temp_shift: Option<f64>,
    gains: [f64; 3],
}

#[derive(Deserialize)]
struct WbFixture {
    cases: Vec<WbCase>,
}

#[test]
fn wb_gains_match_ts_within_tolerance() {
    let data: WbFixture = load("wb.json");
    assert!(!data.cases.is_empty());
    for case in data.cases {
        let gains = luts::wb_gains(case.temp, case.tint, case.temp_shift);
        for channel in 0..3 {
            let diff = (gains[channel] - case.gains[channel]).abs();
            assert!(
                diff < 1e-3,
                "wb gains temp={} tint={} shift={:?} channel {channel}: ts={} rust={} diff={diff}",
                case.temp,
                case.tint,
                case.temp_shift,
                case.gains[channel],
                gains[channel]
            );
        }
    }
}

#[derive(Deserialize)]
struct ApplyCase {
    #[serde(rename = "in")]
    input: [f32; 3],
    out: [f32; 3],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ColorspaceFixture {
    rec2020_to_srgb: Vec<f32>,
    rec2020_to_p3: Vec<f32>,
    srgb_to_p3: Vec<f32>,
    luma: Vec<f32>,
    apply_rec2020_to_srgb: Vec<ApplyCase>,
    apply_rec2020_to_p3: Vec<ApplyCase>,
}

fn assert_matrix(name: &str, expected: &[f32], actual: &[f32; 9]) {
    assert_eq!(expected.len(), 9, "{name} length");
    for (i, (want, got)) in expected.iter().zip(actual.iter()).enumerate() {
        assert!((want - got).abs() < 1e-6, "{name}[{i}]: ts={want} rust={got}");
    }
}

#[test]
fn colorspace_constants_and_application_match_ts() {
    let data: ColorspaceFixture = load("colorspace.json");
    assert_matrix("rec2020ToSrgb", &data.rec2020_to_srgb, &color::REC2020_TO_SRGB);
    assert_matrix("rec2020ToP3", &data.rec2020_to_p3, &color::REC2020_TO_P3);
    assert_matrix("srgbToP3", &data.srgb_to_p3, &color::SRGB_TO_P3);
    for (i, (want, got)) in data.luma.iter().zip(color::REC2020_LUMA.iter()).enumerate() {
        assert!((want - got).abs() < 1e-6, "luma[{i}]: ts={want} rust={got}");
    }
    for case in &data.apply_rec2020_to_srgb {
        let out = color::apply_matrix(&color::REC2020_TO_SRGB, case.input[0], case.input[1], case.input[2]);
        for channel in 0..3 {
            assert!((out[channel] - case.out[channel]).abs() < 1e-3, "srgb apply {:?} channel {channel}: ts={} rust={}", case.input, case.out[channel], out[channel]);
        }
    }
    for case in &data.apply_rec2020_to_p3 {
        let out = color::apply_matrix(&color::REC2020_TO_P3, case.input[0], case.input[1], case.input[2]);
        for channel in 0..3 {
            assert!((out[channel] - case.out[channel]).abs() < 1e-3, "p3 apply {:?} channel {channel}: ts={} rust={}", case.input, case.out[channel], out[channel]);
        }
    }
}

#[derive(Deserialize)]
struct ToneCase {
    label: String,
    curves: CurvesState,
    lut: Vec<u16>,
}

#[derive(Deserialize)]
struct ToneFixture {
    cases: Vec<ToneCase>,
}

#[test]
fn tonecurve_lut_matches_ts_half_bits() {
    let data: ToneFixture = load("tonecurve.json");
    assert!(!data.cases.is_empty());
    for case in data.cases {
        let actual = luts::build_tone_curve_lut(&case.curves);
        assert_eq!(case.lut.len(), actual.len(), "tone {} length", case.label);
        for (i, (want, got)) in case.lut.iter().zip(actual.iter()).enumerate() {
            assert_eq!(want, got, "tone curve {} sample {i}: ts={want} rust={got}", case.label);
        }
    }
}
