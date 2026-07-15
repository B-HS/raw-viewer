use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Flag {
    Pick,
    Reject,
}

impl Flag {
    pub fn as_str(self) -> &'static str {
        match self {
            Flag::Pick => "pick",
            Flag::Reject => "reject",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pick" => Some(Flag::Pick),
            "reject" => Some(Flag::Reject),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SensorType {
    Bayer,
    Xtrans,
    Monochrome,
    Foveon,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum MetadataWarning {
    NoColorProfile,
    UnsupportedSensor,
    CorruptExif,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ShutterSpeed {
    pub num: u32,
    pub den: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FlashInfo {
    pub fired: bool,
    pub mode: String,
    pub compensation: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DepthOfField {
    pub near: f64,
    pub far: f64,
    pub hyperfocal: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileMeta {
    pub name: String,
    pub path: String,
    pub size_bytes: f64,
    pub format: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub megapixels: Option<f64>,
    pub bit_depth: Option<u32>,
    pub color_space: Option<String>,
    pub icc_profile_name: Option<String>,
    pub created_at: Option<f64>,
    pub modified_at: Option<f64>,
    pub has_sidecar: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CameraMeta {
    pub make: Option<String>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub firmware: Option<String>,
    pub sensor_type: SensorType,
    pub cfa_pattern: Option<String>,
    pub crop_factor: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LensMeta {
    pub make: Option<String>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub mount: Option<String>,
    pub max_aperture: Option<f64>,
    pub focal_length35mm: Option<f64>,
    pub teleconverter: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExposureMeta {
    pub shutter_speed: Option<ShutterSpeed>,
    pub f_number: Option<f64>,
    pub iso: Option<u32>,
    pub focal_length: Option<f64>,
    pub exposure_bias: Option<f64>,
    pub exposure_mode: Option<String>,
    pub metering_mode: Option<String>,
    pub flash: Option<FlashInfo>,
    pub white_balance: Option<String>,
    pub wb_temp: Option<f64>,
    pub subject_distance: Option<f64>,
    pub dof: Option<DepthOfField>,
    pub drive_mode: Option<String>,
    pub stabilization: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DatesMeta {
    pub original: Option<String>,
    pub digitized: Option<String>,
    pub modified: Option<String>,
    pub timezone_offset: Option<String>,
    pub sub_sec: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GpsMeta {
    pub lat: f64,
    pub lng: f64,
    pub alt: Option<f64>,
    pub alt_ref: Option<String>,
    pub direction: Option<f64>,
    pub direction_ref: Option<String>,
    pub speed: Option<f64>,
    pub timestamp: Option<String>,
    pub processing_method: Option<String>,
    pub dop: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EmbeddedPreview {
    pub width: u32,
    pub height: u32,
    pub format: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RawMeta {
    pub is_dng: bool,
    pub dng_version: Option<String>,
    pub black_level: Vec<u32>,
    pub white_level: Vec<u32>,
    pub as_shot_neutral: Option<Vec<f64>>,
    pub has_color_matrix: bool,
    pub compression: Option<String>,
    pub embedded_previews: Vec<EmbeddedPreview>,
    pub has_opcode_list: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImageMetadata {
    pub file: FileMeta,
    pub camera: CameraMeta,
    pub lens: LensMeta,
    pub exposure: ExposureMeta,
    pub dates: DatesMeta,
    pub gps: Option<GpsMeta>,
    pub raw: Option<RawMeta>,
    pub warnings: Vec<MetadataWarning>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OrganizeEntry {
    pub image_id: String,
    pub rating: u8,
    pub flag: Option<Flag>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum FsChangeKind {
    Created,
    Removed,
    Modified,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FsChangedPayload {
    pub kind: FsChangeKind,
    pub paths: Vec<PathBuf>,
}
