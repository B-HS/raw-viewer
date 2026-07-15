use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum RasterFormat {
    Jpeg,
    Png,
    Tiff,
    Webp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum ExportColorSpace {
    Srgb,
    DisplayP3,
    Rec2020,
    AdobeRgb,
    Prophoto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum ResizeMode {
    None,
    LongEdge,
    Percent,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ResizeSpec {
    pub mode: ResizeMode,
    pub value: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum OutputSharpen {
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum ExportMetadata {
    All,
    GpsStrip,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ConflictPolicy {
    Rename,
    Overwrite,
    Skip,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RasterExportRequest {
    pub image_id: String,
    pub format: RasterFormat,
    pub quality: u8,
    pub color_space: ExportColorSpace,
    pub bits: u8,
    pub resize: ResizeSpec,
    pub sharpen: OutputSharpen,
    pub metadata: ExportMetadata,
    pub filename_template: String,
    pub output_dir: PathBuf,
    pub conflict: ConflictPolicy,
    pub source_width: u32,
    pub source_height: u32,
    pub seq: u32,
    pub preset_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ExportPhase {
    Render,
    Encode,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportProgressPayload {
    pub job_id: String,
    pub phase: ExportPhase,
    pub done: u32,
    pub total: u32,
}
