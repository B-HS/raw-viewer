pub mod libraw_ffi;

#[cfg(test)]
mod fixtures_test;

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use half::f16;
use thiserror::Error;

use crate::error::AppError;

pub type CancelFlag = Arc<AtomicBool>;

#[derive(Debug, Error)]
pub enum DecodeError {
    #[error("libraw error: {0}")]
    LibRaw(String),
    #[error("decode panicked")]
    Panic,
    #[error("cancelled")]
    Cancelled,
}

impl From<DecodeError> for AppError {
    fn from(error: DecodeError) -> Self {
        AppError::Decode(error.to_string())
    }
}

pub struct ThumbData {
    pub jpeg: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub struct DecodedRaw {
    pub width: u32,
    pub height: u32,
    pub rgb_f16: Vec<f16>,
    pub cam_to_rec2020: Option<[f32; 9]>,
    pub flip: u8,
}

pub fn extract_thumb(path: &Path) -> Result<ThumbData, DecodeError> {
    let file = file_label(path);
    let _span = tracing::info_span!("decode.l0", file = %file).entered();
    libraw_ffi::extract_thumb(path)
}

pub fn probe_iso(path: &Path) -> Option<f32> {
    let file = file_label(path);
    let _span = tracing::info_span!("decode.probe_iso", file = %file).entered();
    libraw_ffi::probe_iso(path)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SensorKind {
    Bayer,
    Xtrans,
    Monochrome,
    Foveon,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Default)]
pub struct ProbeMetadata {
    pub make: Option<String>,
    pub model: Option<String>,
    pub software: Option<String>,
    pub body_serial: Option<String>,
    pub iso: Option<f32>,
    pub shutter: Option<f32>,
    pub aperture: Option<f32>,
    pub focal_len: Option<f32>,
    pub sensor: SensorKind,
    pub cfa_pattern: Option<String>,
    pub black_levels: Vec<u32>,
    pub white_levels: Vec<u32>,
    pub max_value: Option<u32>,
    pub has_cam_matrix: bool,
    pub flip: u8,
    pub dng_version: u32,
    pub cam_mul: Option<[f32; 4]>,
    pub lens_make: Option<String>,
    pub lens_model: Option<String>,
    pub lens_serial: Option<String>,
    pub focal_35mm: Option<f32>,
    pub max_aperture: Option<f32>,
    pub teleconverter: Option<String>,
    pub embedded_previews: Vec<(u32, u32, String)>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

pub fn probe_metadata(path: &Path) -> Option<ProbeMetadata> {
    let file = file_label(path);
    let _span = tracing::info_span!("decode.probe_metadata", file = %file).entered();
    libraw_ffi::probe_metadata(path)
}

pub fn decode_half(path: &Path, cancel: &CancelFlag) -> Result<DecodedRaw, DecodeError> {
    let file = file_label(path);
    let _span = tracing::info_span!("decode.l1", file = %file).entered();
    libraw_ffi::decode(path, libraw_ffi::DecodeLevel::Half, cancel)
}

pub fn decode_full(path: &Path, cancel: &CancelFlag) -> Result<DecodedRaw, DecodeError> {
    let file = file_label(path);
    let _span = tracing::info_span!("decode.l2", file = %file).entered();
    libraw_ffi::decode(path, libraw_ffi::DecodeLevel::Full, cancel)
}

fn file_label(path: &Path) -> String {
    path.file_name().and_then(|name| name.to_str()).unwrap_or("").to_owned()
}
