use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::domain::{Card, Tag};
use crate::error::KansoError;
use crate::positioning;
use crate::repo::{new_id, now_ms};
use crate::Result;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CardPatch {
    pub title: Option<String>,
    /// Outer `None` = leave untouched. Inner `None` = clear to NULL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_text: Option<Option<String>>,
    /// Outer `None` = leave untouched. Inner `None` = clear to NULL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_at: Option<Option<i64>>,
}

/// Snapshot of a card's body columns. `None` blobs mean the card has never
/// had its body set; callers should mount an empty editor in that case.
#[derive(Debug, Clone)]
pub struct CardBody {
    pub body_blocksuite: Option<Vec<u8>>,
    pub body_text: Option<String>,
    pub updated_at: i64,
}

pub struct CardRepo;

impl CardRepo {
    pub async fn create(pool: &SqlitePool, column_id: &str, title: &str) -> Result<Card> {
        let last_pos: Option<(String,)> = sqlx::query_as(
            "SELECT position FROM cards WHERE column_id = ?1 ORDER BY position DESC LIMIT 1",
        )
        .bind(column_id)
        .fetch_optional(pool)
        .await?;
        let position = positioning::between(last_pos.as_ref().map(|(p,)| p.as_str()), None);

        let id = new_id();
        let now = now_ms();
        sqlx::query(
            "INSERT INTO cards (id, column_id, title, body_blocksuite, body_text, position, \
             due_at, created_at, updated_at) \
             VALUES (?1, ?2, ?3, NULL, NULL, ?4, NULL, ?5, ?5)",
        )
        .bind(&id)
        .bind(column_id)
        .bind(title)
        .bind(&position)
        .bind(now)
        .execute(pool)
        .await?;

        Ok(Card {
            id,
            column_id: column_id.to_string(),
            title: title.to_string(),
            body_blocksuite: None,
            body_text: None,
            position,
            due_at: None,
            created_at: now,
            updated_at: now,
            archived_at: None,
        })
    }

    pub async fn get(pool: &SqlitePool, id: &str) -> Result<Option<Card>> {
        let row = sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE id = ?1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
        Ok(row)
    }

    pub async fn list_by_column(
        pool: &SqlitePool,
        column_id: &str,
        include_archived: bool,
    ) -> Result<Vec<Card>> {
        let sql = if include_archived {
            "SELECT * FROM cards WHERE column_id = ?1 ORDER BY position ASC"
        } else {
            "SELECT * FROM cards WHERE column_id = ?1 AND archived_at IS NULL ORDER BY position ASC"
        };
        let rows = sqlx::query_as::<_, Card>(sql)
            .bind(column_id)
            .fetch_all(pool)
            .await?;
        Ok(rows)
    }

    pub async fn update(pool: &SqlitePool, id: &str, patch: CardPatch) -> Result<Card> {
        let now = now_ms();
        let mut qb = sqlx::QueryBuilder::new("UPDATE cards SET updated_at = ");
        qb.push_bind(now);
        if let Some(title) = &patch.title {
            qb.push(", title = ").push_bind(title);
        }
        if let Some(body_text) = &patch.body_text {
            qb.push(", body_text = ").push_bind(body_text.as_ref());
        }
        if let Some(due_at) = patch.due_at {
            qb.push(", due_at = ").push_bind(due_at);
        }
        qb.push(" WHERE id = ").push_bind(id);
        let res = qb.build().execute(pool).await?;
        if res.rows_affected() == 0 {
            return Err(KansoError::NotFound {
                entity: "card",
                id: id.to_string(),
            });
        }
        Self::get(pool, id)
            .await?
            .ok_or_else(|| KansoError::NotFound {
                entity: "card",
                id: id.to_string(),
            })
    }

    /// Move `card_id` into `target_column_id` at the slot between `before`
    /// and `after`. Either neighbour may be `None` (append/prepend). When both
    /// are given they must be adjacent in the target column.
    ///
    /// Wrapped in a transaction so the neighbour read and the move write are
    /// atomic against concurrent moves on the same connection.
    pub async fn move_card(
        pool: &SqlitePool,
        card_id: &str,
        target_column_id: &str,
        before: Option<&str>,
        after: Option<&str>,
    ) -> Result<Card> {
        let mut tx = pool.begin().await?;

        let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM cards WHERE id = ?1")
            .bind(card_id)
            .fetch_optional(&mut *tx)
            .await?;
        if exists.is_none() {
            return Err(KansoError::NotFound {
                entity: "card",
                id: card_id.to_string(),
            });
        }

        let before_pos = match before {
            Some(id) => Some(Self::neighbour_position(&mut tx, target_column_id, id).await?),
            None => None,
        };
        let after_pos = match after {
            Some(id) => Some(Self::neighbour_position(&mut tx, target_column_id, id).await?),
            None => None,
        };

        let prev_pos: Option<String>;
        let next_pos: Option<String>;
        match (before_pos.as_deref(), after_pos.as_deref()) {
            (Some(b), Some(a)) => {
                if b >= a {
                    return Err(KansoError::InvalidMove(
                        "before must precede after in the target column".into(),
                    ));
                }
                let between_b_and_a: Option<(String,)> = sqlx::query_as(
                    "SELECT position FROM cards \
                     WHERE column_id = ?1 AND archived_at IS NULL \
                       AND position > ?2 AND position < ?3 AND id != ?4 \
                     LIMIT 1",
                )
                .bind(target_column_id)
                .bind(b)
                .bind(a)
                .bind(card_id)
                .fetch_optional(&mut *tx)
                .await?;
                if between_b_and_a.is_some() {
                    return Err(KansoError::InvalidMove(
                        "before and after are not adjacent".into(),
                    ));
                }
                prev_pos = Some(b.to_string());
                next_pos = Some(a.to_string());
            }
            (Some(b), None) => {
                let next: Option<(String,)> = sqlx::query_as(
                    "SELECT position FROM cards \
                     WHERE column_id = ?1 AND archived_at IS NULL \
                       AND position > ?2 AND id != ?3 \
                     ORDER BY position ASC LIMIT 1",
                )
                .bind(target_column_id)
                .bind(b)
                .bind(card_id)
                .fetch_optional(&mut *tx)
                .await?;
                prev_pos = Some(b.to_string());
                next_pos = next.map(|(p,)| p);
            }
            (None, Some(a)) => {
                let prev: Option<(String,)> = sqlx::query_as(
                    "SELECT position FROM cards \
                     WHERE column_id = ?1 AND archived_at IS NULL \
                       AND position < ?2 AND id != ?3 \
                     ORDER BY position DESC LIMIT 1",
                )
                .bind(target_column_id)
                .bind(a)
                .bind(card_id)
                .fetch_optional(&mut *tx)
                .await?;
                prev_pos = prev.map(|(p,)| p);
                next_pos = Some(a.to_string());
            }
            (None, None) => {
                // Append: take the current last position in the target column,
                // excluding the moved card itself.
                let last: Option<(String,)> = sqlx::query_as(
                    "SELECT position FROM cards \
                     WHERE column_id = ?1 AND archived_at IS NULL AND id != ?2 \
                     ORDER BY position DESC LIMIT 1",
                )
                .bind(target_column_id)
                .bind(card_id)
                .fetch_optional(&mut *tx)
                .await?;
                prev_pos = last.map(|(p,)| p);
                next_pos = None;
            }
        }

        let new_pos = positioning::between(prev_pos.as_deref(), next_pos.as_deref());
        let now = now_ms();
        sqlx::query(
            "UPDATE cards SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
        )
        .bind(target_column_id)
        .bind(&new_pos)
        .bind(now)
        .bind(card_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        Self::get(pool, card_id)
            .await?
            .ok_or_else(|| KansoError::NotFound {
                entity: "card",
                id: card_id.to_string(),
            })
    }

    async fn neighbour_position(
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        column_id: &str,
        id: &str,
    ) -> Result<String> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT position FROM cards WHERE id = ?1 AND column_id = ?2")
                .bind(id)
                .bind(column_id)
                .fetch_optional(&mut **tx)
                .await?;
        row.map(|(p,)| p).ok_or_else(|| {
            KansoError::InvalidMove(format!("neighbour {id} not found in column {column_id}"))
        })
    }

    /// Atomically write both columns of a card body and bump `updated_at`.
    /// Returns `NotFound` if `id` does not exist.
    pub async fn set_body(
        pool: &SqlitePool,
        id: &str,
        body_blocksuite: &[u8],
        body_text: &str,
    ) -> Result<()> {
        let now = now_ms();
        let mut tx = pool.begin().await?;
        let res = sqlx::query(
            "UPDATE cards SET body_blocksuite = ?1, body_text = ?2, updated_at = ?3 \
             WHERE id = ?4",
        )
        .bind(body_blocksuite)
        .bind(body_text)
        .bind(now)
        .bind(id)
        .execute(&mut *tx)
        .await?;

        if res.rows_affected() == 0 {
            return Err(KansoError::NotFound {
                entity: "card",
                id: id.to_string(),
            });
        }
        tx.commit().await?;
        Ok(())
    }

    /// Read the raw Yjs blob, plaintext, and current `updated_at` for `id`.
    /// `NotFound` if the card doesn't exist; both blob columns may be `None`
    /// on a card that has never had its body set.
    pub async fn get_body(pool: &SqlitePool, id: &str) -> Result<CardBody> {
        let row: Option<(Option<Vec<u8>>, Option<String>, i64)> = sqlx::query_as(
            "SELECT body_blocksuite, body_text, updated_at FROM cards WHERE id = ?1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;
        match row {
            Some((blob, text, updated_at)) => Ok(CardBody {
                body_blocksuite: blob,
                body_text: text,
                updated_at,
            }),
            None => Err(KansoError::NotFound {
                entity: "card",
                id: id.to_string(),
            }),
        }
    }

    pub async fn search(
        pool: &SqlitePool,
        query: &str,
        include_archived: bool,
    ) -> Result<Vec<Card>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let match_expr = fts5_quote(trimmed);
        let sql = if include_archived {
            "SELECT c.* FROM cards c \
             JOIN cards_fts f ON f.rowid = c.rowid \
             WHERE cards_fts MATCH ?1 \
             ORDER BY rank"
        } else {
            "SELECT c.* FROM cards c \
             JOIN cards_fts f ON f.rowid = c.rowid \
             WHERE cards_fts MATCH ?1 AND c.archived_at IS NULL \
             ORDER BY rank"
        };
        let cards = sqlx::query_as::<_, Card>(sql)
            .bind(match_expr)
            .fetch_all(pool)
            .await?;
        Ok(cards)
    }

    /// Idempotently associate `card_id` with `tag_id`. Both entities must
    /// exist; otherwise returns `NotFound`. Re-linking is a no-op.
    pub async fn add_tag(pool: &SqlitePool, card_id: &str, tag_id: &str) -> Result<()> {
        let mut tx = pool.begin().await?;
        ensure_exists(&mut tx, "cards", "card", card_id).await?;
        ensure_exists(&mut tx, "tags", "tag", tag_id).await?;
        sqlx::query("INSERT OR IGNORE INTO card_tags (card_id, tag_id) VALUES (?1, ?2)")
            .bind(card_id)
            .bind(tag_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    /// Idempotently drop the (card, tag) link. Returns `NotFound` only when
    /// `card_id` or `tag_id` themselves do not exist; missing links succeed.
    pub async fn remove_tag(pool: &SqlitePool, card_id: &str, tag_id: &str) -> Result<()> {
        let mut tx = pool.begin().await?;
        ensure_exists(&mut tx, "cards", "card", card_id).await?;
        ensure_exists(&mut tx, "tags", "tag", tag_id).await?;
        sqlx::query("DELETE FROM card_tags WHERE card_id = ?1 AND tag_id = ?2")
            .bind(card_id)
            .bind(tag_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    /// Tags currently linked to `card_id`, alphabetised. `NotFound` if the
    /// card does not exist.
    pub async fn tags_for_card(pool: &SqlitePool, card_id: &str) -> Result<Vec<Tag>> {
        let mut tx = pool.begin().await?;
        ensure_exists(&mut tx, "cards", "card", card_id).await?;
        let rows = sqlx::query_as::<_, Tag>(
            "SELECT t.* FROM tags t \
             JOIN card_tags ct ON ct.tag_id = t.id \
             WHERE ct.card_id = ?1 \
             ORDER BY t.name COLLATE NOCASE ASC",
        )
        .bind(card_id)
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(rows)
    }

    /// Cards linked to `tag_id`, ordered by column then position. `NotFound`
    /// if the tag does not exist.
    pub async fn cards_with_tag(
        pool: &SqlitePool,
        tag_id: &str,
        include_archived: bool,
    ) -> Result<Vec<Card>> {
        let mut tx = pool.begin().await?;
        ensure_exists(&mut tx, "tags", "tag", tag_id).await?;
        let sql = if include_archived {
            "SELECT c.* FROM cards c \
             JOIN card_tags ct ON ct.card_id = c.id \
             WHERE ct.tag_id = ?1 \
             ORDER BY c.column_id ASC, c.position ASC"
        } else {
            "SELECT c.* FROM cards c \
             JOIN card_tags ct ON ct.card_id = c.id \
             WHERE ct.tag_id = ?1 AND c.archived_at IS NULL \
             ORDER BY c.column_id ASC, c.position ASC"
        };
        let rows = sqlx::query_as::<_, Card>(sql)
            .bind(tag_id)
            .fetch_all(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(rows)
    }

    pub async fn archive(pool: &SqlitePool, id: &str) -> Result<()> {
        let now = now_ms();
        let res = sqlx::query("UPDATE cards SET archived_at = ?1, updated_at = ?1 WHERE id = ?2")
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(KansoError::NotFound {
                entity: "card",
                id: id.to_string(),
            });
        }
        Ok(())
    }

    pub async fn unarchive(pool: &SqlitePool, id: &str) -> Result<()> {
        let now = now_ms();
        let res = sqlx::query("UPDATE cards SET archived_at = NULL, updated_at = ?1 WHERE id = ?2")
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(KansoError::NotFound {
                entity: "card",
                id: id.to_string(),
            });
        }
        Ok(())
    }
}

async fn ensure_exists(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    table: &str,
    entity: &'static str,
    id: &str,
) -> Result<()> {
    let sql = format!("SELECT 1 FROM {table} WHERE id = ?1");
    let row: Option<(i64,)> = sqlx::query_as(&sql)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?;
    if row.is_none() {
        return Err(KansoError::NotFound {
            entity,
            id: id.to_string(),
        });
    }
    Ok(())
}

/// Wrap user input as a single FTS5 quoted phrase. FTS5 strings are escaped
/// by doubling embedded double quotes. This neutralises FTS5 operators
/// (`AND`, `OR`, `NOT`, `NEAR`, `*`, parens, column filters) so callers get
/// substring-style matching of the typed phrase.
fn fts5_quote(s: &str) -> String {
    let escaped = s.replace('"', "\"\"");
    format!("\"{escaped}\"")
}
