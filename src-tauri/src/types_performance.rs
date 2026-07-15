use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const EVENT_DECODE_CRASH_LOOP: &str = "decode:crash-loop";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum L2Policy {
    Always,
    Idle,
    Zoom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PerfSettings {
    pub preload_radius: u32,
    pub l2_policy: L2Policy,
    pub isolated_decode: bool,
}

impl Default for PerfSettings {
    fn default() -> Self {
        Self {
            preload_radius: 3,
            l2_policy: L2Policy::Idle,
            isolated_decode: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DecodeCrashLoopPayload {
    pub count: u32,
}
