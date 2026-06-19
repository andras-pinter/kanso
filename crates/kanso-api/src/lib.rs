//! HTTP transport for kanso.
//!
//! Built once in-process by `kanso-tauri` and shared via the same sqlx pool.
//! The same `Router` is the future single source for the CLI extension.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use kanso_core::domain::Card;
use kanso_core::repo::CardRepo;
use kanso_core::KansoError;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route(
            "/columns/:column_id/cards",
            get(list_cards).post(create_card),
        )
        .with_state(state)
}

async fn healthz() -> &'static str {
    "ok"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardDto {
    pub id: String,
    pub column_id: String,
    pub title: String,
    pub position: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Card> for CardDto {
    fn from(c: Card) -> Self {
        Self {
            id: c.id,
            column_id: c.column_id,
            title: c.title,
            position: c.position,
            created_at: c.created_at,
            updated_at: c.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateCardBody {
    pub title: String,
}

async fn list_cards(
    State(state): State<AppState>,
    Path(column_id): Path<String>,
) -> Result<Json<Vec<CardDto>>, ApiError> {
    let cards = CardRepo::list_by_column(&state.pool, &column_id).await?;
    Ok(Json(cards.into_iter().map(CardDto::from).collect()))
}

async fn create_card(
    State(state): State<AppState>,
    Path(column_id): Path<String>,
    Json(body): Json<CreateCardBody>,
) -> Result<(StatusCode, Json<CardDto>), ApiError> {
    let title = body.title.trim();
    if title.is_empty() {
        return Err(ApiError(KansoError::InvalidInput(
            "title must not be empty".into(),
        )));
    }
    let card = CardRepo::create(&state.pool, &column_id, title).await?;
    Ok((StatusCode::CREATED, Json(CardDto::from(card))))
}

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
            KansoError::InvalidInput(_) => (StatusCode::BAD_REQUEST, self.0.to_string()),
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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use kanso_core::db::{migrate, open_memory};
    use kanso_core::repo::{BoardRepo, ColumnRepo};
    use tower::ServiceExt;

    use super::*;

    async fn setup() -> (Router, String) {
        let pool = open_memory().await.unwrap();
        migrate(&pool).await.unwrap();
        let board = BoardRepo::create(&pool, "Test").await.unwrap();
        let col = ColumnRepo::create(&pool, &board.id, "Todo").await.unwrap();
        let app = router(AppState { pool });
        (app, col.id)
    }

    #[tokio::test]
    async fn test_healthz_returns_ok() {
        let (app, _) = setup().await;
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = res.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&body[..], b"ok");
    }

    #[tokio::test]
    async fn test_create_and_list_cards() {
        let (app, col_id) = setup().await;
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/columns/{col_id}/cards"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"hello"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::CREATED);

        let res = app
            .oneshot(
                Request::builder()
                    .uri(format!("/columns/{col_id}/cards"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = res.into_body().collect().await.unwrap().to_bytes();
        let cards: Vec<CardDto> = serde_json::from_slice(&body).unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].title, "hello");
    }

    #[tokio::test]
    async fn test_create_card_rejects_blank_title() {
        let (app, col_id) = setup().await;
        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/columns/{col_id}/cards"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"   "}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }
}
