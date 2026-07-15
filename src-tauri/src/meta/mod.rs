pub mod exif;
pub mod gps;

#[cfg(test)]
mod fixtures_test;

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use ::exif::Tag;

use crate::meta::exif::ExifData;
use crate::scan::is_raw_ext;
use crate::types_meta::{
    CameraMeta, DatesMeta, DepthOfField, ExposureMeta, FileMeta, FlashInfo, ImageMetadata, LensMeta, MetadataWarning, RawMeta, SensorType,
    ShutterSpeed,
};
use crate::xmp;

pub fn build_metadata(path: &Path) -> ImageMetadata {
    let ext = path.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase()).unwrap_or_default();
    let is_raw = is_raw_ext(path);
    let exif = ExifData::read(path);
    let fs_meta = std::fs::metadata(path).ok();

    let exif_iso = exif.uint(Tag::PhotographicSensitivity).or_else(|| exif.uint(Tag::ISOSpeed));
    let exif_shutter = exif.urational(Tag::ExposureTime).map(|(num, den)| ShutterSpeed { num, den });
    let exif_fnumber = exif.float(Tag::FNumber);
    let exif_focal = exif.float(Tag::FocalLength);
    let exif_focal35 = exif.float(Tag::FocalLengthIn35mmFilm);
    let exif_max_ap = exif.float(Tag::MaxApertureValue).map(apex_to_fnumber);

    let mut camera_make = exif.string(Tag::Make);
    let mut camera_model = exif.string(Tag::Model);
    let camera_serial = exif.string(Tag::BodySerialNumber);
    let mut firmware = exif.string(Tag::Software);
    let mut sensor_type = SensorType::Unknown;
    let mut cfa_pattern = None;
    let mut lens_make = exif.string(Tag::LensMake);
    let mut lens_model = exif.string(Tag::LensModel);
    let mut lens_serial = exif.string(Tag::LensSerialNumber);
    let mut teleconverter = None;
    let mut iso = exif_iso;
    let mut shutter_speed = exif_shutter;
    let mut f_number = exif_fnumber;
    let mut focal_length = exif_focal;
    let mut focal_length35mm = exif_focal35;
    let mut max_aperture = exif_max_ap;
    let mut width = exif.uint(Tag::PixelXDimension);
    let mut height = exif.uint(Tag::PixelYDimension);
    let mut bit_depth = exif.uint(Tag::BitsPerSample);
    let mut has_cam_matrix = false;
    let mut probe_ok = false;
    let mut raw_section: Option<RawMeta> = None;

    #[cfg(feature = "libraw")]
    if is_raw {
        if let Some(probe) = crate::decode::probe_metadata(path) {
            probe_ok = true;
            has_cam_matrix = probe.has_cam_matrix;
            sensor_type = map_sensor(probe.sensor);
            cfa_pattern = probe.cfa_pattern.clone();
            raw_section = Some(build_raw(&probe, &ext, &exif));
            camera_make = camera_make.or(probe.make);
            camera_model = camera_model.or(probe.model);
            firmware = firmware.or(probe.software);
            lens_make = lens_make.or(probe.lens_make);
            lens_model = lens_model.or(probe.lens_model);
            lens_serial = lens_serial.or(probe.lens_serial);
            teleconverter = probe.teleconverter;
            iso = iso.or_else(|| probe.iso.map(|value| value.round() as u32));
            shutter_speed = shutter_speed.or_else(|| probe.shutter.map(seconds_to_shutter));
            f_number = f_number.or_else(|| probe.aperture.map(|value| value as f64));
            focal_length = focal_length.or_else(|| probe.focal_len.map(|value| value as f64));
            focal_length35mm = focal_length35mm.or_else(|| probe.focal_35mm.map(|value| value as f64));
            max_aperture = max_aperture.or_else(|| probe.max_aperture.map(|value| value as f64));
            width = probe.width.or(width);
            height = probe.height.or(height);
            bit_depth = probe.max_value.map(bits_from_max).or(bit_depth);
        }
    }

    let crop_factor = match (focal_length35mm, focal_length) {
        (Some(equivalent), Some(actual)) if actual > 0.0 => Some(equivalent / actual),
        _ => None,
    };

    let megapixels = match (width, height) {
        (Some(w), Some(h)) => Some((w as f64 * h as f64) / 1_000_000.0),
        _ => None,
    };

    let subject_distance = exif.float(Tag::SubjectDistance).filter(|value| value.is_finite() && *value > 0.0);
    let dof = match (focal_length, f_number, subject_distance, crop_factor) {
        (Some(focal), Some(fnum), Some(distance), Some(crop)) => compute_dof(focal, fnum, distance, crop),
        _ => None,
    };

    let file = FileMeta {
        name: path.file_name().and_then(|value| value.to_str()).unwrap_or_default().to_owned(),
        path: path.to_string_lossy().into_owned(),
        size_bytes: fs_meta.as_ref().map(|meta| meta.len() as f64).unwrap_or(0.0),
        format: format_label(&ext),
        width,
        height,
        megapixels,
        bit_depth,
        color_space: exif.uint(Tag::ColorSpace).map(color_space_label),
        icc_profile_name: None,
        created_at: fs_meta.as_ref().and_then(|meta| meta.created().ok()).map(system_time_ms),
        modified_at: fs_meta.as_ref().and_then(|meta| meta.modified().ok()).map(system_time_ms),
        has_sidecar: xmp::sidecar_path(path).exists(),
    };

    let camera = CameraMeta {
        make: camera_make,
        model: camera_model,
        serial: camera_serial,
        firmware,
        sensor_type,
        cfa_pattern,
        crop_factor,
    };

    let lens = LensMeta {
        make: lens_make,
        model: lens_model,
        serial: lens_serial,
        mount: None,
        max_aperture,
        focal_length35mm,
        teleconverter,
    };

    let exposure = ExposureMeta {
        shutter_speed,
        f_number,
        iso,
        focal_length,
        exposure_bias: exif.float(Tag::ExposureBiasValue),
        exposure_mode: exif.uint(Tag::ExposureMode).map(exposure_mode_label),
        metering_mode: exif.uint(Tag::MeteringMode).map(metering_label),
        flash: exif.uint(Tag::Flash).map(flash_info),
        white_balance: exif.uint(Tag::WhiteBalance).map(white_balance_label),
        wb_temp: None,
        subject_distance,
        dof,
        drive_mode: None,
        stabilization: None,
    };

    let dates = DatesMeta {
        original: exif.string(Tag::DateTimeOriginal),
        digitized: exif.string(Tag::DateTimeDigitized),
        modified: exif.string(Tag::DateTime),
        timezone_offset: exif.string(Tag::OffsetTimeOriginal),
        sub_sec: exif.string(Tag::SubSecTimeOriginal),
    };

    let gps = gps::from_exif(&exif);

    let warnings = collect_warnings(is_raw, &ext, sensor_type, has_cam_matrix, probe_ok, &exif);

    ImageMetadata {
        file,
        camera,
        lens,
        exposure,
        dates,
        gps,
        raw: raw_section,
        warnings,
    }
}

#[cfg(feature = "libraw")]
fn map_sensor(kind: crate::decode::SensorKind) -> SensorType {
    match kind {
        crate::decode::SensorKind::Bayer => SensorType::Bayer,
        crate::decode::SensorKind::Xtrans => SensorType::Xtrans,
        crate::decode::SensorKind::Monochrome => SensorType::Monochrome,
        crate::decode::SensorKind::Foveon => SensorType::Foveon,
        crate::decode::SensorKind::Unknown => SensorType::Unknown,
    }
}

#[cfg(feature = "libraw")]
fn build_raw(probe: &crate::decode::ProbeMetadata, ext: &str, exif: &ExifData) -> RawMeta {
    let is_dng = ext == "dng" || probe.dng_version != 0;
    let dng_version = if probe.dng_version != 0 {
        Some(dng_version_string(probe.dng_version))
    } else {
        None
    };
    let as_shot_neutral = probe.cam_mul.and_then(as_shot_neutral);
    let embedded_previews = probe
        .embedded_previews
        .iter()
        .map(|(width, height, format)| crate::types_meta::EmbeddedPreview {
            width: *width,
            height: *height,
            format: format.clone(),
        })
        .collect();
    RawMeta {
        is_dng,
        dng_version,
        black_level: probe.black_levels.clone(),
        white_level: probe.white_levels.clone(),
        as_shot_neutral,
        has_color_matrix: probe.has_cam_matrix,
        compression: exif.uint(Tag::Compression).map(compression_label),
        embedded_previews,
        has_opcode_list: false,
    }
}

fn collect_warnings(
    is_raw: bool,
    ext: &str,
    sensor_type: SensorType,
    has_cam_matrix: bool,
    probe_ok: bool,
    exif: &ExifData,
) -> Vec<MetadataWarning> {
    let mut warnings = Vec::new();
    if is_raw && probe_ok && !has_cam_matrix {
        warnings.push(MetadataWarning::NoColorProfile);
    }
    if ext == "x3f" || sensor_type == SensorType::Foveon {
        warnings.push(MetadataWarning::UnsupportedSensor);
    }
    let raw_unreadable = is_raw && !probe_ok && ext != "x3f";
    let general_unreadable = !is_raw && exif.errored && !exif.has_exif() && matches!(ext, "jpg" | "jpeg" | "tif" | "tiff");
    if raw_unreadable || general_unreadable {
        warnings.push(MetadataWarning::CorruptExif);
    }
    warnings
}

fn system_time_ms(time: SystemTime) -> f64 {
    time.duration_since(UNIX_EPOCH).map(|value| value.as_millis() as f64).unwrap_or(0.0)
}

fn format_label(ext: &str) -> String {
    match ext {
        "jpg" | "jpeg" => "JPEG".to_owned(),
        "tif" | "tiff" => "TIFF".to_owned(),
        "" => "Unknown".to_owned(),
        other => other.to_ascii_uppercase(),
    }
}

fn apex_to_fnumber(apex: f64) -> f64 {
    2.0_f64.powf(apex / 2.0)
}

fn seconds_to_shutter(seconds: f32) -> ShutterSpeed {
    if seconds <= 0.0 || !seconds.is_finite() {
        return ShutterSpeed { num: 0, den: 1 };
    }
    if seconds >= 1.0 {
        ShutterSpeed {
            num: seconds.round() as u32,
            den: 1,
        }
    } else {
        ShutterSpeed {
            num: 1,
            den: (1.0 / seconds).round() as u32,
        }
    }
}

fn bits_from_max(max_value: u32) -> u32 {
    if max_value == 0 {
        return 0;
    }
    ((max_value as f64 + 1.0).log2().ceil()) as u32
}

fn color_space_label(value: u32) -> String {
    match value {
        1 => "sRGB".to_owned(),
        2 => "Adobe RGB".to_owned(),
        0xFFFF => "Uncalibrated".to_owned(),
        other => format!("Color space {other}"),
    }
}

fn exposure_mode_label(value: u32) -> String {
    match value {
        0 => "Auto".to_owned(),
        1 => "Manual".to_owned(),
        2 => "Auto bracket".to_owned(),
        other => format!("Mode {other}"),
    }
}

fn metering_label(value: u32) -> String {
    match value {
        0 => "Unknown".to_owned(),
        1 => "Average".to_owned(),
        2 => "Center-weighted".to_owned(),
        3 => "Spot".to_owned(),
        4 => "Multi-spot".to_owned(),
        5 => "Pattern".to_owned(),
        6 => "Partial".to_owned(),
        _ => "Other".to_owned(),
    }
}

fn white_balance_label(value: u32) -> String {
    match value {
        0 => "Auto".to_owned(),
        1 => "Manual".to_owned(),
        other => format!("White balance {other}"),
    }
}

fn flash_info(value: u32) -> FlashInfo {
    let fired = value & 1 != 0;
    let mode = if fired { "Fired".to_owned() } else { "Did not fire".to_owned() };
    FlashInfo {
        fired,
        mode,
        compensation: None,
    }
}

fn compression_label(value: u32) -> String {
    match value {
        1 => "Uncompressed".to_owned(),
        5 => "LZW".to_owned(),
        6 | 7 => "JPEG".to_owned(),
        8 => "Deflate".to_owned(),
        32773 => "PackBits".to_owned(),
        34892 => "Lossy JPEG".to_owned(),
        other => format!("Compression {other}"),
    }
}

fn dng_version_string(packed: u32) -> String {
    let bytes = packed.to_be_bytes();
    format!("{}.{}.{}.{}", bytes[0], bytes[1], bytes[2], bytes[3])
}

fn as_shot_neutral(cam_mul: [f32; 4]) -> Option<Vec<f64>> {
    let red = cam_mul[0] as f64;
    let green = cam_mul[1] as f64;
    let blue = cam_mul[2] as f64;
    if red > 0.0 && green > 0.0 && blue > 0.0 {
        Some(vec![green / red, 1.0, green / blue])
    } else {
        None
    }
}

fn compute_dof(focal_mm: f64, f_number: f64, distance_m: f64, crop_factor: f64) -> Option<DepthOfField> {
    if focal_mm <= 0.0 || f_number <= 0.0 || distance_m <= 0.0 || crop_factor <= 0.0 {
        return None;
    }
    let coc = 0.029 / crop_factor;
    let hyperfocal = focal_mm * focal_mm / (f_number * coc) + focal_mm;
    let subject = distance_m * 1000.0;
    let near = hyperfocal * subject / (hyperfocal + (subject - focal_mm));
    let far_denominator = hyperfocal - (subject - focal_mm);
    if far_denominator <= 0.0 {
        return None;
    }
    let far = hyperfocal * subject / far_denominator;
    if !near.is_finite() || !far.is_finite() || far <= near {
        return None;
    }
    Some(DepthOfField {
        near: near / 1000.0,
        far: far / 1000.0,
        hyperfocal: hyperfocal / 1000.0,
    })
}
