use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use half::f16;

use crate::cpurender::passes;
use crate::cpurender::serve::{serialize_cpu_aeth, CpuFrameStore};
use crate::edit::EditService;
use crate::error::{AppError, AppResult};
use crate::pipeline::store::parse_aeth_header;
use crate::pipeline::Services;
use crate::scan;
use crate::types::EditState;
use crate::types_cpurender::CpuFrameReadyPayload;

pub const DECODE_TIMEOUT: Duration = Duration::from_secs(10);

struct CpuSource {
    width: usize,
    height: usize,
    flip: u8,
    rgb: Vec<f32>,
    matrix: [f32; 9],
}

fn matrix_or_identity(matrix: Option<Vec<f32>>) -> [f32; 9] {
    match matrix {
        Some(values) if values.len() == 9 => [
            values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7], values[8],
        ],
        _ => crate::cpurender::color::IDENTITY3,
    }
}

fn source_from_cached_l1(cached: crate::cache::CachedL1) -> Option<CpuSource> {
    let header = parse_aeth_header(&cached.body)?;
    let width = header.width as usize;
    let height = header.height as usize;
    let payload = cached.body.get(16..)?;
    let expected = width.checked_mul(height)?.checked_mul(3)?.checked_mul(2)?;
    if payload.len() < expected {
        return None;
    }
    let rgb: Vec<f32> = payload
        .chunks_exact(2)
        .take(width * height * 3)
        .map(|chunk| f16::from_le_bytes([chunk[0], chunk[1]]).to_f32())
        .collect();
    Some(CpuSource {
        width,
        height,
        flip: cached.flip,
        rgb,
        matrix: matrix_or_identity(cached.color_matrix),
    })
}

#[cfg(feature = "libraw")]
fn decode_l1_bounded(path: &Path, timeout: Duration) -> AppResult<CpuSource> {
    use std::sync::atomic::{AtomicBool, Ordering};

    let cancel: crate::decode::CancelFlag = Arc::new(AtomicBool::new(false));
    let (tx, rx) = std::sync::mpsc::channel();
    let decode_path = path.to_owned();
    let decode_cancel = Arc::clone(&cancel);
    rayon::spawn(move || {
        let outcome = crate::decode::decode_half(&decode_path, &decode_cancel);
        let _ = tx.send(outcome);
    });
    match rx.recv_timeout(timeout) {
        Ok(Ok(raw)) => Ok(CpuSource {
            width: raw.width as usize,
            height: raw.height as usize,
            flip: raw.flip,
            rgb: raw.rgb_f16.iter().map(|value| value.to_f32()).collect(),
            matrix: raw.cam_to_rec2020.unwrap_or(crate::cpurender::color::IDENTITY3),
        }),
        Ok(Err(error)) => Err(error.into()),
        Err(_) => {
            cancel.store(true, Ordering::Relaxed);
            Err(AppError::Decode("cpu render L1 decode timed out".to_owned()))
        }
    }
}

#[cfg(not(feature = "libraw"))]
fn decode_l1_bounded(_path: &Path, _timeout: Duration) -> AppResult<CpuSource> {
    Err(AppError::Decode("libraw feature disabled".to_owned()))
}

fn acquire_source(services: &Services, path: &Path, timeout: Duration) -> AppResult<CpuSource> {
    if let Some(cached) = services.cache.load_l1(path) {
        if let Some(source) = source_from_cached_l1(cached) {
            return Ok(source);
        }
    }
    decode_l1_bounded(path, timeout)
}

fn target_dims(width: usize, height: usize, max_edge: u32) -> (usize, usize) {
    let long = width.max(height) as f64;
    let scale = if max_edge == 0 || long == 0.0 { 1.0 } else { (f64::from(max_edge) / long).min(1.0) };
    let target_width = ((width as f64 * scale).round() as usize).max(1);
    let target_height = ((height as f64 * scale).round() as usize).max(1);
    (target_width, target_height)
}

fn render_source(source: &CpuSource, state: &EditState, max_edge: u32) -> (Vec<u8>, u32, u32) {
    let (target_width, target_height) = target_dims(source.width, source.height, max_edge);
    let scaled = passes::downscale_area(&source.rgb, source.width, source.height, target_width, target_height);
    let rgba = passes::render_passes(scaled, target_width, target_height, &source.matrix, state);
    (rgba, target_width as u32, target_height as u32)
}

pub fn render_and_store(
    services: &Services,
    edits: &EditService,
    cpu_store: &CpuFrameStore,
    image_id: &str,
    max_edge: u32,
) -> AppResult<CpuFrameReadyPayload> {
    let path = services
        .registry
        .resolve(image_id)
        .ok_or_else(|| AppError::Io(format!("unknown image id: {image_id}")))?;
    let is_raw = scan::is_raw_ext(&path);
    let envelope = edits.get_or_load(image_id, &path, is_raw)?;
    let source = acquire_source(services, &path, DECODE_TIMEOUT)?;
    let (rgba, width, height) = render_source(&source, &envelope.state, max_edge);
    let body = serialize_cpu_aeth(width, height, &rgba);
    let rev = cpu_store.put(image_id, Arc::new(body));
    Ok(CpuFrameReadyPayload {
        image_id: image_id.to_owned(),
        rev,
        width,
        height,
        flip: source.flip,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_dims_downscales_long_edge() {
        assert_eq!(target_dims(2898, 1935, 2048), (2048, 1367));
        assert_eq!(target_dims(2898, 1935, 4096), (2898, 1935));
        assert_eq!(target_dims(1000, 500, 0), (1000, 500));
        assert_eq!(target_dims(500, 1000, 250), (125, 250));
    }

    #[test]
    fn render_source_produces_rgba_at_target() {
        let source = CpuSource {
            width: 64,
            height: 32,
            flip: 0,
            rgb: vec![0.2f32; 64 * 32 * 3],
            matrix: crate::cpurender::color::IDENTITY3,
        };
        let state = crate::edit::defaults::default_edit_state();
        let (rgba, width, height) = render_source(&source, &state, 16);
        assert_eq!((width, height), (16, 8));
        assert_eq!(rgba.len(), 16 * 8 * 4);
        assert_eq!(rgba[3], 255);
    }

    #[test]
    fn cached_l1_source_parses_body_matrix_flip() {
        let width = 3usize;
        let height = 2usize;
        let mut body = Vec::new();
        body.extend_from_slice(b"AETH");
        body.extend_from_slice(&(width as u32).to_le_bytes());
        body.extend_from_slice(&(height as u32).to_le_bytes());
        body.push(2);
        body.push(3);
        body.extend_from_slice(&[0u8, 0u8]);
        for _ in 0..(width * height * 3) {
            body.extend_from_slice(&f16::from_f32(0.5).to_le_bytes());
        }
        let cached = crate::cache::CachedL1 {
            body,
            flip: 6,
            has_color_profile: true,
            color_matrix: Some(crate::cpurender::color::REC2020_TO_SRGB.to_vec()),
        };
        let source = source_from_cached_l1(cached).expect("valid cached L1");
        assert_eq!((source.width, source.height, source.flip), (3, 2, 6));
        assert_eq!(source.rgb.len(), 3 * 2 * 3);
        assert!((source.rgb[0] - 0.5).abs() < 1e-2);
        assert_eq!(source.matrix, crate::cpurender::color::REC2020_TO_SRGB);
    }
}
