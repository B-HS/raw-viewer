use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use serde_json::Value;
use tauri::State;

use crate::error::AppResult;
use crate::pipeline::AppState;

const EXIFTOOL_TIMEOUT: Duration = Duration::from_secs(3);

fn exiftool_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["exiftool.exe", "exiftool.bat", "exiftool"]
    } else {
        &["exiftool"]
    }
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

fn find_in_dirs<I: Iterator<Item = PathBuf>>(dirs: I, names: &[&str]) -> Option<String> {
    for dir in dirs {
        for name in names {
            let candidate = dir.join(name);
            if is_executable_file(&candidate) {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}

pub fn detect_path() -> Option<String> {
    let path_var = std::env::var_os("PATH")?;
    find_in_dirs(std::env::split_paths(&path_var), exiftool_names())
}

fn run_json_with(exe: &str, path: &Path, timeout: Duration) -> Option<Value> {
    let mut child = Command::new(exe)
        .arg("-j")
        .arg("-G1")
        .arg("-a")
        .arg("-u")
        .arg("-n")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout.read_to_end(&mut buffer);
        let _ = tx.send(buffer);
    });

    match rx.recv_timeout(timeout) {
        Ok(buffer) => {
            let _ = child.wait();
            let parsed: Value = serde_json::from_slice(&buffer).ok()?;
            match parsed {
                Value::Array(array) => array.into_iter().next(),
                other => Some(other),
            }
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            tracing::warn!(exe, "exiftool timed out");
            None
        }
    }
}

pub fn run_json(exe: &str, path: &Path) -> Option<Value> {
    run_json_with(exe, path, EXIFTOOL_TIMEOUT)
}

#[tauri::command]
pub async fn detect_exiftool() -> AppResult<Option<String>> {
    Ok(detect_path())
}

#[tauri::command]
pub async fn get_deep_metadata(image_id: String, state: State<'_, AppState>) -> AppResult<Option<Value>> {
    let path = match state.services.registry.resolve(&image_id) {
        Some(path) => path,
        None => return Ok(None),
    };
    let exe = match detect_path() {
        Some(exe) => exe,
        None => return Ok(None),
    };
    tracing::debug!(image_id, "deep metadata via exiftool");
    let value = tauri::async_runtime::spawn_blocking(move || run_json(&exe, &path)).await.ok().flatten();
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("raw-viewer-exiftool-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    #[cfg(unix)]
    fn write_script(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let script = dir.join(name);
        let _ = std::fs::write(&script, body);
        let _ = std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755));
        script
    }

    #[cfg(unix)]
    #[test]
    fn run_json_unwraps_first_array_element() {
        let dir = temp_dir("ok");
        let script = write_script(&dir, "fake", "#!/bin/sh\nprintf '[{\"SourceFile\":\"x\",\"IFD1:Make\":\"Canon\"}]'\n");
        let target = dir.join("IMG.CR2");
        let _ = std::fs::write(&target, b"raw");
        let value = run_json_with(&script.to_string_lossy(), &target, Duration::from_secs(3));
        match value {
            Some(Value::Object(map)) => assert_eq!(map.get("IFD1:Make").and_then(Value::as_str), Some("Canon")),
            other => panic!("expected object, got {other:?}"),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn run_json_times_out_and_returns_none() {
        let dir = temp_dir("slow");
        let script = write_script(&dir, "fake", "#!/bin/sh\nsleep 5\nprintf '[{}]'\n");
        let target = dir.join("IMG.CR2");
        let _ = std::fs::write(&target, b"raw");
        let start = std::time::Instant::now();
        let value = run_json_with(&script.to_string_lossy(), &target, Duration::from_millis(300));
        assert!(value.is_none());
        assert!(start.elapsed() < Duration::from_secs(3));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn run_json_returns_none_on_invalid_json() {
        let dir = temp_dir("bad");
        let script = write_script(&dir, "fake", "#!/bin/sh\nprintf 'not json'\n");
        let target = dir.join("IMG.CR2");
        let _ = std::fs::write(&target, b"raw");
        let value = run_json_with(&script.to_string_lossy(), &target, Duration::from_secs(3));
        assert!(value.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_json_returns_none_for_missing_binary() {
        let value = run_json("definitely-not-a-real-binary-xyzzy", Path::new("/tmp/none.CR2"));
        assert!(value.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn find_in_dirs_detects_executable_and_skips_plain_file() {
        let dir = temp_dir("detect");
        let _ = write_script(&dir, "exiftool", "#!/bin/sh\ntrue\n");
        let plain = temp_dir("detect-plain");
        let _ = std::fs::write(plain.join("exiftool"), b"not executable");

        let found = find_in_dirs([dir.clone(), plain.clone()].into_iter(), &["exiftool"]);
        assert_eq!(found.as_deref(), Some(dir.join("exiftool").to_string_lossy().as_ref()));

        let missing = find_in_dirs([plain.clone()].into_iter(), &["exiftool"]);
        assert!(missing.is_none());

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&plain);
    }
}
