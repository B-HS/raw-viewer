use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use half::f16;
use image::imageops::{self, FilterType};
use image::{ImageBuffer, Rgb};

use crate::error::{AppError, AppResult};
use crate::export::filename::{self, parse_exif_datetime, TokenValues};
use crate::export::job::ExportJob;
use crate::export::{color, encode, exif, icc};
use crate::types_export::{ExportColorSpace, RasterExportRequest, RasterFormat, ResizeMode, ResizeSpec};
use crate::types_meta::ImageMetadata;

fn output_dims(resize: ResizeSpec, width: u32, height: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (width.max(1), height.max(1));
    }
    match resize.mode {
        ResizeMode::None => (width, height),
        ResizeMode::LongEdge => {
            if resize.value < 1.0 {
                return (width, height);
            }
            let long = f64::from(width.max(height));
            let scale = (resize.value / long).min(1.0);
            (
                ((f64::from(width) * scale).round().max(1.0)) as u32,
                ((f64::from(height) * scale).round().max(1.0)) as u32,
            )
        }
        ResizeMode::Percent => {
            let scale = resize.value / 100.0;
            if scale <= 0.0 {
                return (width, height);
            }
            (
                ((f64::from(width) * scale).round().max(1.0)) as u32,
                ((f64::from(height) * scale).round().max(1.0)) as u32,
            )
        }
    }
}

fn resized_linear(canvas: &[f16], width: u32, height: u32, out_width: u32, out_height: u32) -> AppResult<Vec<f32>> {
    if out_width == width && out_height == height {
        return Ok(canvas.iter().map(|value| value.to_f32()).collect());
    }
    let mut lo = f32::INFINITY;
    let mut hi = f32::NEG_INFINITY;
    for value in canvas {
        let sample = value.to_f32();
        if sample.is_finite() {
            lo = lo.min(sample);
            hi = hi.max(sample);
        }
    }
    if !lo.is_finite() || !hi.is_finite() {
        lo = 0.0;
        hi = 1.0;
    }
    let range = (hi - lo).max(1e-6);
    let normalized: Vec<f32> = canvas.iter().map(|value| ((value.to_f32() - lo) / range).clamp(0.0, 1.0)).collect();
    let image = ImageBuffer::<Rgb<f32>, Vec<f32>>::from_raw(width, height, normalized)
        .ok_or_else(|| AppError::Internal("export canvas size mismatch".to_owned()))?;
    let resized = imageops::resize(&image, out_width, out_height, FilterType::Lanczos3);
    Ok(resized.into_raw().iter().map(|value| value * range + lo).collect())
}

fn transform_to_bytes(linear: &[f32], space: ExportColorSpace, format: RasterFormat, bits: u8) -> Vec<u8> {
    let matrix = color::rec2020_to_target_matrix(space);
    let sixteen = matches!(encode::color_type(format, bits), image::ExtendedColorType::Rgb16);
    let bytes_per = if sixteen { 2 } else { 1 };
    let mut out = Vec::with_capacity((linear.len()) * bytes_per);
    for chunk in linear.chunks_exact(3) {
        let (tr, tg, tb) = color::apply_matrix(&matrix, chunk[0], chunk[1], chunk[2]);
        let r = color::encode_oetf(space, tr);
        let g = color::encode_oetf(space, tg);
        let b = color::encode_oetf(space, tb);
        if sixteen {
            out.extend_from_slice(&color::quantize_u16(r).to_ne_bytes());
            out.extend_from_slice(&color::quantize_u16(g).to_ne_bytes());
            out.extend_from_slice(&color::quantize_u16(b).to_ne_bytes());
        } else {
            out.push(color::quantize_u8(r));
            out.push(color::quantize_u8(g));
            out.push(color::quantize_u8(b));
        }
    }
    out
}

fn build_tokens(meta: &ImageMetadata, request: &RasterExportRequest, source: &Path, out_width: u32, out_height: u32) -> TokenValues {
    TokenValues {
        name: source.file_stem().and_then(|value| value.to_str()).unwrap_or("export").to_owned(),
        camera: meta.camera.model.clone().unwrap_or_default(),
        lens: meta.lens.model.clone().unwrap_or_default(),
        iso: meta.exposure.iso.map(|value| value.to_string()).unwrap_or_default(),
        fnumber: meta.exposure.f_number.map(|value| format!("{value:.1}")).unwrap_or_default(),
        shutter: meta.exposure.shutter_speed.map(|value| format!("{}/{}", value.num, value.den)).unwrap_or_default(),
        focal: meta.exposure.focal_length.map(|value| format!("{}mm", value.round() as i64)).unwrap_or_default(),
        width: out_width,
        height: out_height,
        preset: request.preset_name.clone().unwrap_or_default(),
        date: meta.dates.original.as_deref().and_then(parse_exif_datetime),
    }
}

pub fn run(
    canvas: &[f16],
    request: &RasterExportRequest,
    source: &Path,
    meta: &ImageMetadata,
    emit: impl Fn(u32, u32),
) -> AppResult<PathBuf> {
    let (out_width, out_height) = output_dims(request.resize, request.source_width, request.source_height);
    emit(1, 4);

    let tokens = build_tokens(meta, request, source, out_width, out_height);
    let stem = filename::render_stem(&request.filename_template, &tokens, request.seq);
    let ext = filename::extension(request.format);
    let target = match filename::resolve_output(&request.output_dir, &stem, ext, request.conflict) {
        Some(path) => path,
        None => return Ok(request.output_dir.join(format!("{stem}.{ext}"))),
    };

    let linear = resized_linear(canvas, request.source_width, request.source_height, out_width, out_height)?;
    emit(2, 4);

    let pixels = transform_to_bytes(&linear, request.color_space, request.format, request.bits);
    let profile = icc::profile_bytes(request.color_space);
    let encoded = encode::encode(request.format, out_width, out_height, request.bits, request.quality, &pixels, profile)?;
    emit(3, 4);

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&target, &encoded)?;
    if let Err(error) = exif::write_exif(&target, meta, request.metadata) {
        tracing::warn!(%error, path = %target.display(), "export exif write failed");
    }
    emit(4, 4);
    Ok(target)
}

pub fn finish_job(job: &ExportJob, source: &Path, emit: impl Fn(u32, u32)) -> AppResult<PathBuf> {
    if job.cancel.load(Ordering::Relaxed) {
        return Err(AppError::Internal("export cancelled".to_owned()));
    }
    let meta = crate::meta::build_metadata(source);
    run(&job.canvas, &job.request, source, &meta, emit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types_export::{ConflictPolicy, ExportMetadata, OutputSharpen};
    use crate::types_meta::{CameraMeta, DatesMeta, ExposureMeta, FileMeta, LensMeta, SensorType};

    fn spec(mode: ResizeMode, value: f64) -> ResizeSpec {
        ResizeSpec { mode, value }
    }

    fn minimal_meta() -> ImageMetadata {
        ImageMetadata {
            file: FileMeta {
                name: "IMG.dng".to_owned(),
                path: "/tmp/IMG.dng".to_owned(),
                size_bytes: 0.0,
                format: "dng".to_owned(),
                width: Some(2),
                height: Some(2),
                megapixels: None,
                bit_depth: None,
                color_space: None,
                icc_profile_name: None,
                created_at: None,
                modified_at: None,
                has_sidecar: false,
            },
            camera: CameraMeta {
                make: None,
                model: Some("TestCam".to_owned()),
                serial: None,
                firmware: None,
                sensor_type: SensorType::Bayer,
                cfa_pattern: None,
                crop_factor: None,
            },
            lens: LensMeta {
                make: None,
                model: None,
                serial: None,
                mount: None,
                max_aperture: None,
                focal_length35mm: None,
                teleconverter: None,
            },
            exposure: ExposureMeta {
                shutter_speed: None,
                f_number: None,
                iso: None,
                focal_length: None,
                exposure_bias: None,
                exposure_mode: None,
                metering_mode: None,
                flash: None,
                white_balance: None,
                wb_temp: None,
                subject_distance: None,
                dof: None,
                drive_mode: None,
                stabilization: None,
            },
            dates: DatesMeta {
                original: None,
                digitized: None,
                modified: None,
                timezone_offset: None,
                sub_sec: None,
            },
            gps: None,
            raw: None,
            warnings: Vec::new(),
        }
    }

    fn request(dir: &Path, format: RasterFormat, resize: ResizeSpec) -> RasterExportRequest {
        RasterExportRequest {
            image_id: "id".to_owned(),
            format,
            quality: 90,
            color_space: ExportColorSpace::Srgb,
            bits: 8,
            resize,
            sharpen: OutputSharpen::None,
            metadata: ExportMetadata::None,
            filename_template: "{name}_{seq:3}".to_owned(),
            output_dir: dir.to_path_buf(),
            conflict: ConflictPolicy::Rename,
            source_width: 2,
            source_height: 2,
            seq: 1,
            preset_name: None,
        }
    }

    #[test]
    fn output_dims_modes() {
        assert_eq!(output_dims(spec(ResizeMode::None, 0.0), 4000, 3000), (4000, 3000));
        assert_eq!(output_dims(spec(ResizeMode::LongEdge, 2000.0), 4000, 3000), (2000, 1500));
        assert_eq!(output_dims(spec(ResizeMode::LongEdge, 8000.0), 4000, 3000), (4000, 3000));
        assert_eq!(output_dims(spec(ResizeMode::Percent, 50.0), 4000, 3000), (2000, 1500));
    }

    #[test]
    fn resize_preserves_highlights_above_one() {
        let canvas = vec![f16::from_f32(2.5); 4 * 4 * 3];
        let Ok(out) = resized_linear(&canvas, 4, 4, 2, 2) else {
            panic!("resize failed");
        };
        assert_eq!(out.len(), 2 * 2 * 3);
        for value in out {
            assert!(value > 1.5, "highlight clamped to {value}");
        }
    }

    #[test]
    fn transform_white_to_full_range_srgb() {
        let linear = vec![1.0f32; 3];
        let bytes = transform_to_bytes(&linear, ExportColorSpace::Srgb, RasterFormat::Jpeg, 8);
        assert_eq!(bytes, vec![255u8, 255, 255]);
    }

    #[test]
    fn run_writes_png_with_icc() {
        let dir = std::env::temp_dir().join(format!("rawviewer-finish-{}", uuid::Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&dir);
        let canvas = vec![f16::from_f32(0.5); 2 * 2 * 3];
        let source = Path::new("/tmp/IMG_9.dng");
        let req = request(&dir, RasterFormat::Png, spec(ResizeMode::None, 0.0));
        let Ok(path) = run(&canvas, &req, source, &minimal_meta(), |_, _| {}) else {
            panic!("run failed");
        };
        assert!(path.exists(), "output not written");
        assert_eq!(path.file_name().and_then(|value| value.to_str()), Some("IMG_9_001.png"));
        let Ok(bytes) = std::fs::read(&path) else {
            panic!("read output failed");
        };
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(&bytes[1..4], b"PNG");
    }

    #[test]
    fn run_skip_returns_path_without_writing() {
        let dir = std::env::temp_dir().join(format!("rawviewer-skip-{}", uuid::Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&dir);
        let existing = dir.join("IMG_9_001.png");
        let _ = std::fs::write(&existing, b"stale");
        let canvas = vec![f16::from_f32(0.5); 2 * 2 * 3];
        let source = Path::new("/tmp/IMG_9.dng");
        let mut req = request(&dir, RasterFormat::Png, spec(ResizeMode::None, 0.0));
        req.conflict = ConflictPolicy::Skip;
        let Ok(path) = run(&canvas, &req, source, &minimal_meta(), |_, _| {}) else {
            panic!("run failed");
        };
        let Ok(contents) = std::fs::read(&existing) else {
            panic!("read failed");
        };
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(path, existing);
        assert_eq!(contents, b"stale", "skip must not overwrite");
    }
}
