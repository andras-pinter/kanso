use kanso_api::{CardBodyDto, CardBodySetDto, CardListDto, CardPatchDto, CardSearchHitDto};
use kanso_core::repo::CardRepo;
use tauri::State;

use crate::error::AppError;
use crate::RuntimeState;

#[tauri::command]
pub async fn cards_list(
    state: State<'_, RuntimeState>,
    column_id: String,
) -> Result<Vec<CardListDto>, AppError> {
    let rows = CardRepo::list_by_column(&state.pool, &column_id).await?;
    Ok(rows.into_iter().map(CardListDto::from).collect())
}

#[tauri::command]
pub async fn card_create(
    state: State<'_, RuntimeState>,
    column_id: String,
    title: String,
) -> Result<CardListDto, AppError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::invalid("title must not be empty"));
    }
    Ok(CardRepo::create(&state.pool, &column_id, title)
        .await?
        .into())
}

#[tauri::command]
pub async fn card_update(
    state: State<'_, RuntimeState>,
    id: String,
    patch: CardPatchDto,
) -> Result<CardListDto, AppError> {
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
) -> Result<CardListDto, AppError> {
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

/// Hard delete a card. FTS rows are cleaned up by the SQL trigger; card→tag
/// links cascade via ON DELETE CASCADE.
#[tauri::command]
pub async fn card_delete(state: State<'_, RuntimeState>, id: String) -> Result<(), AppError> {
    CardRepo::delete(&state.pool, &id).await?;
    Ok(())
}

async fn load_card_list(
    state: &State<'_, RuntimeState>,
    id: &str,
) -> Result<CardListDto, AppError> {
    match CardRepo::get(&state.pool, id).await? {
        Some(c) => Ok(c.into()),
        None => Err(kanso_core::KansoError::NotFound {
            entity: "card",
            id: id.to_string(),
        }
        .into()),
    }
}

#[tauri::command]
pub async fn card_body_get(
    state: State<'_, RuntimeState>,
    id: String,
) -> Result<CardBodyDto, AppError> {
    let body = CardRepo::get_body(&state.pool, &id).await?;
    Ok(CardBodyDto {
        body_markdown: body.body_markdown,
        updated_at: body.updated_at,
    })
}

#[tauri::command]
pub async fn card_body_set(
    state: State<'_, RuntimeState>,
    id: String,
    body: CardBodySetDto,
) -> Result<CardListDto, AppError> {
    // Empty markdown clears the body to NULL — PUT semantics.
    let value = if body.body_markdown.is_empty() {
        None
    } else {
        Some(body.body_markdown.as_str())
    };
    CardRepo::set_body(&state.pool, &id, value).await?;
    load_card_list(&state, &id).await
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
) -> Result<CardListDto, AppError> {
    let column_id = column_id.unwrap_or_else(|| state.seed.column_id.clone());
    card_create(state, column_id, title).await
}

#[tauri::command]
pub async fn list_cards(
    state: State<'_, RuntimeState>,
    column_id: Option<String>,
) -> Result<Vec<CardListDto>, AppError> {
    let column_id = column_id.unwrap_or_else(|| state.seed.column_id.clone());
    cards_list(state, column_id).await
}

#[tauri::command]
pub async fn card_search(
    state: State<'_, RuntimeState>,
    q: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<CardSearchHitDto>, AppError> {
    let limit = limit.unwrap_or(100).min(500);
    let offset = offset.unwrap_or(0);
    let rows = CardRepo::search_with_context_paged(&state.pool, &q, limit, offset).await?;
    Ok(rows.into_iter().map(CardSearchHitDto::from).collect())
}
