use std::io::Cursor;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::OnceLock;

use half::f16;
use image::imageops::FilterType;
use image::DynamicImage;

use super::{CancelFlag, DecodeError, DecodedRaw, ThumbData};
use crate::color;

const IMAGE_CRATE_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "gif"];
const PLATFORM_EXTS: &[&str] = &["heic", "heif", "avif"];
const THUMB_MAX_EDGE: u32 = 512;
const THUMB_JPEG_QUALITY: u8 = 85;

fn ext_lower(path: &Path) -> Option<String> {
    path.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase())
}

fn is_platform_ext(path: &Path) -> bool {
    ext_lower(path).is_some_and(|ext| PLATFORM_EXTS.contains(&ext.as_str()))
}

pub fn is_common_path(path: &Path) -> bool {
    ext_lower(path).is_some_and(|ext| IMAGE_CRATE_EXTS.contains(&ext.as_str()) || PLATFORM_EXTS.contains(&ext.as_str()))
}

fn check_cancel(cancel: &CancelFlag) -> Result<(), DecodeError> {
    if cancel.load(Ordering::Relaxed) {
        Err(DecodeError::Cancelled)
    } else {
        Ok(())
    }
}

fn srgb_u8_to_linear() -> &'static [f32; 256] {
    static LUT: OnceLock<[f32; 256]> = OnceLock::new();
    LUT.get_or_init(|| {
        let mut table = [0.0f32; 256];
        for (index, slot) in table.iter_mut().enumerate() {
            *slot = color::srgb_eotf(index as f32 / 255.0);
        }
        table
    })
}

fn exif_flip(path: &Path) -> u8 {
    let Ok(file) = std::fs::File::open(path) else { return 0 };
    let mut reader = std::io::BufReader::new(file);
    let Ok(parsed) = exif::Reader::new().read_from_container(&mut reader) else { return 0 };
    let orientation = parsed
        .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|field| field.value.get_uint(0));
    match orientation {
        Some(3 | 4) => 3,
        Some(5 | 8) => 5,
        Some(6 | 7) => 6,
        _ => 0,
    }
}

struct LinearPixels {
    width: u32,
    height: u32,
    rgb_linear: Vec<f16>,
    rec2020_matrix: [f32; 9],
}

const IDENTITY_MATRIX: [f32; 9] = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];

fn icc_is_srgb(icc: &[u8]) -> bool {
    let Ok(profile) = lcms2::Profile::new_icc(icc) else { return false };
    profile
        .info(lcms2::InfoType::Description, lcms2::Locale::none())
        .is_some_and(|description| description.to_ascii_lowercase().contains("srgb"))
}

fn linearize_with_icc_u8(width: u32, height: u32, rgba: &[u8], icc: &[u8]) -> Option<LinearPixels> {
    let source = lcms2::Profile::new_icc(icc).ok()?;
    let dest = crate::color::display_lut::rec2020_linear_profile()?;
    let transform: lcms2::Transform<[u8; 3], [f32; 3]> =
        lcms2::Transform::new(&source, lcms2::PixelFormat::RGB_8, &dest, lcms2::PixelFormat::RGB_FLT, lcms2::Intent::RelativeColorimetric).ok()?;
    let pixel_count = width as usize * height as usize;
    let mut rgb_input = Vec::with_capacity(pixel_count);
    let mut alphas = Vec::with_capacity(pixel_count);
    for pixel in rgba.chunks_exact(4) {
        rgb_input.push([pixel[0], pixel[1], pixel[2]]);
        alphas.push(pixel[3] as f32 / 255.0);
    }
    let mut rgb_output = vec![[0.0f32; 3]; pixel_count];
    transform.transform_pixels(&rgb_input, &mut rgb_output);
    let mut rgb_linear = Vec::with_capacity(pixel_count * 3);
    for (pixel, alpha) in rgb_output.iter().zip(alphas) {
        rgb_linear.push(f16::from_f32(pixel[0] * alpha));
        rgb_linear.push(f16::from_f32(pixel[1] * alpha));
        rgb_linear.push(f16::from_f32(pixel[2] * alpha));
    }
    Some(LinearPixels {
        width,
        height,
        rgb_linear,
        rec2020_matrix: IDENTITY_MATRIX,
    })
}

fn linearize_with_icc_u16(width: u32, height: u32, rgba: &[u16], icc: &[u8]) -> Option<LinearPixels> {
    let source = lcms2::Profile::new_icc(icc).ok()?;
    let dest = crate::color::display_lut::rec2020_linear_profile()?;
    let transform: lcms2::Transform<[u16; 3], [f32; 3]> =
        lcms2::Transform::new(&source, lcms2::PixelFormat::RGB_16, &dest, lcms2::PixelFormat::RGB_FLT, lcms2::Intent::RelativeColorimetric).ok()?;
    let pixel_count = width as usize * height as usize;
    let mut rgb_input = Vec::with_capacity(pixel_count);
    let mut alphas = Vec::with_capacity(pixel_count);
    for pixel in rgba.chunks_exact(4) {
        rgb_input.push([pixel[0], pixel[1], pixel[2]]);
        alphas.push(pixel[3] as f32 / 65535.0);
    }
    let mut rgb_output = vec![[0.0f32; 3]; pixel_count];
    transform.transform_pixels(&rgb_input, &mut rgb_output);
    let mut rgb_linear = Vec::with_capacity(pixel_count * 3);
    for (pixel, alpha) in rgb_output.iter().zip(alphas) {
        rgb_linear.push(f16::from_f32(pixel[0] * alpha));
        rgb_linear.push(f16::from_f32(pixel[1] * alpha));
        rgb_linear.push(f16::from_f32(pixel[2] * alpha));
    }
    Some(LinearPixels {
        width,
        height,
        rgb_linear,
        rec2020_matrix: IDENTITY_MATRIX,
    })
}

fn linearize_rgba8(width: u32, height: u32, rgba: &[u8]) -> LinearPixels {
    let lut = srgb_u8_to_linear();
    let pixel_count = width as usize * height as usize;
    let mut rgb_linear = Vec::with_capacity(pixel_count * 3);
    for pixel in rgba.chunks_exact(4) {
        let alpha = pixel[3] as f32 / 255.0;
        rgb_linear.push(f16::from_f32(lut[pixel[0] as usize] * alpha));
        rgb_linear.push(f16::from_f32(lut[pixel[1] as usize] * alpha));
        rgb_linear.push(f16::from_f32(lut[pixel[2] as usize] * alpha));
    }
    LinearPixels {
        width,
        height,
        rgb_linear,
        rec2020_matrix: color::rec2020_from_srgb_linear_matrix(),
    }
}

fn linearize_premultiplied_rgba8(width: u32, height: u32, rgba: &[u8]) -> LinearPixels {
    let lut = srgb_u8_to_linear();
    let pixel_count = width as usize * height as usize;
    let mut rgb_linear = Vec::with_capacity(pixel_count * 3);
    for pixel in rgba.chunks_exact(4) {
        rgb_linear.push(f16::from_f32(lut[pixel[0] as usize]));
        rgb_linear.push(f16::from_f32(lut[pixel[1] as usize]));
        rgb_linear.push(f16::from_f32(lut[pixel[2] as usize]));
    }
    LinearPixels {
        width,
        height,
        rgb_linear,
        rec2020_matrix: color::rec2020_from_srgb_linear_matrix(),
    }
}

fn linearize_rgba16(width: u32, height: u32, rgba: &[u16]) -> LinearPixels {
    let pixel_count = width as usize * height as usize;
    let mut rgb_linear = Vec::with_capacity(pixel_count * 3);
    for pixel in rgba.chunks_exact(4) {
        let alpha = pixel[3] as f32 / 65535.0;
        rgb_linear.push(f16::from_f32(color::srgb_eotf(pixel[0] as f32 / 65535.0) * alpha));
        rgb_linear.push(f16::from_f32(color::srgb_eotf(pixel[1] as f32 / 65535.0) * alpha));
        rgb_linear.push(f16::from_f32(color::srgb_eotf(pixel[2] as f32 / 65535.0) * alpha));
    }
    LinearPixels {
        width,
        height,
        rgb_linear,
        rec2020_matrix: color::rec2020_from_srgb_linear_matrix(),
    }
}

fn is_deep_color(image: &DynamicImage) -> bool {
    matches!(
        image,
        DynamicImage::ImageLuma16(_) | DynamicImage::ImageLumaA16(_) | DynamicImage::ImageRgb16(_) | DynamicImage::ImageRgba16(_)
    )
}

fn load_image_crate(bytes: &[u8]) -> Result<DynamicImage, DecodeError> {
    image::load_from_memory(bytes).map_err(|error| DecodeError::Image(error.to_string()))
}

fn load_image_with_icc(bytes: &[u8]) -> Result<(DynamicImage, Option<Vec<u8>>), DecodeError> {
    let reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| DecodeError::Image(error.to_string()))?;
    let mut decoder = reader.into_decoder().map_err(|error| DecodeError::Image(error.to_string()))?;
    let icc = image::ImageDecoder::icc_profile(&mut decoder).ok().flatten();
    let image = DynamicImage::from_decoder(decoder).map_err(|error| DecodeError::Image(error.to_string()))?;
    Ok((image, icc))
}

fn linearize_image(image: &DynamicImage, icc: Option<&[u8]>) -> LinearPixels {
    let embedded = icc.filter(|profile| !icc_is_srgb(profile));
    if is_deep_color(image) {
        let rgba = image.to_rgba16();
        if let Some(profile) = embedded {
            if let Some(pixels) = linearize_with_icc_u16(rgba.width(), rgba.height(), rgba.as_raw(), profile) {
                return pixels;
            }
            tracing::warn!("embedded ICC transform failed (16bpc); falling back to sRGB assumption");
        }
        linearize_rgba16(rgba.width(), rgba.height(), rgba.as_raw())
    } else {
        let rgba = image.to_rgba8();
        if let Some(profile) = embedded {
            if let Some(pixels) = linearize_with_icc_u8(rgba.width(), rgba.height(), rgba.as_raw(), profile) {
                return pixels;
            }
            tracing::warn!("embedded ICC transform failed (8bpc); falling back to sRGB assumption");
        }
        linearize_rgba8(rgba.width(), rgba.height(), rgba.as_raw())
    }
}

fn decode_pixels(path: &Path, cancel: &CancelFlag) -> Result<(LinearPixels, u8), DecodeError> {
    let bytes = std::fs::read(path).map_err(|error| DecodeError::Image(error.to_string()))?;
    check_cancel(cancel)?;
    if is_platform_ext(path) {
        let decoded = platform_decode(&bytes, None)?;
        check_cancel(cancel)?;
        let pixels = linearize_premultiplied_rgba8(decoded.width, decoded.height, &decoded.rgba);
        return Ok((pixels, 0));
    }
    let (image, icc) = load_image_with_icc(&bytes)?;
    check_cancel(cancel)?;
    let pixels = linearize_image(&image, icc.as_deref());
    Ok((pixels, exif_flip(path)))
}

#[cfg(target_os = "macos")]
fn platform_decode(bytes: &[u8], max_pixel_size: Option<u32>) -> Result<crate::platform::DecodedImage, DecodeError> {
    crate::platform::macos::imageio::decode_to_srgb_rgba(bytes, max_pixel_size).map_err(|error| DecodeError::Image(error.to_string()))
}

#[cfg(not(target_os = "macos"))]
fn platform_decode(_bytes: &[u8], _max_pixel_size: Option<u32>) -> Result<crate::platform::DecodedImage, DecodeError> {
    Err(DecodeError::Image("HEIC/HEIF/AVIF decoding requires a platform decoder".into()))
}

pub fn decode_common(path: &Path, half: bool, cancel: &CancelFlag) -> Result<DecodedRaw, DecodeError> {
    let (pixels, flip) = decode_pixels(path, cancel)?;
    check_cancel(cancel)?;
    let matrix = pixels.rec2020_matrix;
    let (width, height, rgb_f16) = if half && pixels.width >= 2 && pixels.height >= 2 {
        let (w, h, data) = super::libraw_ffi::downsample_half(&pixels.rgb_linear, pixels.width as usize, pixels.height as usize);
        (w as u32, h as u32, data)
    } else {
        (pixels.width, pixels.height, pixels.rgb_linear)
    };
    Ok(DecodedRaw {
        width,
        height,
        rgb_f16,
        cam_to_rec2020: Some(matrix),
        flip,
    })
}

fn oriented_thumbnail(image: &DynamicImage, flip: u8) -> DynamicImage {
    let thumb = if image.width().max(image.height()) > THUMB_MAX_EDGE {
        image.resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, FilterType::Triangle)
    } else {
        image.clone()
    };
    match flip {
        3 => thumb.rotate180(),
        5 => thumb.rotate270(),
        6 => thumb.rotate90(),
        _ => thumb,
    }
}

fn encode_thumb_jpeg(image: &DynamicImage) -> Result<ThumbData, DecodeError> {
    let rgb = image.to_rgb8();
    let (width, height) = (rgb.width(), rgb.height());
    let mut jpeg = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(Cursor::new(&mut jpeg), THUMB_JPEG_QUALITY);
    rgb.write_with_encoder(encoder).map_err(|error| DecodeError::Image(error.to_string()))?;
    Ok(ThumbData { jpeg, width, height })
}

const EXIF_THUMB_MIN_EDGE: u32 = 256;

fn embedded_exif_thumbnail(bytes: &[u8], flip: u8) -> Option<ThumbData> {
    let parsed = exif::Reader::new().read_from_container(&mut Cursor::new(bytes)).ok()?;
    let offset = parsed
        .get_field(exif::Tag::JPEGInterchangeFormat, exif::In::THUMBNAIL)?
        .value
        .get_uint(0)? as usize;
    let length = parsed
        .get_field(exif::Tag::JPEGInterchangeFormatLength, exif::In::THUMBNAIL)?
        .value
        .get_uint(0)? as usize;
    let jpeg = parsed.buf().get(offset..offset.checked_add(length)?)?;
    let thumb = image::load_from_memory_with_format(jpeg, image::ImageFormat::Jpeg).ok()?;
    if thumb.width().max(thumb.height()) < EXIF_THUMB_MIN_EDGE {
        return None;
    }
    encode_thumb_jpeg(&oriented_thumbnail(&thumb, flip)).ok()
}

pub fn extract_common_thumb(path: &Path) -> Result<ThumbData, DecodeError> {
    let bytes = std::fs::read(path).map_err(|error| DecodeError::Image(error.to_string()))?;
    let ext_is_jpeg = ext_lower(path).is_some_and(|ext| ext == "jpg" || ext == "jpeg");
    if ext_is_jpeg {
        if let Some(thumb) = embedded_exif_thumbnail(&bytes, exif_flip(path)) {
            return Ok(thumb);
        }
    }
    if is_platform_ext(path) {
        let decoded = platform_decode(&bytes, Some(THUMB_MAX_EDGE))?;
        let rgba = image::RgbaImage::from_raw(decoded.width, decoded.height, decoded.rgba)
            .ok_or_else(|| DecodeError::Image("imageio thumbnail buffer size mismatch".into()))?;
        return encode_thumb_jpeg(&DynamicImage::ImageRgba8(rgba));
    }
    let image = load_image_crate(&bytes)?;
    encode_thumb_jpeg(&oriented_thumbnail(&image, exif_flip(path)))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    use super::*;

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("raw-viewer-common-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    fn write_png(path: &Path, width: u32, height: u32, rgba: [u8; 4]) {
        let image = image::RgbaImage::from_pixel(width, height, image::Rgba(rgba));
        image.save(path).expect("png write");
    }

    fn no_cancel() -> CancelFlag {
        Arc::new(AtomicBool::new(false))
    }

    #[test]
    fn png_mid_gray_linearizes_with_srgb_eotf() {
        let path = temp_dir().join("mid-gray.png");
        write_png(&path, 4, 4, [128, 128, 128, 255]);
        let decoded = decode_common(&path, false, &no_cancel()).expect("decode");
        assert_eq!((decoded.width, decoded.height), (4, 4));
        assert_eq!(decoded.flip, 0);
        let expected = color::srgb_eotf(128.0 / 255.0);
        let sample = decoded.rgb_f16[0].to_f32();
        assert!((sample - expected).abs() < 1e-3, "expected {expected}, got {sample}");
        let matrix = decoded.cam_to_rec2020.expect("srgb matrix present");
        assert!((matrix[0] - color::rec2020_from_srgb_linear_matrix()[0]).abs() < 1e-6);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn half_level_downsamples_dimensions() {
        let path = temp_dir().join("half.png");
        write_png(&path, 8, 6, [200, 10, 30, 255]);
        let decoded = decode_common(&path, true, &no_cancel()).expect("decode");
        assert_eq!((decoded.width, decoded.height), (4, 3));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn alpha_composites_over_black() {
        let path = temp_dir().join("alpha.png");
        write_png(&path, 2, 2, [255, 255, 255, 128]);
        let decoded = decode_common(&path, false, &no_cancel()).expect("decode");
        let expected = 128.0 / 255.0;
        let sample = decoded.rgb_f16[0].to_f32();
        assert!((sample - expected).abs() < 5e-3, "expected {expected}, got {sample}");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn jpeg_orientation_maps_to_libraw_flip() {
        let path = temp_dir().join("oriented.jpg");
        let image = image::RgbImage::from_pixel(6, 4, image::Rgb([90, 90, 90]));
        image.save(&path).expect("jpeg write");
        let mut metadata = little_exif::metadata::Metadata::new();
        metadata.set_tag(little_exif::exif_tag::ExifTag::Orientation(vec![6]));
        metadata.write_to_file(&path).expect("exif write");
        assert_eq!(exif_flip(&path), 6);
        let decoded = decode_common(&path, false, &no_cancel()).expect("decode");
        assert_eq!(decoded.flip, 6);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn thumbnail_fits_max_edge_and_encodes_jpeg() {
        let path = temp_dir().join("thumb.png");
        write_png(&path, 1024, 512, [10, 200, 40, 255]);
        let thumb = extract_common_thumb(&path).expect("thumb");
        assert!(thumb.width <= THUMB_MAX_EDGE && thumb.height <= THUMB_MAX_EDGE);
        assert_eq!((thumb.width, thumb.height), (512, 256));
        assert_eq!(&thumb.jpeg[0..2], &[0xFF, 0xD8]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn webp_decodes() {
        let path = temp_dir().join("sample.webp");
        let image = image::RgbaImage::from_pixel(10, 8, image::Rgba([50, 100, 150, 255]));
        image.save(&path).expect("webp write");
        let decoded = decode_common(&path, false, &no_cancel()).expect("decode");
        assert_eq!((decoded.width, decoded.height), (10, 8));
        let _ = std::fs::remove_file(&path);
    }

    fn linear_profile_icc(red: (f64, f64), green: (f64, f64), blue: (f64, f64)) -> Vec<u8> {
        let white = lcms2::CIExyY { x: 0.312_7, y: 0.329_0, Y: 1.0 };
        let prims = lcms2::CIExyYTRIPLE {
            Red: lcms2::CIExyY { x: red.0, y: red.1, Y: 1.0 },
            Green: lcms2::CIExyY { x: green.0, y: green.1, Y: 1.0 },
            Blue: lcms2::CIExyY { x: blue.0, y: blue.1, Y: 1.0 },
        };
        let linear = lcms2::ToneCurve::new(1.0);
        lcms2::Profile::new_rgb(&white, &prims, &[&linear, &linear, &linear])
            .expect("profile")
            .icc()
            .expect("icc bytes")
    }

    fn write_png_with_icc(path: &Path, rgba: [u8; 4], icc: Vec<u8>) {
        let image = image::RgbaImage::from_pixel(4, 4, image::Rgba(rgba));
        let file = std::fs::File::create(path).expect("create");
        let mut encoder = image::codecs::png::PngEncoder::new(std::io::BufWriter::new(file));
        image::ImageEncoder::set_icc_profile(&mut encoder, icc).expect("icc supported");
        image
            .write_with_encoder(encoder)
            .expect("png with icc");
    }

    #[test]
    fn embedded_rec2020_linear_icc_bypasses_srgb_assumption() {
        let path = temp_dir().join("icc-rec2020.png");
        let icc = linear_profile_icc((0.708, 0.292), (0.170, 0.797), (0.131, 0.046));
        write_png_with_icc(&path, [128, 128, 128, 255], icc);
        let decoded = decode_common(&path, false, &no_cancel()).expect("decode");
        let expected = 128.0 / 255.0;
        let sample = decoded.rgb_f16[0].to_f32();
        assert!((sample - expected).abs() < 2e-2, "expected linear {expected}, got {sample}");
        let matrix = decoded.cam_to_rec2020.expect("matrix");
        assert!((matrix[0] - 1.0).abs() < 1e-6 && matrix[1].abs() < 1e-6, "identity matrix expected, got {matrix:?}");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn embedded_p3_icc_red_exceeds_srgb_assumption() {
        let path = temp_dir().join("icc-p3.png");
        let icc = linear_profile_icc((0.680, 0.320), (0.265, 0.690), (0.150, 0.060));
        write_png_with_icc(&path, [255, 0, 0, 255], icc);
        let decoded = decode_common(&path, false, &no_cancel()).expect("decode");
        let red = decoded.rgb_f16[0].to_f32();
        assert!(red > 0.70, "P3 red in Rec2020 should exceed sRGB-assumed 0.627, got {red}");
        let matrix = decoded.cam_to_rec2020.expect("matrix");
        assert!((matrix[0] - 1.0).abs() < 1e-6, "identity matrix expected under ICC path");
        let _ = std::fs::remove_file(&path);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn imageio_decodes_heic_via_sips() {
        let dir = temp_dir();
        let png = dir.join("imageio-src.png");
        write_png(&png, 12, 10, [30, 60, 90, 255]);
        let heic = dir.join("imageio-src.heic");
        let converted = std::process::Command::new("sips")
            .args(["-s", "format", "heic", png.to_str().unwrap(), "--out", heic.to_str().unwrap()])
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false);
        if !converted {
            eprintln!("[skip] sips heic conversion unavailable");
            return;
        }
        let decoded = decode_common(&heic, false, &no_cancel()).expect("heic decode");
        assert_eq!((decoded.width, decoded.height), (12, 10));
        let thumb = extract_common_thumb(&heic).expect("heic thumb");
        assert_eq!((thumb.width, thumb.height), (12, 10));
        let _ = std::fs::remove_file(&png);
        let _ = std::fs::remove_file(&heic);
    }
}

#[cfg(test)]
mod exif_thumb_tests {
    use super::*;

    #[test]
    fn plain_jpeg_without_exif_thumbnail_falls_back() {
        let image = image::RgbImage::from_pixel(600, 400, image::Rgb([10, 20, 30]));
        let mut bytes = Vec::new();
        image
            .write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::Cursor::new(&mut bytes), 90))
            .expect("encode");
        assert!(embedded_exif_thumbnail(&bytes, 0).is_none());
        let dir = std::env::temp_dir().join(format!("raw-viewer-exifthumb-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("plain.jpg");
        let _ = std::fs::write(&path, &bytes);
        let thumb = extract_common_thumb(&path).expect("fallback thumb");
        assert_eq!((thumb.width, thumb.height), (512, 341));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
