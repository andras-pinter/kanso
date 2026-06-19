use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Json, Router};
use serde::Deserialize;

use kanso_core::repo::CardRepo;

use crate::dto::{CardDto, CardPatchDto, CreateCardBody, MoveCardBody};
use crate::error::{require_non_empty, ApiError};
use crate::AppState;

#[derive(Debug, Deserialize)]
struct ListCardsQuery {
    #[serde(default)]
    include_archived: bool,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/columns/:column_id/cards",
            axum::routing::get(list).post(create),
        )
        .route("/cards/:id", axum::routing::patch(update))
        .route("/cards/:id/move", axum::routing::post(move_card))
        .route("/cards/:id/archive", axum::routing::post(archive))
        .route("/cards/:id/unarchive", axum::routing::post(unarchive))
}

async fn list(
    State(state): State<AppState>,
    Path(column_id): Path<String>,
    Query(q): Query<ListCardsQuery>,
) -> Result<Json<Vec<CardDto>>, ApiError> {
    let rows = CardRepo::list_by_column(&state.pool, &column_id, q.include_archived).await?;
    Ok(Json(rows.into_iter().map(CardDto::from).collect()))
}

async fn create(
    State(state): State<AppState>,
    Path(column_id): Path<String>,
    Json(body): Json<CreateCardBody>,
) -> Result<(StatusCode, Json<CardDto>), ApiError> {
    require_non_empty("title", &body.title)?;
    let card = CardRepo::create(&state.pool, &column_id, body.title.trim()).await?;
    Ok((StatusCode::CREATED, Json(CardDto::from(card))))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(patch): Json<CardPatchDto>,
) -> Result<Json<CardDto>, ApiError> {
    let card = CardRepo::update(&state.pool, &id, patch.into()).await?;
    Ok(Json(CardDto::from(card)))
}

async fn move_card(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<MoveCardBody>,
) -> Result<Json<CardDto>, ApiError> {
    let card = CardRepo::move_card(
        &state.pool,
        &id,
        &body.target_column_id,
        body.before.as_deref(),
        body.after.as_deref(),
    )
    .await?;
    Ok(Json(CardDto::from(card)))
}

async fn archive(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    CardRepo::archive(&state.pool, &id).await?;
    Ok(StatusCode::OK)
}

async fn unarchive(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    CardRepo::unarchive(&state.pool, &id).await?;
    Ok(StatusCode::OK)
}
