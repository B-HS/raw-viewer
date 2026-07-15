use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use raw_viewer_lib::cpurender::color::IDENTITY3;
use raw_viewer_lib::cpurender::passes::{downscale_area, render_passes};
use raw_viewer_lib::decode::{decode_half, CancelFlag};
use raw_viewer_lib::edit::default_edit_state;
use raw_viewer_lib::types::EditState;

const RUNS: usize = 5;
const MAX_EDGE: u32 = 2048;

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tests")
        .join("fixtures")
        .join("tier1")
        .join("canon-eos-5d-mark-iii.cr2")
}

fn median_ms(mut samples: Vec<f64>) -> f64 {
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    samples[samples.len() / 2]
}

fn target_dims(width: usize, height: usize) -> (usize, usize) {
    let long = width.max(height) as f64;
    let scale = (f64::from(MAX_EDGE) / long).min(1.0);
    (((width as f64 * scale).round() as usize).max(1), ((height as f64 * scale).round() as usize).max(1))
}

fn heavy_state() -> EditState {
    let mut state = default_edit_state();
    state.tone.exposure = 0.5;
    state.tone.contrast = 20.0;
    state.tone.highlights = -25.0;
    state.tone.shadows = 30.0;
    state.color.saturation = 15.0;
    state.color.vibrance = 20.0;
    if let Some(adjust) = state.color.hsl.get_mut(&raw_viewer_lib::types::HslBand::Blue) {
        adjust.hue = 20.0;
        adjust.sat = -15.0;
    }
    state.effects.clarity = 25.0;
    state.effects.vignette_amount = -30.0;
    state
}

fn bench(label: &str, src: &[f32], sw: usize, sh: usize, matrix: &[f32; 9], state: &EditState) {
    let (tw, th) = target_dims(sw, sh);
    let mut samples = Vec::with_capacity(RUNS);
    for _ in 0..RUNS {
        let start = Instant::now();
        let scaled = downscale_area(src, sw, sh, tw, th);
        let rgba = render_passes(scaled, tw, th, matrix, state);
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(rgba.len(), tw * th * 4);
        samples.push(elapsed);
    }
    println!("{label:<24} {tw}x{th}  median {:>7.1} ms  (downscale + passes, median-of-{RUNS})", median_ms(samples));
}

#[test]
#[ignore]
fn cpu_render_5d3_l1_at_2048() {
    let path = fixture();
    assert!(path.exists(), "missing fixture {path:?} - run scripts/fetch-fixtures.sh");
    let cancel: CancelFlag = Arc::new(AtomicBool::new(false));

    let decode_start = Instant::now();
    let raw = match decode_half(&path, &cancel) {
        Ok(raw) => raw,
        Err(error) => panic!("decode L1 failed: {error}"),
    };
    let decode_ms = decode_start.elapsed().as_secs_f64() * 1000.0;

    let src: Vec<f32> = raw.rgb_f16.iter().map(|value| value.to_f32()).collect();
    let sw = raw.width as usize;
    let sh = raw.height as usize;
    let matrix = raw.cam_to_rec2020.unwrap_or(IDENTITY3);
    let (tw, th) = target_dims(sw, sh);

    println!("\n=== CPU-RENDER-PERF 5D3 (build profile matters; run with --release) ===");
    println!("L1 source {sw}x{sh}  cam_matrix={}  decode_half {decode_ms:.1} ms", raw.cam_to_rec2020.is_some());
    println!("target {tw}x{th} (max_edge {MAX_EDGE})");
    bench("default (1,4,8)", &src, sw, sh, &matrix, &default_edit_state());
    bench("heavy (1,3,4,5,7,8)", &src, sw, sh, &matrix, &heavy_state());
    println!("=== CPU-RENDER-PERF end ===\n");
}
