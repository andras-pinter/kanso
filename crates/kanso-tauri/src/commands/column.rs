use kanso_api::{ColumnDto, ColumnPatchDto};
use kanso_core::repo::ColumnRepo;
use tauri::State;

use crate::error::AppError;
use crate::RuntimeState;

#[tauri::command]
pub async fn columns_list(
    state: State<'_, RuntimeState>,
    board_id: String,
    include_archived: bool,
) -> Result<Vec<ColumnDto>, AppError> {
    let rows = ColumnRepo::list_by_board(&state.pool, &board_id, include_archived).await?;
    Ok(rows.into_iter().map(ColumnDto::from).collect())
}

#[tauri::command]
pub async fn column_create(
    state: State<'_, RuntimeState>,
    board_id: String,
    name: String,
    color: Option<String>,
) -> Result<ColumnDto, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::invalid("name must not be empty"));
    }
    Ok(
        ColumnRepo::create(&state.pool, &board_id, name, color.as_deref())
            .await?
            .into(),
    )
}

#[tauri::command]
pub async fn column_update(
    state: State<'_, RuntimeState>,
    id: String,
    patch: ColumnPatchDto,
) -> Result<ColumnDto, AppError> {
    Ok(ColumnRepo::update(&state.pool, &id, patch.into())
        .await?
        .into())
}

#[tauri::command]
pub async fn column_archive(
    state: State<'_, RuntimeState>,
    id: String,
) -> Result<ColumnDto, AppError> {
    ColumnRepo::archive(&state.pool, &id).await?;
    load_column(&state, &id).await
}

#[tauri::command]
pub async fn column_unarchive(
    state: State<'_, RuntimeState>,
    id: String,
) -> Result<ColumnDto, AppError> {
    ColumnRepo::unarchive(&state.pool, &id).await?;
    load_column(&state, &id).await
}

async fn load_column(state: &State<'_, RuntimeState>, id: &str) -> Result<ColumnDto, AppError> {
    match ColumnRepo::get(&state.pool, id).await? {
        Some(c) => Ok(c.into()),
        None => Err(kanso_core::KansoError::NotFound {
            entity: "column",
            id: id.to_string(),
        }
        .into()),
    }
}

#[tauri::command]
pub async fn column_move(
    state: State<'_, RuntimeState>,
    id: String,
    before: Option<String>,
    after: Option<String>,
) -> Result<ColumnDto, AppError> {
    Ok(
        ColumnRepo::move_column(&state.pool, &id, before.as_deref(), after.as_deref())
            .await?
            .into(),
    )
}
