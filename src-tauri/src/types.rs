use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PendingOpenRequest {
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImageEntry {
    pub image_id: String,
    pub path: PathBuf,
    pub file_name: String,
    pub is_raw: bool,
    pub modified_ms: Option<f64>,
    pub file_size: Option<f64>,
    pub is_animated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OpenResult {
    pub entry: ImageEntry,
    pub dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScanBatch {
    pub entries: Vec<ImageEntry>,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScanSummary {
    pub total: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ProxyLevel {
    L0,
    L1,
    L2,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LevelReadyPayload {
    pub image_id: String,
    pub level: ProxyLevel,
    pub rev: u32,
    pub width: u32,
    pub height: u32,
    pub flip: u8,
    pub has_color_profile: Option<bool>,
    pub color_matrix: Option<Vec<f32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DecodeFailedPayload {
    pub image_id: String,
    pub level: ProxyLevel,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum WbMode {
    AsShot,
    Auto,
    Custom,
    Daylight,
    Cloudy,
    Shade,
    Tungsten,
    Fluorescent,
    Flash,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WbState {
    pub mode: WbMode,
    pub temp: f64,
    pub tint: f64,
    pub temp_shift: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LensState {
    pub auto_profile: bool,
    pub profile_id: Option<String>,
    pub distortion: f64,
    pub tca: f64,
    pub vignette: f64,
    pub manual_vignette: f64,
    pub manual_distortion: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GeometryState {
    pub rotate90: u8,
    pub flip_h: bool,
    pub flip_v: bool,
    pub straighten: f64,
    pub perspective_v: f64,
    pub perspective_h: f64,
    pub perspective_rotate: f64,
    pub aspect_adjust: f64,
    pub scale: f64,
    pub offset_x: f64,
    pub offset_y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CropState {
    pub enabled: bool,
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub aspect: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScanState {
    pub enabled: bool,
    pub corners: [[f64; 2]; 4],
    pub edges: [[f64; 2]; 4],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum DrawerTool {
    Brush,
    Pencil,
    Eraser,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum DrawerShapeKind {
    Line,
    Arrow,
    Rect,
    Ellipse,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum DrawerBlendMode {
    #[default]
    Normal,
    Multiply,
    Screen,
    Overlay,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DrawerTransform {
    pub offset_x: f64,
    pub offset_y: f64,
    pub scale: f64,
    pub rotate: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DrawerAdjust {
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
    pub hue: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(export)]
pub enum DrawerObject {
    Stroke {
        tool: DrawerTool,
        color: String,
        size: f64,
        opacity: f64,
        points: Vec<[f64; 2]>,
        #[serde(default)]
        clip: Option<Vec<[f64; 2]>>,
    },
    Shape {
        shape: DrawerShapeKind,
        color: String,
        size: f64,
        fill: bool,
        from: [f64; 2],
        to: [f64; 2],
        #[serde(default)]
        clip: Option<Vec<[f64; 2]>>,
    },
    Text {
        text: String,
        color: String,
        size: f64,
        position: [f64; 2],
    },
    Fill {
        color: String,
        seed: [f64; 2],
        #[serde(default)]
        clip: Option<Vec<[f64; 2]>>,
    },
    Clone {
        points: Vec<[f64; 2]>,
        offset: [f64; 2],
        size: f64,
        #[serde(default)]
        clip: Option<Vec<[f64; 2]>>,
    },
    Blur {
        points: Vec<[f64; 2]>,
        size: f64,
        #[serde(default)]
        clip: Option<Vec<[f64; 2]>>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DrawerLayer {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub opacity: f64,
    pub objects: Vec<DrawerObject>,
    #[serde(default)]
    pub blend: DrawerBlendMode,
    #[serde(default)]
    pub transform: Option<DrawerTransform>,
    #[serde(default)]
    pub adjust: Option<DrawerAdjust>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DrawerState {
    pub layers: Vec<DrawerLayer>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ToneState {
    pub exposure: f64,
    pub contrast: f64,
    pub highlights: f64,
    pub shadows: f64,
    pub whites: f64,
    pub blacks: f64,
    pub highlight_recovery: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum BaseCurveMode {
    Linear,
    Standard,
    Filmic,
    CameraMatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CurvePoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CurvesState {
    pub rgb: Vec<CurvePoint>,
    pub red: Vec<CurvePoint>,
    pub green: Vec<CurvePoint>,
    pub blue: Vec<CurvePoint>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum HslBand {
    Red,
    Orange,
    Yellow,
    Green,
    Aqua,
    Blue,
    Purple,
    Magenta,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HslAdjust {
    pub hue: f64,
    pub sat: f64,
    pub lum: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ColorState {
    pub vibrance: f64,
    pub saturation: f64,
    pub hsl: std::collections::HashMap<HslBand, HslAdjust>,
    pub bw: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DetailState {
    pub sharpen_amount: f64,
    pub sharpen_radius: f64,
    pub sharpen_detail: f64,
    pub sharpen_masking: f64,
    pub nr_luminance: f64,
    pub nr_luma_detail: f64,
    pub nr_luma_contrast: f64,
    pub nr_color: f64,
    pub nr_color_detail: f64,
    pub hot_pixel_removal: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EffectsState {
    pub clarity: f64,
    pub dehaze: f64,
    pub vignette_amount: f64,
    pub vignette_midpoint: f64,
    pub vignette_roundness: f64,
    pub vignette_feather: f64,
    pub grain_amount: f64,
    pub grain_size: f64,
    pub grain_roughness: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EditMeta {
    pub applied_preset: Option<String>,
    pub modified_at: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EditState {
    pub version: u32,
    pub wb: WbState,
    pub lens: LensState,
    pub geometry: GeometryState,
    pub crop: Option<CropState>,
    #[serde(default)]
    pub scan: Option<ScanState>,
    #[serde(default)]
    pub drawer: Option<DrawerState>,
    pub tone: ToneState,
    pub base_curve: BaseCurveMode,
    pub curves: CurvesState,
    pub color: ColorState,
    pub detail: DetailState,
    pub effects: EffectsState,
    pub meta: EditMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EditStateEnvelope {
    pub state: EditState,
    pub edit_version: u32,
    pub is_default: bool,
}
