use std::path::Path;

pub const SUBCOMMAND: &str = "__decode";

pub const EXIT_OK: i32 = 0;
pub const EXIT_DECODE_ERROR: i32 = 1;
pub const EXIT_WRITE_ERROR: i32 = 2;
pub const EXIT_NO_LIBRAW: i32 = 3;
pub const EXIT_BAD_ARGS: i32 = 4;

#[cfg(feature = "libraw")]
use serde::{Deserialize, Serialize};

#[cfg(feature = "libraw")]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Sidecar {
    width: u32,
    height: u32,
    flip: u8,
    has_color_profile: Option<bool>,
    color_matrix: Option<Vec<f32>>,
}

#[cfg(feature = "libraw")]
fn sidecar_path(out: &Path) -> std::path::PathBuf {
    out.with_extension("json")
}

pub fn dispatch_argv(args: &[String]) -> Option<i32> {
    if args.get(1).map(String::as_str) != Some(SUBCOMMAND) {
        return None;
    }
    match (args.get(2), args.get(3), args.get(4)) {
        (Some(path), Some(level), Some(out)) => Some(run_child(Path::new(path), level, Path::new(out))),
        _ => Some(EXIT_BAD_ARGS),
    }
}

#[cfg(feature = "libraw")]
fn run_child(path: &Path, level: &str, out: &Path) -> i32 {
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    use crate::decode::{self, DecodedRaw};
    use crate::pipeline::store::serialize_aeth;

    fn from_raw(raw: DecodedRaw) -> (Vec<u8>, Sidecar) {
        let body = serialize_aeth(raw.width, raw.height, &raw.rgb_f16);
        let color_matrix = raw.cam_to_rec2020.map(|matrix| matrix.to_vec());
        (
            body,
            Sidecar {
                width: raw.width,
                height: raw.height,
                flip: raw.flip,
                has_color_profile: Some(raw.cam_to_rec2020.is_some()),
                color_matrix,
            },
        )
    }

    let cancel: decode::CancelFlag = Arc::new(AtomicBool::new(false));
    let produced = match level {
        "l0" => decode::extract_thumb(path).map(|thumb| {
            (
                thumb.jpeg,
                Sidecar {
                    width: thumb.width,
                    height: thumb.height,
                    flip: 0,
                    has_color_profile: None,
                    color_matrix: None,
                },
            )
        }),
        "l1" => decode::decode_half(path, &cancel).map(from_raw),
        "l2" => decode::decode_full(path, &cancel).map(from_raw),
        _ => return EXIT_BAD_ARGS,
    };

    match produced {
        Ok((body, sidecar)) => match write_output(out, &body, &sidecar) {
            Ok(()) => EXIT_OK,
            Err(error) => {
                tracing::warn!(%error, "isolated decode write failed");
                EXIT_WRITE_ERROR
            }
        },
        Err(error) => {
            tracing::warn!(%error, "isolated decode failed");
            EXIT_DECODE_ERROR
        }
    }
}

#[cfg(not(feature = "libraw"))]
fn run_child(_path: &Path, _level: &str, _out: &Path) -> i32 {
    EXIT_NO_LIBRAW
}

#[cfg(feature = "libraw")]
fn write_output(out: &Path, body: &[u8], sidecar: &Sidecar) -> std::io::Result<()> {
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec(sidecar).map_err(std::io::Error::other)?;
    std::fs::write(out, body)?;
    std::fs::write(sidecar_path(out), json)?;
    Ok(())
}

#[cfg(feature = "libraw")]
mod parent {
    use std::path::{Path, PathBuf};
    use std::process::Child;
    use std::sync::atomic::Ordering;
    use std::time::{Duration, Instant};

    use super::{sidecar_path, Sidecar, SUBCOMMAND};
    use crate::decode::{CancelFlag, DecodeError};
    use crate::types::ProxyLevel;

    pub const SUBPROCESS_TIMEOUT: Duration = Duration::from_secs(60);
    const POLL_INTERVAL: Duration = Duration::from_millis(50);

    pub struct IsolatedDecoded {
        pub body: Vec<u8>,
        pub width: u32,
        pub height: u32,
        pub flip: u8,
        pub has_color_profile: Option<bool>,
        pub color_matrix: Option<Vec<f32>>,
    }

    pub fn level_arg(level: ProxyLevel) -> &'static str {
        match level {
            ProxyLevel::L0 => "l0",
            ProxyLevel::L1 => "l1",
            ProxyLevel::L2 => "l2",
        }
    }

    struct TempFiles {
        paths: Vec<PathBuf>,
    }

    impl Drop for TempFiles {
        fn drop(&mut self) {
            for path in &self.paths {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    pub fn decode_via_subprocess(path: &Path, level: ProxyLevel, cancel: &CancelFlag) -> Result<IsolatedDecoded, DecodeError> {
        let exe = std::env::current_exe().map_err(|error| DecodeError::LibRaw(format!("current_exe: {error}")))?;
        let out = std::env::temp_dir().join(format!("raw-viewer-isolate-{}.aeth", uuid::Uuid::new_v4()));
        let out_arg = out.clone();
        let source = path.to_path_buf();
        let level_str = level_arg(level);
        decode_via_subprocess_with(&out, cancel, SUBPROCESS_TIMEOUT, move || {
            std::process::Command::new(&exe)
                .arg(SUBCOMMAND)
                .arg(&source)
                .arg(level_str)
                .arg(&out_arg)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
        })
    }

    pub fn decode_via_subprocess_with(
        out: &Path,
        cancel: &CancelFlag,
        timeout: Duration,
        spawn: impl FnOnce() -> std::io::Result<Child>,
    ) -> Result<IsolatedDecoded, DecodeError> {
        let _cleanup = TempFiles {
            paths: vec![out.to_path_buf(), sidecar_path(out)],
        };
        let mut child = spawn().map_err(|error| DecodeError::LibRaw(format!("spawn isolated decode: {error}")))?;
        let deadline = Instant::now() + timeout;
        loop {
            if cancel.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(DecodeError::Cancelled);
            }
            match child.try_wait() {
                Ok(Some(status)) => {
                    if status.success() {
                        return read_output(out);
                    }
                    return Err(DecodeError::LibRaw(format!("isolated decode failed (exit {})", status.code().unwrap_or(-1))));
                }
                Ok(None) => {}
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(DecodeError::LibRaw(format!("isolated decode wait: {error}")));
                }
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err(DecodeError::LibRaw("isolated decode timed out".to_owned()));
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    }

    pub fn read_output(out: &Path) -> Result<IsolatedDecoded, DecodeError> {
        let body = std::fs::read(out).map_err(|error| DecodeError::LibRaw(format!("read isolated body: {error}")))?;
        let sidecar_bytes = std::fs::read(sidecar_path(out)).map_err(|error| DecodeError::LibRaw(format!("read isolated sidecar: {error}")))?;
        let sidecar: Sidecar = serde_json::from_slice(&sidecar_bytes).map_err(|error| DecodeError::LibRaw(format!("parse isolated sidecar: {error}")))?;
        Ok(IsolatedDecoded {
            body,
            width: sidecar.width,
            height: sidecar.height,
            flip: sidecar.flip,
            has_color_profile: sidecar.has_color_profile,
            color_matrix: sidecar.color_matrix,
        })
    }
}

#[cfg(feature = "libraw")]
pub use parent::{decode_via_subprocess, decode_via_subprocess_with, level_arg, read_output, IsolatedDecoded, SUBPROCESS_TIMEOUT};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatch_ignores_non_subcommand() {
        assert_eq!(dispatch_argv(&[]), None);
        assert_eq!(dispatch_argv(&["exe".to_owned()]), None);
        assert_eq!(dispatch_argv(&["exe".to_owned(), "open".to_owned(), "file".to_owned()]), None);
    }

    #[test]
    fn dispatch_bad_args_returns_exit_code() {
        assert_eq!(dispatch_argv(&["exe".to_owned(), SUBCOMMAND.to_owned()]), Some(EXIT_BAD_ARGS));
        assert_eq!(dispatch_argv(&["exe".to_owned(), SUBCOMMAND.to_owned(), "p".to_owned()]), Some(EXIT_BAD_ARGS));
    }

    #[cfg(feature = "libraw")]
    fn fixtures_dir() -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("tests").join("fixtures").join("tier1")
    }

    #[cfg(feature = "libraw")]
    #[test]
    fn sidecar_path_swaps_extension() {
        assert_eq!(sidecar_path(Path::new("/tmp/x.aeth")), std::path::PathBuf::from("/tmp/x.json"));
    }

    #[cfg(feature = "libraw")]
    #[test]
    fn isolate_child_reentry() {
        let spec = match std::env::var("RAW_VIEWER_ISOLATE_SPEC") {
            Ok(spec) => spec,
            Err(_) => return,
        };
        let args: Vec<String> = match serde_json::from_str(&spec) {
            Ok(args) => args,
            Err(_) => std::process::exit(90),
        };
        match dispatch_argv(&args) {
            Some(code) => std::process::exit(code),
            None => std::process::exit(91),
        }
    }

    #[cfg(feature = "libraw")]
    #[test]
    #[ignore = "slow isolated-decode roundtrip (real LibRaw decode); run in acceptance via `cargo test --release isolate::tests -- --ignored`"]
    fn child_write_then_parent_read_roundtrips() -> Result<(), crate::decode::DecodeError> {
        use std::sync::atomic::AtomicBool;
        use std::sync::Arc;

        let fixture = fixtures_dir().join("canon-eos-5d-mark-iii.cr2");
        if !fixture.is_file() {
            eprintln!("skipping child_write_then_parent_read_roundtrips: fixture not present");
            return Ok(());
        }
        let out = std::env::temp_dir().join(format!("raw-viewer-isolate-unit-{}.aeth", uuid::Uuid::new_v4()));
        assert_eq!(run_child(&fixture, "l1", &out), EXIT_OK);
        let isolated = read_output(&out)?;
        let _ = std::fs::remove_file(&out);
        let _ = std::fs::remove_file(sidecar_path(&out));

        let cancel: crate::decode::CancelFlag = Arc::new(AtomicBool::new(false));
        let reference = crate::decode::decode_half(&fixture, &cancel)?;
        let expected = crate::pipeline::store::serialize_aeth(reference.width, reference.height, &reference.rgb_f16);
        assert_eq!(isolated.body, expected);
        assert_eq!(isolated.width, reference.width);
        assert_eq!(isolated.height, reference.height);
        assert_eq!(isolated.flip, reference.flip);
        assert_eq!(isolated.has_color_profile, Some(reference.cam_to_rec2020.is_some()));
        assert_eq!(isolated.color_matrix, reference.cam_to_rec2020.map(|matrix| matrix.to_vec()));
        Ok(())
    }

    #[cfg(feature = "libraw")]
    #[test]
    #[ignore = "slow isolated-decode subprocess roundtrip (spawns child process + real LibRaw decode); run in acceptance via `cargo test --release isolate::tests -- --ignored`"]
    fn subprocess_roundtrip_matches_in_process() -> Result<(), crate::decode::DecodeError> {
        use std::sync::atomic::AtomicBool;
        use std::sync::Arc;

        let fixture = fixtures_dir().join("canon-eos-5d-mark-iii.cr2");
        if !fixture.is_file() {
            eprintln!("skipping subprocess_roundtrip_matches_in_process: fixture not present");
            return Ok(());
        }
        let exe = std::env::current_exe().map_err(|error| crate::decode::DecodeError::LibRaw(error.to_string()))?;
        let out = std::env::temp_dir().join(format!("raw-viewer-isolate-e2e-{}.aeth", uuid::Uuid::new_v4()));
        let spec_args = vec![
            "raw-viewer".to_owned(),
            SUBCOMMAND.to_owned(),
            fixture.to_string_lossy().into_owned(),
            "l1".to_owned(),
            out.to_string_lossy().into_owned(),
        ];
        let spec = serde_json::to_string(&spec_args).unwrap_or_default();
        let cancel: crate::decode::CancelFlag = Arc::new(AtomicBool::new(false));
        let isolated = decode_via_subprocess_with(&out, &cancel, std::time::Duration::from_secs(120), move || {
            std::process::Command::new(&exe)
                .arg("isolate::tests::isolate_child_reentry")
                .arg("--exact")
                .arg("--quiet")
                .env("RAW_VIEWER_ISOLATE_SPEC", &spec)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
        })?;

        let reference = crate::decode::decode_half(&fixture, &cancel)?;
        let expected = crate::pipeline::store::serialize_aeth(reference.width, reference.height, &reference.rgb_f16);
        assert_eq!(isolated.width, reference.width);
        assert_eq!(isolated.height, reference.height);
        assert_eq!(isolated.flip, reference.flip);
        assert_eq!(isolated.has_color_profile, Some(reference.cam_to_rec2020.is_some()));
        assert_eq!(isolated.color_matrix, reference.cam_to_rec2020.map(|matrix| matrix.to_vec()));
        assert_eq!(isolated.body.len(), expected.len(), "isolated body length differs from in-process");
        assert!(isolated.body == expected, "isolated subprocess bytes differ from in-process decode");
        Ok(())
    }

    #[cfg(all(feature = "libraw", unix))]
    #[test]
    fn subprocess_times_out_and_kills_child() {
        use std::sync::atomic::AtomicBool;
        use std::sync::Arc;

        let out = std::env::temp_dir().join(format!("raw-viewer-isolate-timeout-{}.aeth", uuid::Uuid::new_v4()));
        let cancel: crate::decode::CancelFlag = Arc::new(AtomicBool::new(false));
        let start = std::time::Instant::now();
        let result = decode_via_subprocess_with(&out, &cancel, std::time::Duration::from_millis(200), || std::process::Command::new("sleep").arg("30").spawn());
        assert!(result.is_err());
        assert!(start.elapsed() < std::time::Duration::from_secs(5), "timeout path did not return promptly");
    }

    #[cfg(all(feature = "libraw", unix))]
    #[test]
    fn subprocess_cancel_kills_child() {
        use std::sync::atomic::AtomicBool;
        use std::sync::Arc;

        let out = std::env::temp_dir().join(format!("raw-viewer-isolate-cancel-{}.aeth", uuid::Uuid::new_v4()));
        let cancel: crate::decode::CancelFlag = Arc::new(AtomicBool::new(true));
        let start = std::time::Instant::now();
        let result = decode_via_subprocess_with(&out, &cancel, std::time::Duration::from_secs(60), || std::process::Command::new("sleep").arg("30").spawn());
        assert!(matches!(result, Err(crate::decode::DecodeError::Cancelled)));
        assert!(start.elapsed() < std::time::Duration::from_secs(3), "cancel path did not return promptly");
    }
}
