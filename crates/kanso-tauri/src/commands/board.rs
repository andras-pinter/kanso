use kanso_api::{BoardDto, BoardPatchDto};
use kanso_core::repo::BoardRepo;
use tauri::State;

use crate::error::AppError;
use crate::RuntimeState;

#[tauri::command]
pub async fn boards_list(
    state: State<'_, RuntimeState>,
    include_archived: bool,
) -> Result<Vec<BoardDto>, AppError> {
    let rows = BoardRepo::list_all(&state.pool, include_archived).await?;
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
pub async fn board_archive(state: State<'_, RuntimeState>, id: String) -> Result<(), AppError> {
    BoardRepo::archive(&state.pool, &id).await?;
    Ok(())
}

#[tauri::command]
pub async fn board_unarchive(state: State<'_, RuntimeState>, id: String) -> Result<(), AppError> {
    BoardRepo::unarchive(&state.pool, &id).await?;
    Ok(())
}

#[tauri::command]
pub async fn board_delete(state: State<'_, RuntimeState>, id: String) -> Result<(), AppError> {
    BoardRepo::hard_delete(&state.pool, &id).await?;
    Ok(())
}
