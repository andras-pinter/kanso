use kanso_core::KansoError;
use serde::Serialize;

/// Error shape returned from Tauri commands. `serde::Serialize` is required
/// for Tauri to pass it back to the webview.
#[derive(Debug, Serialize)]
pub struct AppError {
    pub kind: &'static str,
    pub message: String,
}

impl AppError {
    pub fn invalid(msg: impl Into<String>) -> Self {
        Self {
            kind: "invalid_input",
            message: msg.into(),
        }
    }
}

impl From<KansoError> for AppError {
    fn from(e: KansoError) -> Self {
        let kind = match &e {
            KansoError::NotFound { .. } => "not_found",
            KansoError::InvalidInput(_) => "invalid_input",
            KansoError::InvalidMove(_) => "invalid_move",
            KansoError::Conflict(_) => "conflict",
            KansoError::Db(_) | KansoError::Migrate(_) => "db",
        };
        Self {
            kind,
            message: e.to_string(),
        }
    }
}
