use kanso_api::{CardDto, CreateTagBody, TagDto, TagPatchDto};
use kanso_core::repo::{CardRepo, TagRepo};
use tauri::State;

use crate::error::AppError;
use crate::RuntimeState;

#[tauri::command]
pub async fn tags_list(
    state: State<'_, RuntimeState>,
    include_archived: bool,
) -> Result<Vec<TagDto>, AppError> {
    let rows = TagRepo::list(&state.pool, include_archived).await?;
    Ok(rows.into_iter().map(TagDto::from).collect())
}

#[tauri::command]
pub async fn tag_create(
    state: State<'_, RuntimeState>,
    body: CreateTagBody,
) -> Result<TagDto, AppError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::invalid("name must not be empty"));
    }
    Ok(TagRepo::create(&state.pool, name, body.color.as_deref())
        .await?
        .into())
}

#[tauri::command]
pub async fn tag_get(state: State<'_, RuntimeState>, id: String) -> Result<TagDto, AppError> {
    Ok(TagRepo::get(&state.pool, &id).await?.into())
}

#[tauri::command]
pub async fn tag_update(
    state: State<'_, RuntimeState>,
    id: String,
    patch: TagPatchDto,
) -> Result<TagDto, AppError> {
    Ok(TagRepo::update(&state.pool, &id, patch.into())
        .await?
        .into())
}

#[tauri::command]
pub async fn tag_archive(state: State<'_, RuntimeState>, id: String) -> Result<(), AppError> {
    TagRepo::archive(&state.pool, &id).await?;
    Ok(())
}

#[tauri::command]
pub async fn tag_unarchive(state: State<'_, RuntimeState>, id: String) -> Result<(), AppError> {
    TagRepo::unarchive(&state.pool, &id).await?;
    Ok(())
}

#[tauri::command]
pub async fn tag_delete(state: State<'_, RuntimeState>, id: String) -> Result<(), AppError> {
    TagRepo::delete(&state.pool, &id).await?;
    Ok(())
}

#[tauri::command]
pub async fn card_tags_list(
    state: State<'_, RuntimeState>,
    card_id: String,
    include_archived: Option<bool>,
) -> Result<Vec<TagDto>, AppError> {
    let rows =
        CardRepo::tags_for_card(&state.pool, &card_id, include_archived.unwrap_or(false)).await?;
    Ok(rows.into_iter().map(TagDto::from).collect())
}

#[tauri::command]
pub async fn card_tag_add(
    state: State<'_, RuntimeState>,
    card_id: String,
    tag_id: String,
) -> Result<(), AppError> {
    CardRepo::add_tag(&state.pool, &card_id, &tag_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn card_tag_remove(
    state: State<'_, RuntimeState>,
    card_id: String,
    tag_id: String,
) -> Result<(), AppError> {
    CardRepo::remove_tag(&state.pool, &card_id, &tag_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn tag_cards_list(
    state: State<'_, RuntimeState>,
    tag_id: String,
    include_archived: Option<bool>,
) -> Result<Vec<CardDto>, AppError> {
    let rows =
        CardRepo::cards_with_tag(&state.pool, &tag_id, include_archived.unwrap_or(false)).await?;
    Ok(rows.into_iter().map(CardDto::from).collect())
}
