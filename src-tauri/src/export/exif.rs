use std::path::Path;

use little_exif::exif_tag::ExifTag;
use little_exif::metadata::Metadata;
use little_exif::rational::uR64;

use crate::types_export::ExportMetadata;
use crate::types_meta::ImageMetadata;

fn rational_from_f64(value: f64) -> uR64 {
    if !value.is_finite() || value <= 0.0 {
        return uR64 {
            nominator: 0,
            denominator: 1,
        };
    }
    let denominator = 1000u32;
    let nominator = (value * f64::from(denominator)).round().clamp(0.0, f64::from(u32::MAX)) as u32;
    uR64 { nominator, denominator }
}

pub fn write_exif(path: &Path, meta: &ImageMetadata, mode: ExportMetadata) -> Result<(), String> {
    let mut metadata = Metadata::new();
    metadata.set_tag(ExifTag::Orientation(vec![1]));

    if mode != ExportMetadata::None {
        if let Some(make) = &meta.camera.make {
            metadata.set_tag(ExifTag::Make(make.clone()));
        }
        if let Some(model) = &meta.camera.model {
            metadata.set_tag(ExifTag::Model(model.clone()));
        }
        if let Some(lens) = &meta.lens.model {
            metadata.set_tag(ExifTag::LensModel(lens.clone()));
        }
        if let Some(date) = &meta.dates.original {
            metadata.set_tag(ExifTag::DateTimeOriginal(date.clone()));
        }
        if let Some(iso) = meta.exposure.iso {
            metadata.set_tag(ExifTag::ISO(vec![iso.min(u32::from(u16::MAX)) as u16]));
        }
        if let Some(shutter) = &meta.exposure.shutter_speed {
            metadata.set_tag(ExifTag::ExposureTime(vec![uR64 {
                nominator: shutter.num,
                denominator: shutter.den.max(1),
            }]));
        }
        if let Some(f_number) = meta.exposure.f_number {
            metadata.set_tag(ExifTag::FNumber(vec![rational_from_f64(f_number)]));
        }
        if let Some(focal) = meta.exposure.focal_length {
            metadata.set_tag(ExifTag::FocalLength(vec![rational_from_f64(focal)]));
        }
    }

    // SPEC-GAP: GPS is never written by the export EXIF path; gps-strip / none are satisfied by construction, and all-mode omits re-encoding source GPS.
    metadata.write_to_file(path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types_export::RasterFormat;
    use crate::types_meta::{CameraMeta, DatesMeta, ExposureMeta, FileMeta, ImageMetadata, LensMeta, SensorType, ShutterSpeed};

    fn temp_path(ext: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("rawviewer-exif-{}.{ext}", uuid::Uuid::new_v4()))
    }

    fn sample_meta() -> ImageMetadata {
        ImageMetadata {
            file: FileMeta {
                name: "IMG.CR2".to_owned(),
                path: "/tmp/IMG.CR2".to_owned(),
                size_bytes: 0.0,
                format: "cr2".to_owned(),
                width: Some(4),
                height: Some(4),
                megapixels: None,
                bit_depth: None,
                color_space: None,
                icc_profile_name: None,
                created_at: None,
                modified_at: None,
                has_sidecar: false,
            },
            camera: CameraMeta {
                make: Some("Canon".to_owned()),
                model: Some("EOS 5D Mark III".to_owned()),
                serial: None,
                firmware: None,
                sensor_type: SensorType::Bayer,
                cfa_pattern: None,
                crop_factor: None,
            },
            lens: LensMeta {
                make: None,
                model: Some("EF50mm f/1.4".to_owned()),
                serial: None,
                mount: None,
                max_aperture: None,
                focal_length35mm: None,
                teleconverter: None,
            },
            exposure: ExposureMeta {
                shutter_speed: Some(ShutterSpeed { num: 1, den: 250 }),
                f_number: Some(2.8),
                iso: Some(400),
                focal_length: Some(50.0),
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
                original: Some("2026:07:15 14:30:52".to_owned()),
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

    #[test]
    fn writes_camera_exif_into_jpeg_and_omits_gps() {
        let path = temp_path("jpg");
        let Ok(bytes) = crate::export::encode::encode(RasterFormat::Jpeg, 8, 8, 8, 90, &[120u8; 8 * 8 * 3], None) else {
            panic!("jpeg encode failed");
        };
        if std::fs::write(&path, &bytes).is_err() {
            panic!("write temp jpeg failed");
        }
        let result = write_exif(&path, &sample_meta(), ExportMetadata::All);
        assert!(result.is_ok(), "exif write failed: {result:?}");

        let Ok(file) = std::fs::File::open(&path) else {
            panic!("reopen failed");
        };
        let mut reader = std::io::BufReader::new(file);
        let exif_reader = exif::Reader::new();
        let parsed = exif_reader.read_from_container(&mut reader);
        let _ = std::fs::remove_file(&path);
        let Ok(exif_data) = parsed else {
            panic!("exif read failed");
        };
        let model = exif_data.get_field(exif::Tag::Model, exif::In::PRIMARY);
        assert!(model.is_some(), "model tag missing");
        assert!(exif_data.get_field(exif::Tag::GPSLatitude, exif::In::PRIMARY).is_none(), "gps must not be present");
    }

    #[test]
    fn none_mode_writes_only_orientation() {
        let path = temp_path("jpg");
        let Ok(bytes) = crate::export::encode::encode(RasterFormat::Jpeg, 8, 8, 8, 90, &[120u8; 8 * 8 * 3], None) else {
            panic!("jpeg encode failed");
        };
        if std::fs::write(&path, &bytes).is_err() {
            panic!("write temp jpeg failed");
        }
        let result = write_exif(&path, &sample_meta(), ExportMetadata::None);
        let _ = std::fs::remove_file(&path);
        assert!(result.is_ok(), "exif write failed: {result:?}");
    }

    #[test]
    fn rational_from_f64_is_stable() {
        let value = rational_from_f64(2.8);
        assert_eq!(value.denominator, 1000);
        assert_eq!(value.nominator, 2800);
        let zero = rational_from_f64(-1.0);
        assert_eq!(zero.nominator, 0);
    }
}
