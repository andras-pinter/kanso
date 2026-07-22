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

    pub fn cli_extension(msg: impl Into<String>) -> Self {
        Self {
            kind: "cli_extension",
            message: msg.into(),
        }
    }

    pub fn io(msg: impl Into<String>) -> Self {
        Self {
            kind: "io",
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

impl From<crate::ext_install::ExtInstallError> for AppError {
    fn from(e: crate::ext_install::ExtInstallError) -> Self {
        Self::cli_extension(e.user_message())
    }
}

impl From<crate::mcp_hosts::McpHostError> for AppError {
    fn from(e: crate::mcp_hosts::McpHostError) -> Self {
        Self {
            kind: "mcp_host",
            message: e.to_string(),
        }
    }
}

impl From<crate::snapshot::SnapshotError> for AppError {
    fn from(e: crate::snapshot::SnapshotError) -> Self {
        match &e {
            crate::snapshot::SnapshotError::UnsupportedSchemaVersion { .. } => Self {
                kind: "unsupported_schema_version",
                message: e.to_string(),
            },
            crate::snapshot::SnapshotError::Json(_) => Self::invalid(e.to_string()),
            crate::snapshot::SnapshotError::Db(_) => Self {
                kind: "db",
                message: e.to_string(),
            },
            crate::snapshot::SnapshotError::Core(source) => {
                let kind = match source {
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
    }
}
