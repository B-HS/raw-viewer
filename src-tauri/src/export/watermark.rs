use image::imageops::{self, FilterType};
use image::RgbaImage;

use crate::error::{AppError, AppResult};

pub fn decode(bytes: &[u8]) -> AppResult<RgbaImage> {
    let image = image::load_from_memory(bytes).map_err(|error| AppError::Internal(format!("watermark decode failed: {error}")))?;
    Ok(image.to_rgba8())
}

pub fn composite(pixels: &mut [u8], width: u32, height: u32, sixteen: bool, watermark: &RgbaImage) -> AppResult<()> {
    if width == 0 || height == 0 {
        return Ok(());
    }
    let resized;
    let overlay = if watermark.width() == width && watermark.height() == height {
        watermark
    } else {
        resized = imageops::resize(watermark, width, height, FilterType::Triangle);
        &resized
    };
    let bytes_per_channel = if sixteen { 2usize } else { 1usize };
    let required = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(3 * bytes_per_channel))
        .ok_or_else(|| AppError::Internal("watermark canvas dimensions overflow".to_owned()))?;
    if pixels.len() < required {
        return Err(AppError::Internal(format!("watermark canvas too small: have {}, need {required}", pixels.len())));
    }
    for y in 0..height {
        for x in 0..width {
            let sample = overlay.get_pixel(x, y);
            let alpha = f32::from(sample[3]) / 255.0;
            if alpha <= 0.0 {
                continue;
            }
            let base = ((y as usize * width as usize) + x as usize) * 3 * bytes_per_channel;
            if sixteen {
                for channel in 0..3 {
                    let offset = base + channel * 2;
                    let dst = f32::from(u16::from_ne_bytes([pixels[offset], pixels[offset + 1]]));
                    let src = f32::from(sample[channel]) * 257.0;
                    let blended = (src * alpha + dst * (1.0 - alpha)).round().clamp(0.0, 65535.0) as u16;
                    let encoded = blended.to_ne_bytes();
                    pixels[offset] = encoded[0];
                    pixels[offset + 1] = encoded[1];
                }
            } else {
                for channel in 0..3 {
                    let offset = base + channel;
                    let dst = f32::from(pixels[offset]);
                    let src = f32::from(sample[channel]);
                    pixels[offset] = (src * alpha + dst * (1.0 - alpha)).round().clamp(0.0, 255.0) as u8;
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn solid_overlay(width: u32, height: u32, color: Rgba<u8>) -> RgbaImage {
        RgbaImage::from_pixel(width, height, color)
    }

    #[test]
    fn opaque_overlay_replaces_rgb8() {
        let mut pixels = vec![128u8; 2 * 2 * 3];
        let overlay = solid_overlay(2, 2, Rgba([255, 0, 0, 255]));
        let Ok(()) = composite(&mut pixels, 2, 2, false, &overlay) else {
            panic!("composite failed");
        };
        assert_eq!(pixels, vec![255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]);
    }

    #[test]
    fn half_alpha_blends_rgb8() {
        let mut pixels = vec![0u8; 1 * 1 * 3];
        let overlay = solid_overlay(1, 1, Rgba([255, 255, 255, 128]));
        let Ok(()) = composite(&mut pixels, 1, 1, false, &overlay) else {
            panic!("composite failed");
        };
        for channel in &pixels {
            assert!((i32::from(*channel) - 128).abs() <= 1, "blend {channel} off");
        }
    }

    #[test]
    fn transparent_overlay_is_noop() {
        let mut pixels = vec![64u8; 2 * 2 * 3];
        let overlay = solid_overlay(2, 2, Rgba([255, 255, 255, 0]));
        let Ok(()) = composite(&mut pixels, 2, 2, false, &overlay) else {
            panic!("composite failed");
        };
        assert_eq!(pixels, vec![64u8; 2 * 2 * 3]);
    }

    #[test]
    fn opaque_overlay_replaces_rgb16_native_endian() {
        let mut pixels = Vec::new();
        for _ in 0..(2 * 2 * 3) {
            pixels.extend_from_slice(&32_768u16.to_ne_bytes());
        }
        let overlay = solid_overlay(2, 2, Rgba([255, 255, 255, 255]));
        let Ok(()) = composite(&mut pixels, 2, 2, true, &overlay) else {
            panic!("composite failed");
        };
        for chunk in pixels.chunks_exact(2) {
            assert_eq!(u16::from_ne_bytes([chunk[0], chunk[1]]), 65535);
        }
    }

    #[test]
    fn mismatched_overlay_is_resized_to_canvas() {
        let mut pixels = vec![0u8; 4 * 4 * 3];
        let overlay = solid_overlay(1, 1, Rgba([10, 20, 30, 255]));
        let Ok(()) = composite(&mut pixels, 4, 4, false, &overlay) else {
            panic!("composite failed");
        };
        for triple in pixels.chunks_exact(3) {
            assert_eq!(triple, [10, 20, 30]);
        }
    }

    #[test]
    fn short_canvas_errors() {
        let mut pixels = vec![0u8; 5];
        let overlay = solid_overlay(2, 2, Rgba([255, 255, 255, 255]));
        assert!(composite(&mut pixels, 2, 2, false, &overlay).is_err());
    }

    #[test]
    fn decode_rejects_garbage() {
        assert!(decode(&[0u8, 1, 2, 3]).is_err());
    }
}
