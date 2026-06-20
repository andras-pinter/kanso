use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::StatusCode;
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::Deserialize;

use kanso_core::repo::CardRepo;

use crate::dto::{
    CardBodyDto, CardBodySetDto, CardDto, CardPatchDto, CreateCardBody, MoveCardBody,
};
use crate::error::{require_non_empty, ApiError};
use crate::AppState;

#[derive(Debug, Deserialize)]
struct ListCardsQuery {
    #[serde(default)]
    include_archived: bool,
}

#[derive(Debug, Deserialize)]
struct SearchCardsQuery {
    #[serde(default)]
    q: String,
    #[serde(default)]
    include_archived: bool,
}

// Cap PUT /cards/:id/body payloads at 8 MiB. Typical bodies are <100 KiB;
// 8 MiB tolerates pathologically large pasted-image base64 without enabling abuse.
// Axum's default of 2 MiB rejects perfectly reasonable rich docs with an opaque 413.
const BODY_PUT_LIMIT_BYTES: usize = 8 * 1024 * 1024;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/cards/search", axum::routing::get(search))
        .route(
            "/columns/:column_id/cards",
            axum::routing::get(list).post(create),
        )
        .route("/cards/:id", axum::routing::patch(update))
        .route("/cards/:id/move", axum::routing::post(move_card))
        .route("/cards/:id/archive", axum::routing::post(archive))
        .route("/cards/:id/unarchive", axum::routing::post(unarchive))
        .route(
            "/cards/:id/body",
            axum::routing::get(get_body)
                .put(put_body)
                .layer(DefaultBodyLimit::max(BODY_PUT_LIMIT_BYTES)),
        )
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

async fn get_body(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<CardBodyDto>, ApiError> {
    let body = CardRepo::get_body(&state.pool, &id).await?;
    Ok(Json(CardBodyDto {
        body_blocksuite_b64: body.body_blocksuite.as_deref().map(|b| B64.encode(b)),
        body_text: body.body_text,
        updated_at: body.updated_at,
    }))
}

async fn put_body(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<CardBodySetDto>,
) -> Result<StatusCode, ApiError> {
    let blob = B64
        .decode(body.body_blocksuite_b64.as_bytes())
        .map_err(|e| {
            ApiError(kanso_core::KansoError::InvalidInput(format!(
                "body_blocksuite_b64 is not valid base64: {e}"
            )))
        })?;
    CardRepo::set_body(&state.pool, &id, &blob, &body.body_text).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn search(
    State(state): State<AppState>,
    Query(q): Query<SearchCardsQuery>,
) -> Result<Json<Vec<CardDto>>, ApiError> {
    let rows = CardRepo::search(&state.pool, &q.q, q.include_archived).await?;
    Ok(Json(rows.into_iter().map(CardDto::from).collect()))
}
