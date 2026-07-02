use axum::extract::{Path, Query, State};
use axum::{Json, Router};
use serde::Deserialize;

use kanso_core::repo::ColumnRepo;
use kanso_core::KansoError;

use crate::dto::ColumnDto;
use crate::error::ApiError;
use crate::handlers::resolve_page;
use crate::AppState;

#[derive(Debug, Deserialize)]
struct ListColumnsQuery {
    #[serde(default)]
    limit: Option<u32>,
    #[serde(default)]
    offset: Option<u32>,
}

/// Columns are fixed (Incoming / Todo / In Progress / Done) and are seeded
/// when a board is created. There is no create/update/move/delete API.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/boards/:board_id/columns", axum::routing::get(list))
        .route("/columns/:id", axum::routing::get(get_one))
}

async fn list(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Query(q): Query<ListColumnsQuery>,
) -> Result<Json<Vec<ColumnDto>>, ApiError> {
    let (limit, offset) = resolve_page(q.limit, q.offset);
    let rows = ColumnRepo::list_by_board_paged(&state.pool, &board_id, limit, offset).await?;
    Ok(Json(rows.into_iter().map(ColumnDto::from).collect()))
}

async fn get_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ColumnDto>, ApiError> {
    match ColumnRepo::get(&state.pool, &id).await? {
        Some(col) => Ok(Json(ColumnDto::from(col))),
        None => Err(ApiError(KansoError::NotFound {
            entity: "column",
            id,
        })),
    }
}
