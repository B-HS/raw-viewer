use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::{AppError, AppResult};

pub const DNGLAB_TARGET: &str = "aarch64-apple-darwin";

pub fn binary_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(format!("dnglab-{DNGLAB_TARGET}"));
            if candidate.exists() {
                return candidate;
            }
        }
    }
    Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!("dnglab-{DNGLAB_TARGET}"))
}

pub fn run_convert(binary: &Path, source: &Path, out_dir: &Path) -> AppResult<PathBuf> {
    if !binary.exists() {
        return Err(AppError::Internal(format!("dnglab binary not found: {}", binary.display())));
    }
    let stem = source.file_stem().and_then(|value| value.to_str()).unwrap_or("export");
    let out = out_dir.join(format!("{stem}.dng"));
    std::fs::create_dir_all(out_dir)?;
    let output = Command::new(binary)
        .arg("convert")
        .arg("-f")
        .arg(source)
        .arg(&out)
        .output()
        .map_err(|error| AppError::Internal(format!("failed to spawn dnglab: {error}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Internal(format!("dnglab convert failed ({}): {}", output.status, stderr.trim())));
    }
    Ok(out)
}

pub fn version(binary: &Path) -> AppResult<String> {
    let output = Command::new(binary)
        .arg("--version")
        .output()
        .map_err(|error| AppError::Internal(format!("failed to spawn dnglab: {error}")))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_path_uses_target_triple() {
        let path = binary_path();
        assert!(path.to_string_lossy().contains("dnglab-aarch64-apple-darwin"));
    }

    #[test]
    fn run_convert_errors_when_binary_absent() {
        let missing = Path::new("/nonexistent/dnglab-aarch64-apple-darwin");
        let result = run_convert(missing, Path::new("/tmp/in.cr2"), Path::new("/tmp"));
        assert!(result.is_err());
    }

    #[test]
    fn dnglab_reports_version_or_is_absent() {
        let binary = binary_path();
        if !binary.exists() {
            eprintln!("SKIP dnglab version test: binary absent at {}", binary.display());
            return;
        }
        match version(&binary) {
            Ok(text) => assert!(!text.is_empty(), "dnglab --version returned empty output"),
            Err(error) => panic!("dnglab --version failed: {error:?}"),
        }
    }
}
