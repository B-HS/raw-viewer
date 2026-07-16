use std::io::Cursor;

use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::codecs::tiff::TiffEncoder;
use image::codecs::webp::WebPEncoder;
use image::{ExtendedColorType, ImageEncoder};

use crate::error::{AppError, AppResult};
use crate::types_export::RasterFormat;

fn map_img(error: image::ImageError) -> AppError {
    AppError::Internal(format!("encode failed: {error}"))
}

fn embed_icc<E: ImageEncoder>(encoder: &mut E, icc: Option<Vec<u8>>) -> AppResult<()> {
    if let Some(profile) = icc {
        encoder
            .set_icc_profile(profile)
            .map_err(|error| AppError::Internal(format!("icc embed unsupported: {error}")))?;
    }
    Ok(())
}

pub fn color_type(format: RasterFormat, bits: u8) -> ExtendedColorType {
    match format {
        RasterFormat::Jpeg | RasterFormat::Webp => ExtendedColorType::Rgb8,
        RasterFormat::Png | RasterFormat::Tiff => {
            if bits >= 16 {
                ExtendedColorType::Rgb16
            } else {
                ExtendedColorType::Rgb8
            }
        }
    }
}

pub fn encode(format: RasterFormat, width: u32, height: u32, bits: u8, quality: u8, pixels: &[u8], icc: Option<Vec<u8>>) -> AppResult<Vec<u8>> {
    let color = color_type(format, bits);
    let mut out: Vec<u8> = Vec::new();
    match format {
        RasterFormat::Jpeg => {
            let mut encoder = JpegEncoder::new_with_quality(&mut out, quality.clamp(1, 100));
            embed_icc(&mut encoder, icc)?;
            encoder.write_image(pixels, width, height, ExtendedColorType::Rgb8).map_err(map_img)?;
        }
        RasterFormat::Png => {
            let mut encoder = PngEncoder::new(&mut out);
            embed_icc(&mut encoder, icc)?;
            encoder.write_image(pixels, width, height, color).map_err(map_img)?;
        }
        RasterFormat::Webp => {
            let mut encoder = WebPEncoder::new_lossless(&mut out);
            embed_icc(&mut encoder, icc)?;
            encoder.write_image(pixels, width, height, ExtendedColorType::Rgb8).map_err(map_img)?;
        }
        RasterFormat::Tiff => {
            let mut cursor = Cursor::new(Vec::new());
            let mut encoder = TiffEncoder::new(&mut cursor);
            embed_icc(&mut encoder, icc)?;
            encoder.write_image(pixels, width, height, color).map_err(map_img)?;
            out = cursor.into_inner();
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageDecoder;

    fn solid_rgb8(width: u32, height: u32) -> Vec<u8> {
        vec![128u8; (width as usize) * (height as usize) * 3]
    }

    fn assert_icc_present<D: ImageDecoder>(mut decoder: D, label: &str) {
        match decoder.icc_profile() {
            Ok(Some(profile)) => assert!(profile.len() > 4, "{label} icc empty"),
            other => panic!("{label} icc missing: {other:?}"),
        }
    }

    #[test]
    fn png_embeds_icc_and_roundtrips_dimensions() {
        let icc = crate::export::icc::profile_bytes(crate::types_export::ExportColorSpace::Srgb);
        assert!(icc.is_some());
        let Ok(bytes) = encode(RasterFormat::Png, 4, 3, 8, 90, &solid_rgb8(4, 3), icc) else {
            panic!("png encode failed");
        };
        assert_eq!(&bytes[1..4], b"PNG");
        let Ok(decoder) = image::codecs::png::PngDecoder::new(Cursor::new(&bytes)) else {
            panic!("png decode failed");
        };
        assert_eq!(decoder.dimensions(), (4, 3));
        assert_icc_present(decoder, "png");
    }

    #[test]
    fn jpeg_embeds_icc_and_starts_with_soi() {
        let icc = crate::export::icc::profile_bytes(crate::types_export::ExportColorSpace::DisplayP3);
        let Ok(bytes) = encode(RasterFormat::Jpeg, 8, 8, 8, 92, &solid_rgb8(8, 8), icc) else {
            panic!("jpeg encode failed");
        };
        assert_eq!(&bytes[0..2], &[0xFF, 0xD8]);
        let Ok(decoder) = image::codecs::jpeg::JpegDecoder::new(Cursor::new(&bytes)) else {
            panic!("jpeg decode failed");
        };
        assert_icc_present(decoder, "jpeg");
    }

    #[test]
    fn tiff_embeds_icc() {
        let icc = crate::export::icc::profile_bytes(crate::types_export::ExportColorSpace::AdobeRgb);
        let Ok(bytes) = encode(RasterFormat::Tiff, 4, 4, 16, 90, &[0u8; 4 * 4 * 3 * 2], icc) else {
            panic!("tiff encode failed");
        };
        let Ok(decoder) = image::codecs::tiff::TiffDecoder::new(Cursor::new(bytes)) else {
            panic!("tiff decode failed");
        };
        assert_icc_present(decoder, "tiff");
    }

    #[test]
    fn webp_embeds_icc() {
        let icc = crate::export::icc::profile_bytes(crate::types_export::ExportColorSpace::Srgb);
        let Ok(bytes) = encode(RasterFormat::Webp, 8, 8, 8, 90, &solid_rgb8(8, 8), icc) else {
            panic!("webp encode failed");
        };
        assert_eq!(&bytes[0..4], b"RIFF");
        let Ok(decoder) = image::codecs::webp::WebPDecoder::new(Cursor::new(&bytes)) else {
            panic!("webp decode failed");
        };
        assert_icc_present(decoder, "webp");
    }

    #[test]
    fn png16_encodes_native_endian_input() {
        let Ok(bytes) = encode(RasterFormat::Png, 2, 2, 16, 90, &[0u8; 2 * 2 * 3 * 2], None) else {
            panic!("png16 encode failed");
        };
        let Ok(decoder) = image::codecs::png::PngDecoder::new(Cursor::new(&bytes)) else {
            panic!("png decode failed");
        };
        assert_eq!(decoder.dimensions(), (2, 2));
        assert_eq!(decoder.color_type(), image::ColorType::Rgb16);
    }
}
