use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::StatusCode;
use axum::{Json, Router};
use serde::Deserialize;

use kanso_core::repo::CardRepo;

use crate::dto::{
    CardBodyDto, CardBodySetDto, CardDto, CardListDto, CardPatchDto, CardSearchHitDto,
    CreateCardBody, MoveCardBody,
};
use crate::error::{require_non_empty, ApiError};
use crate::handlers::resolve_page;
use crate::AppState;
use kanso_core::KansoError;

#[derive(Debug, Deserialize)]
struct ListCardsQuery {
    #[serde(default)]
    limit: Option<u32>,
    #[serde(default)]
    offset: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct SearchCardsQuery {
    #[serde(default)]
    q: String,
    #[serde(default)]
    limit: Option<u32>,
    #[serde(default)]
    offset: Option<u32>,
}

// Cap PUT /cards/:id/body payloads at 8 MiB. Typical bodies are <100 KiB;
// 8 MiB tolerates pathologically large markdown docs without enabling abuse.
// Axum's default of 2 MiB rejects perfectly reasonable rich docs with an opaque 413.
const BODY_PUT_LIMIT_BYTES: usize = 8 * 1024 * 1024;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/cards/search", axum::routing::get(search))
        .route(
            "/columns/:column_id/cards",
            axum::routing::get(list).post(create),
        )
        .route(
            "/cards/:id",
            axum::routing::get(get_one)
                .patch(update)
                .delete(hard_delete),
        )
        .route("/cards/:id/move", axum::routing::post(move_card))
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
) -> Result<Json<Vec<CardListDto>>, ApiError> {
    let (limit, offset) = resolve_page(q.limit, q.offset);
    let rows = CardRepo::list_by_column_paged(&state.pool, &column_id, limit, offset).await?;
    Ok(Json(rows.into_iter().map(CardListDto::from).collect()))
}

async fn create(
    State(state): State<AppState>,
    Path(column_id): Path<String>,
    Json(body): Json<CreateCardBody>,
) -> Result<(StatusCode, Json<CardListDto>), ApiError> {
    require_non_empty("title", &body.title)?;
    let card = CardRepo::create(&state.pool, &column_id, body.title.trim()).await?;
    Ok((StatusCode::CREATED, Json(CardListDto::from(card))))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(patch): Json<CardPatchDto>,
) -> Result<Json<CardListDto>, ApiError> {
    let card = CardRepo::update(&state.pool, &id, patch.into()).await?;
    Ok(Json(CardListDto::from(card)))
}

async fn get_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<CardDto>, ApiError> {
    match CardRepo::get(&state.pool, &id).await? {
        Some(card) => Ok(Json(CardDto::from(card))),
        None => Err(ApiError(KansoError::NotFound { entity: "card", id })),
    }
}

async fn move_card(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<MoveCardBody>,
) -> Result<Json<CardListDto>, ApiError> {
    let card = CardRepo::move_card(
        &state.pool,
        &id,
        &body.target_column_id,
        body.before.as_deref(),
        body.after.as_deref(),
    )
    .await?;
    Ok(Json(CardListDto::from(card)))
}

async fn hard_delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    match CardRepo::delete(&state.pool, &id).await {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(KansoError::NotFound { .. }) => {
            Err(ApiError(KansoError::NotFound { entity: "card", id }))
        }
        Err(e) => Err(ApiError(e)),
    }
}

async fn load_card_list(state: &AppState, id: String) -> Result<Json<CardListDto>, ApiError> {
    match CardRepo::get(&state.pool, &id).await? {
        Some(card) => Ok(Json(CardListDto::from(card))),
        None => Err(ApiError(KansoError::NotFound { entity: "card", id })),
    }
}

async fn get_body(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<CardBodyDto>, ApiError> {
    let body = CardRepo::get_body(&state.pool, &id).await?;
    Ok(Json(CardBodyDto {
        body_markdown: body.body_markdown,
        updated_at: body.updated_at,
    }))
}

async fn put_body(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<CardBodySetDto>,
) -> Result<Json<CardListDto>, ApiError> {
    // Empty string clears the body to NULL. Any non-empty markdown is stored
    // verbatim; FTS5's unicode61 tokenizer handles it without a pre-parse.
    let value = if body.body_markdown.is_empty() {
        None
    } else {
        Some(body.body_markdown.as_str())
    };
    CardRepo::set_body(&state.pool, &id, value).await?;
    load_card_list(&state, id).await
}

async fn search(
    State(state): State<AppState>,
    Query(q): Query<SearchCardsQuery>,
) -> Result<Json<Vec<CardSearchHitDto>>, ApiError> {
    let (limit, offset) = resolve_page(q.limit, q.offset);
    let rows = CardRepo::search_with_context_paged(&state.pool, &q.q, limit, offset).await?;
    Ok(Json(rows.into_iter().map(CardSearchHitDto::from).collect()))
}
