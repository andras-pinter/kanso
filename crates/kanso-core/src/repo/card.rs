use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::domain::Card;
use crate::error::KansoError;
use crate::positioning;
use crate::repo::{new_id, now_ms};
use crate::Result;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CardPatch {
    pub title: Option<String>,
    pub body_text: Option<String>,
    /// Outer `None` = leave untouched. Inner `None` = clear to NULL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_at: Option<Option<i64>>,
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
            qb.push(", body_text = ").push_bind(body_text);
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
            KansoError::InvalidMove(format!(
                "neighbour {id} not found in column {column_id}"
            ))
        })
    }

    pub async fn set_body(
        pool: &SqlitePool,
        id: &str,
        body_blocksuite: &[u8],
        body_text: &str,
    ) -> Result<()> {
        let res = sqlx::query(
            "UPDATE cards SET body_blocksuite = ?1, body_text = ?2 WHERE id = ?3",
        )
        .bind(body_blocksuite)
        .bind(body_text)
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

    pub async fn search(pool: &SqlitePool, query: &str) -> Result<Vec<Card>> {
        let cards = sqlx::query_as::<_, Card>(
            "SELECT c.* FROM cards c \
             JOIN cards_fts f ON f.rowid = c.rowid \
             WHERE cards_fts MATCH ?1 AND c.archived_at IS NULL \
             ORDER BY rank",
        )
        .bind(query)
        .fetch_all(pool)
        .await?;
        Ok(cards)
    }

    pub async fn archive(pool: &SqlitePool, id: &str) -> Result<()> {
        let now = now_ms();
        sqlx::query("UPDATE cards SET archived_at = ?1, updated_at = ?1 WHERE id = ?2")
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn unarchive(pool: &SqlitePool, id: &str) -> Result<()> {
        let now = now_ms();
        sqlx::query("UPDATE cards SET archived_at = NULL, updated_at = ?1 WHERE id = ?2")
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }
}
