use kanso_api::ColumnDto;
use kanso_core::repo::ColumnRepo;
use tauri::State;

use crate::error::AppError;
use crate::RuntimeState;

/// Columns are fixed (Incoming / Todo / In Progress / Done). Only read
/// commands are exposed.
#[tauri::command]
pub async fn columns_list(
    state: State<'_, RuntimeState>,
    board_id: String,
) -> Result<Vec<ColumnDto>, AppError> {
    let rows = ColumnRepo::list_by_board(&state.pool, &board_id).await?;
    Ok(rows.into_iter().map(ColumnDto::from).collect())
}
