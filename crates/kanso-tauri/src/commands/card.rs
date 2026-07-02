use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use kanso_api::{CardBodyDto, CardBodySetDto, CardDto, CardPatchDto, CardSearchHitDto};
use kanso_core::repo::CardRepo;
use tauri::State;

use crate::error::AppError;
use crate::RuntimeState;

#[tauri::command]
pub async fn cards_list(
    state: State<'_, RuntimeState>,
    column_id: String,
) -> Result<Vec<CardDto>, AppError> {
    let rows = CardRepo::list_by_column(&state.pool, &column_id).await?;
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
    Ok(CardRepo::create(&state.pool, &column_id, title)
        .await?
        .into())
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

/// Hard delete a card. FTS rows are cleaned up by the SQL trigger; card→tag
/// links cascade via ON DELETE CASCADE.
#[tauri::command]
pub async fn card_delete(state: State<'_, RuntimeState>, id: String) -> Result<(), AppError> {
    CardRepo::delete(&state.pool, &id).await?;
    Ok(())
}

async fn load_card(state: &State<'_, RuntimeState>, id: &str) -> Result<CardDto, AppError> {
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
        body_blocksuite_b64: body.body_blocksuite.as_deref().map(|b| B64.encode(b)),
        body_text: body.body_text,
        updated_at: body.updated_at,
    })
}

#[tauri::command]
pub async fn card_body_set(
    state: State<'_, RuntimeState>,
    id: String,
    body: CardBodySetDto,
) -> Result<CardDto, AppError> {
    if body.body_blocksuite_b64.is_none() && body.body_text.is_none() {
        return Err(AppError::invalid(
            "at least one of body_blocksuite_b64 or body_text is required",
        ));
    }
    let blob = match body.body_blocksuite_b64.as_deref() {
        Some(b64) => Some(B64.decode(b64.as_bytes()).map_err(|e| {
            AppError::invalid(format!("body_blocksuite_b64 is not valid base64: {e}"))
        })?),
        None => None,
    };
    CardRepo::set_body(&state.pool, &id, blob.as_deref(), body.body_text.as_deref()).await?;
    load_card(&state, &id).await
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
