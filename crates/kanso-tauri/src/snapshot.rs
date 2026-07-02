use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use kanso_core::domain::{Board, Card, Column, Tag};
use kanso_core::repo::{BoardRepo, CardRepo, ColumnRepo, TagRepo};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;
use thiserror::Error;

use crate::error::AppError;
use crate::RuntimeState;

const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotEnvelope {
    pub schema_version: u32,
    pub exported_at: String,
    pub data: SnapshotData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotData {
    pub boards: Vec<Board>,
    pub columns: Vec<Column>,
    pub cards: Vec<CardSnapshot>,
    pub tags: Vec<Tag>,
    pub card_tags: Vec<CardTagSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardSnapshot {
    pub id: String,
    pub column_id: String,
    pub title: String,
    pub body_blocksuite: Option<String>,
    pub body_text: Option<String>,
    pub position: String,
    pub due_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardTagSnapshot {
    pub card_id: String,
    pub tag_id: String,
}

#[derive(Debug, Error)]
pub enum SnapshotError {
    #[error("invalid export JSON: {0}")]
    Json(#[from] serde_json::Error),

    #[error("unsupported export schema_version {actual}; expected {expected}")]
    UnsupportedSchemaVersion { actual: u32, expected: u32 },

    #[error("card {card_id} body_blocksuite is not valid base64: {source}")]
    InvalidBase64 {
        card_id: String,
        source: base64::DecodeError,
    },

    #[error("snapshot database error: {0}")]
    Db(#[from] sqlx::Error),

    #[error("snapshot data error: {0}")]
    Core(#[from] kanso_core::KansoError),
}

struct DecodedCard {
    id: String,
    column_id: String,
    title: String,
    body_blocksuite: Option<Vec<u8>>,
    body_text: Option<String>,
    position: String,
    due_at: Option<i64>,
    created_at: i64,
    updated_at: i64,
}

#[tauri::command]
pub async fn export_data(state: State<'_, RuntimeState>) -> Result<SnapshotEnvelope, AppError> {
    Ok(export_snapshot(&state.pool, crate::time::now_iso_utc()).await?)
}

#[tauri::command]
pub async fn import_data(
    state: State<'_, RuntimeState>,
    json_string: String,
) -> Result<(), AppError> {
    import_snapshot_json(&state.pool, &json_string).await?;
    Ok(())
}

#[tauri::command]
pub async fn write_export_file(path: PathBuf, json_string: String) -> Result<(), AppError> {
    tokio::fs::write(&path, json_string)
        .await
        .map_err(|e| AppError::io(format!("write export file {path:?}: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn read_import_file(path: PathBuf) -> Result<String, AppError> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| AppError::io(format!("read import file {path:?}: {e}")))
}

pub async fn export_snapshot(
    pool: &SqlitePool,
    exported_at: String,
) -> Result<SnapshotEnvelope, SnapshotError> {
    let cards = CardRepo::list_all(pool)
        .await?
        .into_iter()
        .map(CardSnapshot::from)
        .collect();
    let card_tags = CardRepo::card_tags_all(pool)
        .await?
        .into_iter()
        .map(|(card_id, tag_id)| CardTagSnapshot { card_id, tag_id })
        .collect();

    Ok(SnapshotEnvelope {
        schema_version: SCHEMA_VERSION,
        exported_at,
        data: SnapshotData {
            boards: BoardRepo::list_all(pool).await?,
            columns: ColumnRepo::list_all(pool).await?,
            cards,
            tags: TagRepo::list(pool).await?,
            card_tags,
        },
    })
}

pub async fn import_snapshot_json(pool: &SqlitePool, json: &str) -> Result<(), SnapshotError> {
    let snapshot: SnapshotEnvelope = serde_json::from_str(json)?;
    if snapshot.schema_version != SCHEMA_VERSION {
        return Err(SnapshotError::UnsupportedSchemaVersion {
            actual: snapshot.schema_version,
            expected: SCHEMA_VERSION,
        });
    }

    let cards = decode_cards(snapshot.data.cards)?;
    let mut tx = pool.begin().await?;

    sqlx::query("DELETE FROM card_tags")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM cards").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM columns").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM tags").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM boards").execute(&mut *tx).await?;

    for board in snapshot.data.boards {
        sqlx::query(
            "INSERT INTO boards (id, name, position, color, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(board.id)
        .bind(board.name)
        .bind(board.position)
        .bind(board.color)
        .bind(board.created_at)
        .bind(board.updated_at)
        .execute(&mut *tx)
        .await?;
    }

    for column in snapshot.data.columns {
        sqlx::query(
            "INSERT INTO columns \
             (id, board_id, name, position, color, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(column.id)
        .bind(column.board_id)
        .bind(column.name)
        .bind(column.position)
        .bind(column.color)
        .bind(column.created_at)
        .bind(column.updated_at)
        .execute(&mut *tx)
        .await?;
    }

    for tag in snapshot.data.tags {
        sqlx::query(
            "INSERT INTO tags (id, name, color, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(tag.id)
        .bind(tag.name)
        .bind(tag.color)
        .bind(tag.created_at)
        .bind(tag.updated_at)
        .execute(&mut *tx)
        .await?;
    }

    for card in cards {
        sqlx::query(
            "INSERT INTO cards \
             (id, column_id, title, body_blocksuite, body_text, position, due_at, created_at, \
              updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .bind(card.id)
        .bind(card.column_id)
        .bind(card.title)
        .bind(card.body_blocksuite)
        .bind(card.body_text)
        .bind(card.position)
        .bind(card.due_at)
        .bind(card.created_at)
        .bind(card.updated_at)
        .execute(&mut *tx)
        .await?;
    }

    for link in snapshot.data.card_tags {
        sqlx::query("INSERT INTO card_tags (card_id, tag_id) VALUES (?1, ?2)")
            .bind(link.card_id)
            .bind(link.tag_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}

fn decode_cards(cards: Vec<CardSnapshot>) -> Result<Vec<DecodedCard>, SnapshotError> {
    cards
        .into_iter()
        .map(|card| {
            let body_blocksuite = card
                .body_blocksuite
                .map(|blob| {
                    B64.decode(blob.as_bytes())
                        .map_err(|source| SnapshotError::InvalidBase64 {
                            card_id: card.id.clone(),
                            source,
                        })
                })
                .transpose()?;
            Ok(DecodedCard {
                id: card.id,
                column_id: card.column_id,
                title: card.title,
                body_blocksuite,
                body_text: card.body_text,
                position: card.position,
                due_at: card.due_at,
                created_at: card.created_at,
                updated_at: card.updated_at,
            })
        })
        .collect()
}

impl From<Card> for CardSnapshot {
    fn from(card: Card) -> Self {
        Self {
            id: card.id,
            column_id: card.column_id,
            title: card.title,
            body_blocksuite: card.body_blocksuite.map(|b| B64.encode(b)),
            body_text: card.body_text,
            position: card.position,
            due_at: card.due_at,
            created_at: card.created_at,
            updated_at: card.updated_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kanso_core::repo::{BoardRepo, CardRepo, ColumnRepo, TagRepo};

    async fn setup() -> SqlitePool {
        let pool = kanso_core::db::open_memory().await.expect("open");
        kanso_core::db::migrate(&pool).await.expect("migrate");
        pool
    }

    #[tokio::test]
    async fn export_import_round_trips_data() {
        let pool = setup().await;
        let board = BoardRepo::create(&pool, "Infra").await.expect("board");
        let column = ColumnRepo::list_by_board(&pool, &board.id)
            .await
            .expect("columns")
            .into_iter()
            .next()
            .expect("seeded column");
        let card = CardRepo::create(&pool, &column.id, "Backup launch DB")
            .await
            .expect("card");
        CardRepo::set_body(&pool, &card.id, Some(b"yjs bytes"), Some("body text"))
            .await
            .expect("body");
        let tag = TagRepo::create(&pool, "safe", Some("#9ece6a"))
            .await
            .expect("tag");
        CardRepo::add_tag(&pool, &card.id, &tag.id)
            .await
            .expect("tag link");

        let first = export_snapshot(&pool, "2026-06-22T08:00:00Z".into())
            .await
            .expect("export");
        let json = serde_json::to_string(&first).expect("json");

        let fresh = setup().await;
        import_snapshot_json(&fresh, &json).await.expect("import");
        let second = export_snapshot(&fresh, "2026-06-22T09:00:00Z".into())
            .await
            .expect("export again");

        assert_eq!(first.schema_version, second.schema_version);
        assert_eq!(
            serde_json::to_value(&first.data).expect("first data json"),
            serde_json::to_value(&second.data).expect("second data json")
        );
    }

    #[tokio::test]
    async fn import_rejects_bad_schema_version() {
        let pool = setup().await;
        let json = r#"{"schema_version":999,"exported_at":"2026-06-22T08:00:00Z","data":{"boards":[],"columns":[],"cards":[],"tags":[],"card_tags":[]}}"#;
        let err = import_snapshot_json(&pool, json).await.expect_err("schema");

        assert!(matches!(
            err,
            SnapshotError::UnsupportedSchemaVersion {
                actual: 999,
                expected: 1
            }
        ));
    }
}
