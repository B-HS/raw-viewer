use serde::Serialize;
use thiserror::Error;
use ts_rs::TS;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error, Serialize, TS)]
#[serde(tag = "code", content = "detail", rename_all = "kebab-case")]
#[ts(export)]
pub enum AppError {
    #[error("not supported on this platform")]
    NotSupportedOnPlatform,
    #[error("io error: {0}")]
    Io(String),
    #[error("edit state version conflict")]
    Conflict,
    #[error("decode failed: {0}")]
    Decode(String),
    #[error("{0}")]
    Internal(String),
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}
