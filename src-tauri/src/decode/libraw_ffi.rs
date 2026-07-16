#[allow(non_upper_case_globals, non_camel_case_types, non_snake_case, dead_code, improper_ctypes)]
pub mod sys {
    include!(concat!(env!("OUT_DIR"), "/libraw_bindings.rs"));
}

use std::ffi::{CStr, CString};
use std::panic::{catch_unwind, UnwindSafe};
use std::path::Path;
use std::sync::atomic::Ordering;

use half::f16;

use super::{CancelFlag, DecodeError, DecodedRaw, ThumbData};

fn guarded<T>(f: impl FnOnce() -> Result<T, DecodeError> + UnwindSafe) -> Result<T, DecodeError> {
    match catch_unwind(f) {
        Ok(result) => result,
        Err(_) => Err(DecodeError::Panic),
    }
}

pub fn version() -> String {
    let ptr = unsafe { sys::libraw_version() };
    if ptr.is_null() {
        return String::new();
    }
    let raw = unsafe { CStr::from_ptr(ptr) };
    raw.to_string_lossy().into_owned()
}

pub fn probe() -> Result<(), DecodeError> {
    guarded(|| {
        let _handle = RawHandle::new()?;
        Ok(())
    })
}

pub fn probe_iso(path: &Path) -> Option<f32> {
    let probed = guarded(|| {
        let handle = RawHandle::new()?;
        let c_path = path_to_c(path)?;
        check_rc(unsafe { sys::libraw_open_file(handle.ptr, c_path.as_ptr()) }, "libraw_open_file")?;
        Ok(unsafe { (*handle.ptr).other.iso_speed })
    });
    probed.ok().filter(|iso| iso.is_finite() && *iso > 0.0)
}

fn c_string(bytes: &[std::os::raw::c_char]) -> Option<String> {
    let mut out = Vec::new();
    for &value in bytes {
        let byte = value as u8;
        if byte == 0 {
            break;
        }
        out.push(byte);
    }
    let text = String::from_utf8_lossy(&out).trim().to_owned();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn positive_f32(value: f32) -> Option<f32> {
    if value.is_finite() && value > 0.0 {
        Some(value)
    } else {
        None
    }
}

fn fc(filters: u32, row: u32, col: u32) -> usize {
    ((filters >> ((((row << 1) & 14) | (col & 1)) << 1)) & 3) as usize
}

fn cfa_pattern(filters: u32, cdesc: &[std::os::raw::c_char; 5]) -> Option<String> {
    if filters == 0 || filters == 9 {
        return None;
    }
    let desc = [cdesc[0] as u8, cdesc[1] as u8, cdesc[2] as u8, cdesc[3] as u8];
    let mut pattern = String::with_capacity(4);
    for (row, col) in [(0u32, 0u32), (0, 1), (1, 0), (1, 1)] {
        let index = fc(filters, row, col);
        let symbol = desc.get(index).copied().unwrap_or(b'?');
        pattern.push(if symbol.is_ascii_graphic() { symbol as char } else { '?' });
    }
    Some(pattern)
}

fn classify_sensor(is_foveon: u32, filters: u32, colors: i32) -> super::SensorKind {
    use super::SensorKind;
    if is_foveon != 0 {
        SensorKind::Foveon
    } else if filters == 9 {
        SensorKind::Xtrans
    } else if colors == 1 {
        SensorKind::Monochrome
    } else if filters != 0 {
        SensorKind::Bayer
    } else {
        SensorKind::Unknown
    }
}

fn embedded_previews(list: &sys::libraw_thumbnail_list_t) -> Vec<(u32, u32, String)> {
    let count = (list.thumbcount.max(0) as usize).min(list.thumblist.len());
    let mut previews = Vec::with_capacity(count);
    for item in list.thumblist.iter().take(count) {
        let format = if item.tformat == sys::LibRaw_internal_thumbnail_formats_LIBRAW_INTERNAL_THUMBNAIL_JPEG {
            "JPEG"
        } else {
            "Bitmap"
        };
        previews.push((item.twidth as u32, item.theight as u32, format.to_owned()));
    }
    previews
}

pub fn probe_metadata(path: &Path) -> Option<super::ProbeMetadata> {
    let probed = guarded(|| {
        let handle = RawHandle::new()?;
        let c_path = path_to_c(path)?;
        check_rc(unsafe { sys::libraw_open_file(handle.ptr, c_path.as_ptr()) }, "libraw_open_file")?;

        let data = unsafe { &*handle.ptr };
        let idata = &data.idata;
        let sizes = &data.sizes;
        let other = &data.other;
        let color = &data.color;
        let lens = &data.lens;

        let filters = idata.filters;
        let colors = idata.colors;
        let sensor = classify_sensor(idata.is_foveon, filters, colors);

        let mut black_levels = Vec::new();
        let cblack = &color.cblack;
        if cblack[0..4].iter().any(|&value| value != 0) {
            for &channel_black in &cblack[0..4] {
                black_levels.push(color.black.wrapping_add(channel_black));
            }
        } else {
            black_levels.push(color.black);
        }

        let mut white_levels = Vec::new();
        if color.maximum > 0 {
            white_levels.push(color.maximum);
        }

        let cam_xyz_nonzero = color.cam_xyz.iter().any(|row| row.iter().any(|&value| value != 0.0));
        let rgb_cam_nonzero = color.rgb_cam.iter().any(|row| row.iter().any(|&value| value != 0.0));

        let cam_mul = {
            let raw = color.cam_mul;
            if raw[0].is_finite() && raw[0] > 0.0 && raw[1] > 0.0 {
                Some(raw)
            } else {
                None
            }
        };

        let focal_35mm = positive_f32(lens.makernotes.FocalLengthIn35mmFormat)
            .or(if lens.FocalLengthIn35mmFormat > 0 { Some(lens.FocalLengthIn35mmFormat as f32) } else { None });
        let max_aperture = positive_f32(lens.makernotes.MaxAp).or_else(|| positive_f32(lens.EXIF_MaxAp));

        Ok(super::ProbeMetadata {
            make: c_string(&idata.make),
            model: c_string(&idata.model),
            software: c_string(&idata.software),
            body_serial: c_string(&data.shootinginfo.BodySerial),
            iso: positive_f32(other.iso_speed),
            shutter: positive_f32(other.shutter),
            aperture: positive_f32(other.aperture),
            focal_len: positive_f32(other.focal_len),
            sensor,
            cfa_pattern: cfa_pattern(filters, &idata.cdesc),
            black_levels,
            white_levels,
            max_value: if color.maximum > 0 { Some(color.maximum) } else { None },
            has_cam_matrix: cam_xyz_nonzero || rgb_cam_nonzero,
            flip: normalize_flip(sizes.flip),
            dng_version: idata.dng_version,
            cam_mul,
            lens_make: c_string(&lens.LensMake),
            lens_model: c_string(&lens.Lens),
            lens_serial: c_string(&lens.LensSerial),
            focal_35mm,
            max_aperture,
            teleconverter: c_string(&lens.makernotes.Teleconverter),
            embedded_previews: embedded_previews(&data.thumbs_list),
            width: if sizes.width > 0 { Some(sizes.width as u32) } else { None },
            height: if sizes.height > 0 { Some(sizes.height as u32) } else { None },
        })
    });
    probed.ok()
}

#[derive(Clone, Copy)]
pub enum DecodeLevel {
    Half,
    Full,
}

struct RawHandle {
    ptr: *mut sys::libraw_data_t,
}

impl RawHandle {
    fn new() -> Result<Self, DecodeError> {
        let ptr = unsafe { sys::libraw_init(0) };
        if ptr.is_null() {
            return Err(DecodeError::LibRaw("libraw_init returned null".to_owned()));
        }
        Ok(Self { ptr })
    }
}

impl Drop for RawHandle {
    fn drop(&mut self) {
        unsafe { sys::libraw_close(self.ptr) };
    }
}

struct ProcessedImage {
    ptr: *mut sys::libraw_processed_image_t,
}

impl Drop for ProcessedImage {
    fn drop(&mut self) {
        unsafe { sys::libraw_dcraw_clear_mem(self.ptr) };
    }
}

fn libraw_message(code: i32) -> String {
    let ptr = unsafe { sys::libraw_strerror(code) };
    if ptr.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned()
}

fn check_rc(code: i32, context: &str) -> Result<(), DecodeError> {
    if code == sys::LibRaw_errors_LIBRAW_SUCCESS {
        Ok(())
    } else {
        Err(DecodeError::LibRaw(format!("{context}: {}", libraw_message(code))))
    }
}

fn check_cancel(cancel: &CancelFlag) -> Result<(), DecodeError> {
    if cancel.load(Ordering::Relaxed) {
        Err(DecodeError::Cancelled)
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn path_to_c(path: &Path) -> Result<CString, DecodeError> {
    use std::os::unix::ffi::OsStrExt;
    CString::new(path.as_os_str().as_bytes()).map_err(|_| DecodeError::LibRaw("path contains interior NUL".to_owned()))
}

#[cfg(not(unix))]
fn path_to_c(path: &Path) -> Result<CString, DecodeError> {
    let text = path.to_str().ok_or_else(|| DecodeError::LibRaw("path is not valid UTF-8".to_owned()))?;
    CString::new(text).map_err(|_| DecodeError::LibRaw("path contains interior NUL".to_owned()))
}

fn normalize_flip(flip: i32) -> u8 {
    match flip.rem_euclid(360) {
        270 => 5,
        180 => 3,
        90 => 6,
        other => other as u8,
    }
}

fn matrix_from_color(color: &sys::libraw_colordata_t) -> Option<[f32; 9]> {
    let cam_xyz = [
        [color.cam_xyz[0][0], color.cam_xyz[0][1], color.cam_xyz[0][2]],
        [color.cam_xyz[1][0], color.cam_xyz[1][1], color.cam_xyz[1][2]],
        [color.cam_xyz[2][0], color.cam_xyz[2][1], color.cam_xyz[2][2]],
    ];
    if cam_xyz.iter().any(|row| row.iter().any(|&value| value != 0.0)) {
        if let Some(matrix) = crate::color::cam_to_rec2020(&cam_xyz) {
            return Some(matrix);
        }
    }
    let rgb_cam = [
        [color.rgb_cam[0][0], color.rgb_cam[0][1], color.rgb_cam[0][2]],
        [color.rgb_cam[1][0], color.rgb_cam[1][1], color.rgb_cam[1][2]],
        [color.rgb_cam[2][0], color.rgb_cam[2][1], color.rgb_cam[2][2]],
    ];
    if rgb_cam.iter().any(|row| row.iter().any(|&value| value != 0.0)) {
        return crate::color::rec2020_from_rgb_cam(&rgb_cam);
    }
    None
}

fn downsample_half(rgb: &[f16], width: usize, height: usize) -> (usize, usize, Vec<f16>) {
    let out_width = width / 2;
    let out_height = height / 2;
    let mut out = Vec::with_capacity(out_width * out_height * 3);
    for oy in 0..out_height {
        for ox in 0..out_width {
            let (x0, y0) = (ox * 2, oy * 2);
            for channel in 0..3 {
                let at = |x: usize, y: usize| rgb[(y * width + x) * 3 + channel].to_f32();
                let sum = at(x0, y0) + at(x0 + 1, y0) + at(x0, y0 + 1) + at(x0 + 1, y0 + 1);
                out.push(f16::from_f32(sum * 0.25));
            }
        }
    }
    (out_width, out_height, out)
}

fn largest_jpeg_thumb_index(list: &sys::libraw_thumbnail_list_t) -> Option<i32> {
    let count = (list.thumbcount.max(0) as usize).min(list.thumblist.len());
    let mut best: Option<(i32, u32)> = None;
    for index in 0..count {
        let item = &list.thumblist[index];
        if item.tformat == sys::LibRaw_internal_thumbnail_formats_LIBRAW_INTERNAL_THUMBNAIL_JPEG {
            let area = item.twidth as u32 * item.theight as u32;
            if best.is_none_or(|(_, best_area)| area > best_area) {
                best = Some((index as i32, area));
            }
        }
    }
    best.map(|(index, _)| index)
}

pub fn extract_thumb(path: &Path) -> Result<ThumbData, DecodeError> {
    guarded(|| {
        let handle = RawHandle::new()?;
        let c_path = path_to_c(path)?;
        check_rc(unsafe { sys::libraw_open_file(handle.ptr, c_path.as_ptr()) }, "libraw_open_file")?;

        check_rc(unsafe { sys::libraw_unpack_thumb(handle.ptr) }, "libraw_unpack_thumb")?;
        if unsafe { (*handle.ptr).thumbnail.tformat } != sys::LibRaw_thumbnail_formats_LIBRAW_THUMBNAIL_JPEG {
            let fallback = largest_jpeg_thumb_index(unsafe { &(*handle.ptr).thumbs_list })
                .ok_or_else(|| DecodeError::LibRaw(format!("no JPEG thumbnail (default tformat={})", unsafe { (*handle.ptr).thumbnail.tformat })))?;
            check_rc(unsafe { sys::libraw_unpack_thumb_ex(handle.ptr, fallback) }, "libraw_unpack_thumb_ex")?;
        }

        let thumbnail = unsafe { &(*handle.ptr).thumbnail };
        if thumbnail.tformat != sys::LibRaw_thumbnail_formats_LIBRAW_THUMBNAIL_JPEG {
            return Err(DecodeError::LibRaw(format!("thumbnail is not JPEG (tformat={})", thumbnail.tformat)));
        }
        if thumbnail.thumb.is_null() || thumbnail.tlength == 0 {
            return Err(DecodeError::LibRaw("thumbnail payload is empty".to_owned()));
        }
        let jpeg = unsafe { std::slice::from_raw_parts(thumbnail.thumb as *const u8, thumbnail.tlength as usize) }.to_vec();
        Ok(ThumbData {
            jpeg,
            width: thumbnail.twidth as u32,
            height: thumbnail.theight as u32,
        })
    })
}

pub fn decode(path: &Path, level: DecodeLevel, cancel: &CancelFlag) -> Result<DecodedRaw, DecodeError> {
    guarded(move || {
        check_cancel(cancel)?;
        let handle = RawHandle::new()?;
        let c_path = path_to_c(path)?;
        check_rc(unsafe { sys::libraw_open_file(handle.ptr, c_path.as_ptr()) }, "libraw_open_file")?;
        check_cancel(cancel)?;

        let (filters, source_colors) = {
            let idata = unsafe { &(*handle.ptr).idata };
            (idata.filters, idata.colors)
        };
        let is_xtrans = filters == 9;
        let is_monochrome = source_colors == 1;
        let camera_flip = normalize_flip(unsafe { (*handle.ptr).sizes.flip });

        {
            let params = unsafe { &mut (*handle.ptr).params };
            params.output_color = 0;
            params.output_bps = 16;
            params.no_auto_bright = 1;
            params.use_camera_wb = if is_monochrome { 0 } else { 1 };
            params.gamm[0] = 1.0;
            params.gamm[1] = 1.0;
            params.four_color_rgb = 0;
            params.highlight = 0;
            // SPEC-GAP: PRD §3.8 says sizes.flip is not auto-applied, but libraw_dcraw_make_mem_image (copy_mem_image) physically rotates pixels via flip_index; user_flip=0 keeps the buffer native and camera_flip is handed to the frontend vertex shader (PRD §3.4 pass ②) to avoid a double rotation.
            params.user_flip = 0;
            match level {
                DecodeLevel::Half => {
                    if is_xtrans {
                        params.half_size = 0;
                        params.user_qual = 3;
                    } else {
                        params.half_size = 1;
                        params.user_qual = 0;
                    }
                }
                DecodeLevel::Full => {
                    params.half_size = 0;
                    // SPEC-GAP: PRD §3.3 maps X-Trans L2 to Markesteijn 3-pass (user_qual=4); Phase 1 R1 uses 1-pass (3) for both X-Trans levels per the frozen contract (faster, LGPL-safe base LibRaw).
                    params.user_qual = 3;
                }
            }
        }

        check_rc(unsafe { sys::libraw_unpack(handle.ptr) }, "libraw_unpack")?;
        check_cancel(cancel)?;
        check_rc(unsafe { sys::libraw_dcraw_process(handle.ptr) }, "libraw_dcraw_process")?;
        check_cancel(cancel)?;

        let mut errc: i32 = 0;
        let image_ptr = unsafe { sys::libraw_dcraw_make_mem_image(handle.ptr, &mut errc) };
        if image_ptr.is_null() {
            return Err(DecodeError::LibRaw(format!("libraw_dcraw_make_mem_image: {}", libraw_message(errc))));
        }
        let processed = ProcessedImage { ptr: image_ptr };
        let image = unsafe { &*processed.ptr };

        if image.type_ != sys::LibRaw_image_formats_LIBRAW_IMAGE_BITMAP {
            return Err(DecodeError::LibRaw(format!("unexpected processed image type {}", image.type_)));
        }
        if image.bits != 16 {
            return Err(DecodeError::LibRaw(format!("unexpected processed image bits {}", image.bits)));
        }
        let out_colors = image.colors as usize;
        if out_colors != 3 && out_colors != 1 {
            return Err(DecodeError::LibRaw(format!("unexpected processed image colors {}", image.colors)));
        }
        let width = image.width as usize;
        let height = image.height as usize;
        let sample_count = image.data_size as usize / 2;
        if width == 0 || height == 0 || sample_count != width * height * out_colors {
            return Err(DecodeError::LibRaw("processed image dimensions are inconsistent".to_owned()));
        }
        check_cancel(cancel)?;

        let samples = unsafe { std::slice::from_raw_parts(image.data.as_ptr() as *const u16, sample_count) };
        let mut rgb_f16 = Vec::with_capacity(width * height * 3);
        if out_colors == 3 {
            for &sample in samples {
                rgb_f16.push(f16::from_f32(sample as f32 / 65535.0));
            }
        } else {
            for &sample in samples {
                let value = f16::from_f32(sample as f32 / 65535.0);
                rgb_f16.push(value);
                rgb_f16.push(value);
                rgb_f16.push(value);
            }
        }

        let (mut out_width, mut out_height) = (width, height);
        if is_xtrans && matches!(level, DecodeLevel::Half) {
            let (dw, dh, downsampled) = downsample_half(&rgb_f16, width, height);
            out_width = dw;
            out_height = dh;
            rgb_f16 = downsampled;
        }
        check_cancel(cancel)?;

        let cam_to_rec2020 = matrix_from_color(unsafe { &(*handle.ptr).color });
        tracing::debug!(width = out_width, height = out_height, has_matrix = cam_to_rec2020.is_some(), flip = camera_flip, "decoded raw");

        Ok(DecodedRaw {
            width: out_width as u32,
            height: out_height as u32,
            rgb_f16,
            cam_to_rec2020,
            flip: camera_flip,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_reports_0_21_series() {
        let reported = version();
        assert!(reported.starts_with("0.21"), "unexpected libraw version: {reported}");
    }

    #[test]
    fn probe_initializes_and_closes() {
        assert!(probe().is_ok());
    }

    #[test]
    fn normalize_flip_maps_degrees_and_codes() {
        assert_eq!(normalize_flip(0), 0);
        assert_eq!(normalize_flip(3), 3);
        assert_eq!(normalize_flip(5), 5);
        assert_eq!(normalize_flip(6), 6);
        assert_eq!(normalize_flip(90), 6);
        assert_eq!(normalize_flip(180), 3);
        assert_eq!(normalize_flip(270), 5);
    }
}
