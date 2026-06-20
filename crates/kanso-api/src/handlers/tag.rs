use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Json, Router};
use serde::Deserialize;

use kanso_core::repo::{CardRepo, TagRepo};

use crate::dto::{CardDto, CreateTagBody, TagDto, TagPatchDto};
use crate::error::{require_non_empty, ApiError};
use crate::handlers::resolve_page;
use crate::AppState;

#[derive(Debug, Deserialize)]
struct ListTagsQuery {
    #[serde(default)]
    include_archived: bool,
    #[serde(default)]
    limit: Option<u32>,
    #[serde(default)]
    offset: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct TagsForCardQuery {
    #[serde(default)]
    include_archived: bool,
    #[serde(default)]
    limit: Option<u32>,
    #[serde(default)]
    offset: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct CardsByTagQuery {
    #[serde(default)]
    include_archived: bool,
    #[serde(default)]
    limit: Option<u32>,
    #[serde(default)]
    offset: Option<u32>,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/tags", axum::routing::get(list).post(create))
        .route(
            "/tags/:id",
            axum::routing::get(get).patch(update).delete(hard_delete),
        )
        .route("/tags/:id/archive", axum::routing::post(archive))
        .route("/tags/:id/unarchive", axum::routing::post(unarchive))
        .route("/tags/:id/cards", axum::routing::get(cards_with_tag))
        .route("/cards/:id/tags", axum::routing::get(tags_for_card))
        .route(
            "/cards/:id/tags/:tag_id",
            axum::routing::post(link_tag).delete(unlink_tag),
        )
}

async fn list(
    State(state): State<AppState>,
    Query(q): Query<ListTagsQuery>,
) -> Result<Json<Vec<TagDto>>, ApiError> {
    let (limit, offset) = resolve_page(q.limit, q.offset);
    let rows = TagRepo::list_paged(&state.pool, q.include_archived, limit, offset).await?;
    Ok(Json(rows.into_iter().map(TagDto::from).collect()))
}

async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateTagBody>,
) -> Result<(StatusCode, Json<TagDto>), ApiError> {
    require_non_empty("name", &body.name)?;
    let tag = TagRepo::create(&state.pool, body.name.trim(), body.color.as_deref()).await?;
    Ok((StatusCode::CREATED, Json(TagDto::from(tag))))
}

async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<TagDto>, ApiError> {
    let tag = TagRepo::get(&state.pool, &id).await?;
    Ok(Json(TagDto::from(tag)))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(patch): Json<TagPatchDto>,
) -> Result<Json<TagDto>, ApiError> {
    let tag = TagRepo::update(&state.pool, &id, patch.into()).await?;
    Ok(Json(TagDto::from(tag)))
}

async fn archive(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    TagRepo::archive(&state.pool, &id).await?;
    Ok(StatusCode::OK)
}

async fn unarchive(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    TagRepo::unarchive(&state.pool, &id).await?;
    Ok(StatusCode::OK)
}

async fn hard_delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    TagRepo::delete(&state.pool, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn tags_for_card(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<TagsForCardQuery>,
) -> Result<Json<Vec<TagDto>>, ApiError> {
    let (limit, offset) = resolve_page(q.limit, q.offset);
    let rows =
        CardRepo::tags_for_card_paged(&state.pool, &id, q.include_archived, limit, offset).await?;
    Ok(Json(rows.into_iter().map(TagDto::from).collect()))
}

async fn link_tag(
    State(state): State<AppState>,
    Path((card_id, tag_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    CardRepo::add_tag(&state.pool, &card_id, &tag_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn unlink_tag(
    State(state): State<AppState>,
    Path((card_id, tag_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    CardRepo::remove_tag(&state.pool, &card_id, &tag_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn cards_with_tag(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<CardsByTagQuery>,
) -> Result<Json<Vec<CardDto>>, ApiError> {
    let (limit, offset) = resolve_page(q.limit, q.offset);
    let rows =
        CardRepo::cards_with_tag_paged(&state.pool, &id, q.include_archived, limit, offset).await?;
    Ok(Json(rows.into_iter().map(CardDto::from).collect()))
}
