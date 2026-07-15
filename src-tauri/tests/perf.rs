use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use raw_viewer_lib::decode::{decode_full, decode_half, extract_thumb, CancelFlag};

const RUNS: usize = 3;
const L2_SUBSET: [&str; 4] = ["canon-eos-5d-mark-iii.cr2", "fujifilm-x-t5.raf", "apple-iphone-12-pro.dng", "fujifilm-gfx-100.raf"];
const TARGET_L0_MS: f64 = 60.0;
const TARGET_L1_MS: f64 = 250.0;
const TARGET_L2_MS: f64 = 1200.0;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("tests").join("fixtures").join("tier1")
}

fn file_name(path: &Path) -> String {
    path.file_name().and_then(|value| value.to_str()).unwrap_or("").to_owned()
}

fn median_ms(mut samples: Vec<f64>) -> f64 {
    samples.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    samples[samples.len() / 2]
}

fn measure<F: FnMut() -> bool>(mut op: F) -> Option<f64> {
    let mut samples = Vec::with_capacity(RUNS);
    for _ in 0..RUNS {
        let start = Instant::now();
        let ok = op();
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        if !ok {
            return None;
        }
        samples.push(elapsed);
    }
    Some(median_ms(samples))
}

fn cell(value: Option<f64>, target: f64) -> String {
    match value {
        Some(ms) => {
            let mark = if ms <= target { "ok " } else { "OVER" };
            format!("{ms:>9.1} {mark}")
        }
        None => format!("{:>9} {:>4}", "n/a", "-"),
    }
}

#[test]
#[ignore]
fn perf_tier1_progressive_decode() {
    let dir = fixtures_dir();
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .expect("fixtures dir must exist - run scripts/fetch-fixtures.sh")
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && !file_name(path).starts_with('.'))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no fixtures found in {dir:?}");

    println!("\n=== PERF-HARNESS tier1 median-of-{RUNS} (ms; L0=extract_thumb L1=decode_half L2=decode_full) ===");
    println!("{:<28} {:>14} {:>14} {:>14}", "fixture", "L0", "L1", "L2");
    println!("{}", "-".repeat(74));

    let mut reference_l1: Option<f64> = None;
    for path in &files {
        let name = file_name(path);
        let cancel: CancelFlag = Arc::new(AtomicBool::new(false));

        let l0 = measure(|| extract_thumb(path).is_ok());
        let l1 = measure(|| decode_half(path, &cancel).is_ok());
        let l2 = if L2_SUBSET.contains(&name.as_str()) {
            measure(|| decode_full(path, &cancel).is_ok())
        } else {
            None
        };

        if name == "canon-eos-r5.cr3" {
            reference_l1 = l1;
        }
        println!("{:<28} {} {} {}", name, cell(l0, TARGET_L0_MS), cell(l1, TARGET_L1_MS), cell(l2, TARGET_L2_MS));
    }

    println!("{}", "-".repeat(74));
    println!("PRD 7.1 targets (baseline M1 8GB / Canon R5 CR3, cache-miss): L0<={TARGET_L0_MS} L1<={TARGET_L1_MS} L2<={TARGET_L2_MS}");
    println!("this machine is not the M1 8GB baseline - treat as approximate reference only");
    println!("=== PERF-HARNESS end ===\n");

    assert!(reference_l1.is_some(), "canon-eos-r5.cr3 reference fixture must decode L1 for a valid perf baseline");
}
