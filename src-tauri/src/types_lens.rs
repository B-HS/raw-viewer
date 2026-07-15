use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum DistortionModel {
    Poly3,
    Poly5,
    Ptlens,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum TcaModel {
    Linear,
    Poly3,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DistortionCoeffs {
    pub model: DistortionModel,
    pub coeffs: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TcaCoeffs {
    pub model: TcaModel,
    pub coeffs: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct VignettingCoeffs {
    pub coeffs: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LensProfileMatch {
    pub profile_id: String,
    pub lens_name: String,
    pub distortion: DistortionCoeffs,
    pub tca: TcaCoeffs,
    pub vignetting: Option<VignettingCoeffs>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LensProfileSummary {
    pub id: String,
    pub name: String,
}
