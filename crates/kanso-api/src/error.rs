use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

use kanso_core::KansoError;

pub struct ApiError(pub KansoError);

impl From<KansoError> for ApiError {
    fn from(e: KansoError) -> Self {
        Self(e)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, msg) = match &self.0 {
            KansoError::NotFound { .. } => (StatusCode::NOT_FOUND, self.0.to_string()),
            KansoError::InvalidInput(_) | KansoError::InvalidMove(_) => {
                (StatusCode::BAD_REQUEST, self.0.to_string())
            }
            KansoError::Conflict(_) => (StatusCode::CONFLICT, self.0.to_string()),
            KansoError::Db(_) | KansoError::Migrate(_) => {
                tracing::error!(error = ?self.0, "db error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal error".to_string(),
                )
            }
        };
        (status, Json(serde_json::json!({ "error": msg }))).into_response()
    }
}

pub fn require_non_empty(field: &str, value: &str) -> Result<(), ApiError> {
    if value.trim().is_empty() {
        return Err(ApiError(KansoError::InvalidInput(format!(
            "{field} must not be empty"
        ))));
    }
    Ok(())
}
