use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("authentication failed")]
    AuthInvalid,
    #[error("permission denied")]
    Forbidden,
    #[error("network error: {0}")]
    Network(String),
    #[error("rate limited")]
    RateLimit,
    #[error("keychain error: {0}")]
    Keychain(String),
    #[error("not found")]
    NotFound,
    #[error("validation error: {0}")]
    Validation(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("db error: {0}")]
    Db(String),
    #[error("unknown error: {0}")]
    Unknown(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppErrorPayload {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
}

impl AppError {
    pub fn payload(&self) -> AppErrorPayload {
        let (code, recoverable) = match self {
            AppError::AuthInvalid => ("AUTH_INVALID", true),
            AppError::Forbidden => ("FORBIDDEN", true),
            AppError::Network(_) => ("NETWORK", true),
            AppError::RateLimit => ("RATE_LIMIT", true),
            AppError::Keychain(_) => ("KEYCHAIN", true),
            AppError::NotFound => ("NOT_FOUND", true),
            AppError::Validation(_) => ("UNKNOWN", false),
            AppError::Io(_) => ("UNKNOWN", false),
            AppError::Db(_) => ("UNKNOWN", false),
            AppError::Unknown(_) => ("UNKNOWN", false),
        };

        AppErrorPayload {
            code: code.to_string(),
            message: self.to_string(),
            recoverable,
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(&self.payload()).unwrap_or_else(|_| {
            "{\"code\":\"UNKNOWN\",\"message\":\"unknown error\",\"recoverable\":false}"
                .to_string()
        })
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        AppError::Db(value.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        AppError::Io(value.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(value: keyring::Error) -> Self {
        AppError::Keychain(value.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(value: reqwest::Error) -> Self {
        if value.is_connect() || value.is_timeout() || value.is_request() {
            return AppError::Network(value.to_string());
        }

        AppError::Unknown(value.to_string())
    }
}
