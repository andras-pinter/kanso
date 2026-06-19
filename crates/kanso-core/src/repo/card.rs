use sqlx::SqlitePool;

use crate::domain::Card;
use crate::error::KansoError;
use crate::positioning;
use crate::repo::{new_id, now_ms};
use crate::Result;

pub struct CardRepo;

impl CardRepo {
    pub async fn create(pool: &SqlitePool, column_id: &str, title: &str) -> Result<Card> {
        let id = new_id();
        let now = now_ms();
        let position = positioning::between(None, None);
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

    pub async fn get(pool: &SqlitePool, id: &str) -> Result<Card> {
        sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE id = ?1")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| KansoError::NotFound {
                entity: "card",
                id: id.to_string(),
            })
    }

    pub async fn list_by_column(pool: &SqlitePool, column_id: &str) -> Result<Vec<Card>> {
        let cards = sqlx::query_as::<_, Card>(
            "SELECT * FROM cards \
             WHERE column_id = ?1 AND archived_at IS NULL \
             ORDER BY position ASC",
        )
        .bind(column_id)
        .fetch_all(pool)
        .await?;
        Ok(cards)
    }

    pub async fn set_body(
        pool: &SqlitePool,
        id: &str,
        body_blocksuite: &[u8],
        body_text: &str,
    ) -> Result<()> {
        let res =
            sqlx::query("UPDATE cards SET body_blocksuite = ?1, body_text = ?2 WHERE id = ?3")
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
        sqlx::query("UPDATE cards SET archived_at = ?1 WHERE id = ?2")
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }
}
