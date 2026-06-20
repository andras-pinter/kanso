use kanso_api::{CardDto, CardPatchDto};
use kanso_core::repo::CardRepo;
use tauri::State;

use crate::error::AppError;
use crate::RuntimeState;

#[tauri::command]
pub async fn cards_list(
    state: State<'_, RuntimeState>,
    column_id: String,
    include_archived: bool,
) -> Result<Vec<CardDto>, AppError> {
    let rows = CardRepo::list_by_column(&state.pool, &column_id, include_archived).await?;
    Ok(rows.into_iter().map(CardDto::from).collect())
}

#[tauri::command]
pub async fn card_create(
    state: State<'_, RuntimeState>,
    column_id: String,
    title: String,
) -> Result<CardDto, AppError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::invalid("title must not be empty"));
    }
    Ok(CardRepo::create(&state.pool, &column_id, title).await?.into())
}

#[tauri::command]
pub async fn card_update(
    state: State<'_, RuntimeState>,
    id: String,
    patch: CardPatchDto,
) -> Result<CardDto, AppError> {
    Ok(CardRepo::update(&state.pool, &id, patch.into())
        .await?
        .into())
}

#[tauri::command]
pub async fn card_move(
    state: State<'_, RuntimeState>,
    id: String,
    target_column_id: String,
    before: Option<String>,
    after: Option<String>,
) -> Result<CardDto, AppError> {
    Ok(CardRepo::move_card(
        &state.pool,
        &id,
        &target_column_id,
        before.as_deref(),
        after.as_deref(),
    )
    .await?
    .into())
}

#[tauri::command]
pub async fn card_archive(state: State<'_, RuntimeState>, id: String) -> Result<(), AppError> {
    CardRepo::archive(&state.pool, &id).await?;
    Ok(())
}

#[tauri::command]
pub async fn card_unarchive(state: State<'_, RuntimeState>, id: String) -> Result<(), AppError> {
    CardRepo::unarchive(&state.pool, &id).await?;
    Ok(())
}

// ---------- Legacy aliases (Wave 5 will retire) ----------
//
// `CardsPanel.tsx` still invokes `create_card`/`list_cards` against the seed
// column. Keep these wrappers so the existing UI keeps working after the
// canonical surface lands.

#[tauri::command]
pub async fn create_card(
    state: State<'_, RuntimeState>,
    title: String,
    column_id: Option<String>,
) -> Result<CardDto, AppError> {
    let column_id = column_id.unwrap_or_else(|| state.seed.column_id.clone());
    card_create(state, column_id, title).await
}

#[tauri::command]
pub async fn list_cards(
    state: State<'_, RuntimeState>,
    column_id: Option<String>,
) -> Result<Vec<CardDto>, AppError> {
    let column_id = column_id.unwrap_or_else(|| state.seed.column_id.clone());
    cards_list(state, column_id, false).await
}
