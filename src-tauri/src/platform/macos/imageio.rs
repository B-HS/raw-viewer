use std::ffi::c_void;
use std::ptr::NonNull;

use objc2_core_foundation::{CFBoolean, CFData, CFDictionary, CFNumber, CFRetained, CFString, CFType, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    kCGColorSpaceSRGB, CGBitmapContextCreate, CGBitmapContextGetData, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo,
};
use objc2_image_io::{
    kCGImageSourceCreateThumbnailFromImageAlways, kCGImageSourceCreateThumbnailWithTransform, kCGImageSourceShouldCache,
    kCGImageSourceThumbnailMaxPixelSize, CGImageSource,
};

use crate::error::{AppError, AppResult};
use crate::platform::DecodedImage;

const RGBA_CHANNELS: usize = 4;

fn thumbnail_options(max_pixel_size: u32) -> AppResult<CFRetained<CFDictionary>> {
    let max = CFNumber::new_i64(i64::from(max_pixel_size));
    let yes: &CFBoolean = unsafe { objc2_core_foundation::kCFBooleanTrue }.ok_or_else(|| AppError::Decode("kCFBooleanTrue unavailable".into()))?;
    let keys: [&CFString; 4] = unsafe {
        [
            kCGImageSourceCreateThumbnailWithTransform,
            kCGImageSourceCreateThumbnailFromImageAlways,
            kCGImageSourceThumbnailMaxPixelSize,
            kCGImageSourceShouldCache,
        ]
    };
    let values: [&CFType; 4] = [yes.as_ref(), yes.as_ref(), max.as_ref(), yes.as_ref()];
    let keys_ptr: [*const c_void; 4] = keys.map(|key| key as *const CFString as *const c_void);
    let values_ptr: [*const c_void; 4] = values.map(|value| value as *const CFType as *const c_void);
    let dictionary = unsafe {
        CFDictionary::new(
            None,
            keys_ptr.as_ptr() as *mut *const c_void,
            values_ptr.as_ptr() as *mut *const c_void,
            keys.len() as isize,
            &objc2_core_foundation::kCFTypeDictionaryKeyCallBacks,
            &objc2_core_foundation::kCFTypeDictionaryValueCallBacks,
        )
    };
    dictionary.ok_or_else(|| AppError::Decode("CFDictionaryCreate failed".into()))
}

fn render_to_rgba(image: &CGImage) -> AppResult<DecodedImage> {
    let width = CGImage::width(Some(image));
    let height = CGImage::height(Some(image));
    if width == 0 || height == 0 {
        return Err(AppError::Decode("imageio produced empty image".into()));
    }
    let srgb_name = unsafe { kCGColorSpaceSRGB };
    let srgb = CGColorSpace::with_name(Some(srgb_name)).ok_or_else(|| AppError::Decode("sRGB color space unavailable".into()))?;
    let bytes_per_row = width * RGBA_CHANNELS;
    let context = unsafe {
        CGBitmapContextCreate(
            std::ptr::null_mut(),
            width,
            height,
            8,
            bytes_per_row,
            Some(&srgb),
            CGImageAlphaInfo::PremultipliedLast.0,
        )
    }
    .ok_or_else(|| AppError::Decode("CGBitmapContextCreate failed".into()))?;
    let rect = CGRect {
        origin: CGPoint { x: 0.0, y: 0.0 },
        size: CGSize {
            width: width as f64,
            height: height as f64,
        },
    };
    CGContext::draw_image(Some(&context), rect, Some(image));
    let data = CGBitmapContextGetData(Some(&context));
    let data = NonNull::new(data).ok_or_else(|| AppError::Decode("CGBitmapContextGetData returned null".into()))?;
    let len = bytes_per_row * height;
    let rgba = unsafe { std::slice::from_raw_parts(data.as_ptr() as *const u8, len) }.to_vec();
    Ok(DecodedImage {
        width: width as u32,
        height: height as u32,
        rgba,
    })
}

pub fn decode_to_srgb_rgba(bytes: &[u8], max_pixel_size: Option<u32>) -> AppResult<DecodedImage> {
    let data =
        unsafe { CFData::new(None, bytes.as_ptr(), bytes.len() as isize) }.ok_or_else(|| AppError::Decode("CFData allocation failed".into()))?;
    let source =
        unsafe { CGImageSource::with_data(&data, None) }.ok_or_else(|| AppError::Decode("unsupported image container (imageio)".into()))?;
    let probe = unsafe { source.image_at_index(0, None) }.ok_or_else(|| AppError::Decode("imageio could not decode image".into()))?;
    let full_edge = CGImage::width(Some(&probe)).max(CGImage::height(Some(&probe))) as u32;
    drop(probe);
    let target_edge = max_pixel_size.unwrap_or(full_edge).max(1);
    let options = thumbnail_options(target_edge)?;
    let image =
        unsafe { source.thumbnail_at_index(0, Some(&options)) }.ok_or_else(|| AppError::Decode("imageio thumbnail decode failed".into()))?;
    render_to_rgba(&image)
}
