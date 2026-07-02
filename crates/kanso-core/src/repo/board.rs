use std::collections::{BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Sqlite, SqlitePool};

use crate::domain::{Board, Card, Column, Tag};
use crate::error::KansoError;
use crate::positioning;
use crate::repo::{new_id, now_ms, CardRepo, ColumnRepo};
use crate::Result;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BoardPatch {
    pub name: Option<String>,
    pub color: Option<Option<String>>,
}

/// Card plus the tag IDs linked to it. Tag rows themselves live in
/// [`BoardFull::tags`] so callers can dedupe lookup.
#[derive(Debug, Clone)]
pub struct CardWithTagIds {
    pub card: Card,
    pub tag_ids: Vec<String>,
}

/// Column plus its cards (already ordered).
#[derive(Debug, Clone)]
pub struct ColumnWithCards {
    pub column: Column,
    pub cards: Vec<CardWithTagIds>,
}

/// Full board snapshot: board + columns (with nested cards) + deduped tags
/// referenced by the cards.
#[derive(Debug, Clone)]
pub struct BoardFull {
    pub board: Board,
    pub columns: Vec<ColumnWithCards>,
    pub tags: Vec<Tag>,
}

/// Hard cap on total cards in a single full-board snapshot. Above this we
/// return [`KansoError::Conflict`] instead of streaming a giant payload.
const FULL_BOARD_CARD_CAP: i64 = 1000;

pub struct BoardRepo;

impl BoardRepo {
    /// Create a board plus its four fixed columns (Incoming / Todo /
    /// In Progress / Done) in a single transaction. If seeding the columns
    /// fails, the board insert is rolled back.
    pub async fn create(pool: &SqlitePool, name: &str) -> Result<Board> {
        let mut tx = pool.begin().await?;

        let last_pos: Option<(String,)> =
            sqlx::query_as("SELECT position FROM boards ORDER BY position DESC LIMIT 1")
                .fetch_optional(&mut *tx)
                .await?;
        let position = positioning::between(last_pos.as_ref().map(|(p,)| p.as_str()), None);

        let id = new_id();
        let now = now_ms();
        sqlx::query(
            "INSERT INTO boards (id, name, position, color, created_at, updated_at) \
             VALUES (?1, ?2, ?3, NULL, ?4, ?4)",
        )
        .bind(&id)
        .bind(name)
        .bind(&position)
        .bind(now)
        .execute(&mut *tx)
        .await?;

        ColumnRepo::seed_fixed_columns(&mut tx, &id, now).await?;

        tx.commit().await?;

        Ok(Board {
            id,
            name: name.to_string(),
            position,
            color: None,
            created_at: now,
            updated_at: now,
        })
    }

    pub async fn get(pool: &SqlitePool, id: &str) -> Result<Option<Board>> {
        let row = sqlx::query_as::<_, Board>("SELECT * FROM boards WHERE id = ?1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
        Ok(row)
    }

    pub async fn list_all(pool: &SqlitePool) -> Result<Vec<Board>> {
        let rows =
            sqlx::query_as::<_, Board>("SELECT * FROM boards ORDER BY position ASC, id ASC")
                .fetch_all(pool)
                .await?;
        Ok(rows)
    }

    /// Paginated form of [`list_all`]. The HTTP layer clamps `limit` upstream;
    /// repos take whatever they're given and trust the caller to bound it.
    pub async fn list_all_paged(
        pool: &SqlitePool,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Board>> {
        let rows = sqlx::query_as::<_, Board>(
            "SELECT * FROM boards ORDER BY position ASC, id ASC LIMIT ?1 OFFSET ?2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    pub async fn update(pool: &SqlitePool, id: &str, patch: BoardPatch) -> Result<Board> {
        let now = now_ms();
        let mut qb = sqlx::QueryBuilder::new("UPDATE boards SET updated_at = ");
        qb.push_bind(now);
        if let Some(name) = &patch.name {
            qb.push(", name = ").push_bind(name);
        }
        if let Some(color) = &patch.color {
            qb.push(", color = ").push_bind(color.as_ref());
        }
        qb.push(" WHERE id = ").push_bind(id);
        let res = qb.build().execute(pool).await?;
        if res.rows_affected() == 0 {
            return Err(KansoError::NotFound {
                entity: "board",
                id: id.to_string(),
            });
        }
        Self::get(pool, id)
            .await?
            .ok_or_else(|| KansoError::NotFound {
                entity: "board",
                id: id.to_string(),
            })
    }

    /// Hard delete. Cascades to columns and cards via ON DELETE CASCADE.
    pub async fn hard_delete(pool: &SqlitePool, id: &str) -> Result<()> {
        let res = sqlx::query("DELETE FROM boards WHERE id = ?1")
            .bind(id)
            .execute(pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(KansoError::NotFound {
                entity: "board",
                id: id.to_string(),
            });
        }
        Ok(())
    }

    /// Single-shot snapshot of a board with all its columns, cards, and the
    /// deduped set of tags referenced by those cards.
    ///
    /// Refuses with [`KansoError::Conflict`] when the board would yield more
    /// than [`FULL_BOARD_CARD_CAP`] cards. Returns [`KansoError::NotFound`]
    /// when `id` is unknown.
    pub async fn full_with_context(pool: &SqlitePool, id: &str) -> Result<BoardFull> {
        let mut tx = pool.begin().await?;

        let board: Board = sqlx::query_as::<_, Board>("SELECT * FROM boards WHERE id = ?1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| KansoError::NotFound {
                entity: "board",
                id: id.to_string(),
            })?;

        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM cards c \
             JOIN columns col ON col.id = c.column_id \
             WHERE col.board_id = ?1",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        if count > FULL_BOARD_CARD_CAP {
            return Err(KansoError::Conflict(format!(
                "board too large (>{FULL_BOARD_CARD_CAP} cards)"
            )));
        }

        let columns: Vec<Column> = sqlx::query_as::<_, Column>(
            "SELECT * FROM columns WHERE board_id = ?1 ORDER BY position ASC, id ASC",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;

        let cards: Vec<Card> = sqlx::query_as::<_, Card>(
            "SELECT c.* FROM cards c \
             JOIN columns col ON col.id = c.column_id \
             WHERE col.board_id = ?1 \
             ORDER BY col.position ASC, col.id ASC, c.position ASC, c.id ASC",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;

        let links = CardRepo::card_tags_for_board(&mut *tx, id).await?;
        let mut tag_ids_by_card: HashMap<String, Vec<String>> = HashMap::new();
        let mut needed_tag_ids: BTreeSet<String> = BTreeSet::new();
        for (card_id, tag_id) in links {
            needed_tag_ids.insert(tag_id.clone());
            tag_ids_by_card.entry(card_id).or_default().push(tag_id);
        }

        let tags = fetch_tags_by_ids(&mut *tx, &needed_tag_ids).await?;

        // Read-only transaction; nothing to commit.
        drop(tx);

        let mut cards_by_column: HashMap<String, Vec<CardWithTagIds>> = HashMap::new();
        for card in cards {
            let tag_ids = tag_ids_by_card.remove(&card.id).unwrap_or_default();
            cards_by_column
                .entry(card.column_id.clone())
                .or_default()
                .push(CardWithTagIds { card, tag_ids });
        }

        let columns = columns
            .into_iter()
            .map(|column| {
                let cards = cards_by_column.remove(&column.id).unwrap_or_default();
                ColumnWithCards { column, cards }
            })
            .collect();

        Ok(BoardFull {
            board,
            columns,
            tags,
        })
    }
}

// Suppress unused-parameter lint from `_` names in QueryBuilder pathway.
#[allow(clippy::needless_lifetimes)]
async fn fetch_tags_by_ids<'e, E>(executor: E, ids: &BTreeSet<String>) -> Result<Vec<Tag>>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new("SELECT * FROM tags WHERE id IN (");
    let mut sep = qb.separated(", ");
    for id in ids {
        sep.push_bind(id);
    }
    qb.push(") ORDER BY name COLLATE NOCASE ASC, id ASC");
    let rows = qb.build_query_as::<Tag>().fetch_all(executor).await?;
    Ok(rows)
}
