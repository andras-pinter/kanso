use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Json, Router};
use serde::Deserialize;

use kanso_core::repo::BoardRepo;
use kanso_core::KansoError;

use crate::dto::{BoardDto, BoardPatchDto, CreateBoardBody};
use crate::error::{require_non_empty, ApiError};
use crate::AppState;

#[derive(Debug, Deserialize)]
struct ListBoardsQuery {
    #[serde(default)]
    include_archived: bool,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/boards", axum::routing::get(list).post(create))
        .route(
            "/boards/:id",
            axum::routing::patch(update).delete(hard_delete),
        )
        .route("/boards/:id/archive", axum::routing::post(archive))
        .route("/boards/:id/unarchive", axum::routing::post(unarchive))
}

async fn list(
    State(state): State<AppState>,
    Query(q): Query<ListBoardsQuery>,
) -> Result<Json<Vec<BoardDto>>, ApiError> {
    let rows = BoardRepo::list_all(&state.pool, q.include_archived).await?;
    Ok(Json(rows.into_iter().map(BoardDto::from).collect()))
}

async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateBoardBody>,
) -> Result<(StatusCode, Json<BoardDto>), ApiError> {
    require_non_empty("name", &body.name)?;
    let board = BoardRepo::create(&state.pool, body.name.trim()).await?;
    Ok((StatusCode::CREATED, Json(BoardDto::from(board))))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(patch): Json<BoardPatchDto>,
) -> Result<Json<BoardDto>, ApiError> {
    let board = BoardRepo::update(&state.pool, &id, patch.into()).await?;
    Ok(Json(BoardDto::from(board)))
}

async fn archive(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    BoardRepo::archive(&state.pool, &id).await?;
    Ok(StatusCode::OK)
}

async fn unarchive(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    BoardRepo::unarchive(&state.pool, &id).await?;
    Ok(StatusCode::OK)
}

async fn hard_delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    match BoardRepo::hard_delete(&state.pool, &id).await {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(KansoError::NotFound { .. }) => Err(ApiError(KansoError::NotFound {
            entity: "board",
            id,
        })),
        Err(e) => Err(ApiError(e)),
    }
}
