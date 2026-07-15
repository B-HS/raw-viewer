use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const EVENT_CPU_FRAME_READY: &str = "cpu:frame-ready";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CpuFrameReadyPayload {
    pub image_id: String,
    pub rev: u32,
    pub width: u32,
    pub height: u32,
    pub flip: u8,
}
