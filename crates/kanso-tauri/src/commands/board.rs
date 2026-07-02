use kanso_api::{BoardDto, BoardPatchDto, CardTagLinkDto};
use kanso_core::repo::{BoardRepo, CardRepo};
use tauri::State;

use crate::error::AppError;
use crate::RuntimeState;

#[tauri::command]
pub async fn boards_list(state: State<'_, RuntimeState>) -> Result<Vec<BoardDto>, AppError> {
    let rows = BoardRepo::list_all(&state.pool).await?;
    Ok(rows.into_iter().map(BoardDto::from).collect())
}

#[tauri::command]
pub async fn board_create(
    state: State<'_, RuntimeState>,
    name: String,
) -> Result<BoardDto, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::invalid("name must not be empty"));
    }
    Ok(BoardRepo::create(&state.pool, name).await?.into())
}

#[tauri::command]
pub async fn board_update(
    state: State<'_, RuntimeState>,
    id: String,
    patch: BoardPatchDto,
) -> Result<BoardDto, AppError> {
    Ok(BoardRepo::update(&state.pool, &id, patch.into())
        .await?
        .into())
}

#[tauri::command]
pub async fn board_delete(state: State<'_, RuntimeState>, id: String) -> Result<(), AppError> {
    BoardRepo::hard_delete(&state.pool, &id).await?;
    Ok(())
}

#[tauri::command]
pub async fn board_card_tags_list(
    state: State<'_, RuntimeState>,
    board_id: String,
) -> Result<Vec<CardTagLinkDto>, AppError> {
    let rows = CardRepo::card_tags_for_board(&state.pool, &board_id).await?;
    Ok(rows
        .into_iter()
        .map(|(card_id, tag_id)| CardTagLinkDto { card_id, tag_id })
        .collect())
}
