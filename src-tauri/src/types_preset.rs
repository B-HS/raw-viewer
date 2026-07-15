use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum PresetSource {
    Native,
    LrImport,
}

impl PresetSource {
    pub fn as_str(self) -> &'static str {
        match self {
            PresetSource::Native => "native",
            PresetSource::LrImport => "lr-import",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "lr-import" => PresetSource::LrImport,
            _ => PresetSource::Native,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PresetInfo {
    pub id: String,
    pub name: String,
    pub folder: String,
    pub field_mask: Vec<String>,
    pub source: PresetSource,
    pub builtin: bool,
    pub created_at: f64,
}
