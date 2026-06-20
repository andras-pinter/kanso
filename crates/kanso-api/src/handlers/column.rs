use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Json, Router};
use serde::Deserialize;

use kanso_core::repo::ColumnRepo;

use crate::dto::{ColumnDto, ColumnPatchDto, CreateColumnBody, MoveColumnBody};
use crate::error::{require_non_empty, ApiError};
use crate::AppState;

#[derive(Debug, Deserialize)]
struct ListColumnsQuery {
    #[serde(default)]
    include_archived: bool,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/boards/:board_id/columns",
            axum::routing::get(list).post(create),
        )
        .route("/columns/:id", axum::routing::patch(update))
        .route("/columns/:id/move", axum::routing::post(move_column))
        .route("/columns/:id/archive", axum::routing::post(archive))
        .route("/columns/:id/unarchive", axum::routing::post(unarchive))
}

async fn list(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Query(q): Query<ListColumnsQuery>,
) -> Result<Json<Vec<ColumnDto>>, ApiError> {
    let rows = ColumnRepo::list_by_board(&state.pool, &board_id, q.include_archived).await?;
    Ok(Json(rows.into_iter().map(ColumnDto::from).collect()))
}

async fn create(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<CreateColumnBody>,
) -> Result<(StatusCode, Json<ColumnDto>), ApiError> {
    require_non_empty("name", &body.name)?;
    let col = ColumnRepo::create(
        &state.pool,
        &board_id,
        body.name.trim(),
        body.color.as_deref(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(ColumnDto::from(col))))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(patch): Json<ColumnPatchDto>,
) -> Result<Json<ColumnDto>, ApiError> {
    let col = ColumnRepo::update(&state.pool, &id, patch.into()).await?;
    Ok(Json(ColumnDto::from(col)))
}

async fn archive(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    ColumnRepo::archive(&state.pool, &id).await?;
    Ok(StatusCode::OK)
}

async fn unarchive(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    ColumnRepo::unarchive(&state.pool, &id).await?;
    Ok(StatusCode::OK)
}

async fn move_column(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<MoveColumnBody>,
) -> Result<Json<ColumnDto>, ApiError> {
    let col = ColumnRepo::move_column(
        &state.pool,
        &id,
        body.before.as_deref(),
        body.after.as_deref(),
    )
    .await?;
    Ok(Json(ColumnDto::from(col)))
}
