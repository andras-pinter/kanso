use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::domain::Column;
use crate::error::KansoError;
use crate::positioning;
use crate::repo::{new_id, now_ms};
use crate::Result;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ColumnPatch {
    pub name: Option<String>,
    pub color: Option<Option<String>>,
}

pub struct ColumnRepo;

impl ColumnRepo {
    pub async fn create(
        pool: &SqlitePool,
        board_id: &str,
        name: &str,
        color: Option<&str>,
    ) -> Result<Column> {
        let last_pos: Option<(String,)> = sqlx::query_as(
            "SELECT position FROM columns WHERE board_id = ?1 ORDER BY position DESC LIMIT 1",
        )
        .bind(board_id)
        .fetch_optional(pool)
        .await?;
        let position = positioning::between(last_pos.as_ref().map(|(p,)| p.as_str()), None);

        let id = new_id();
        let now = now_ms();
        sqlx::query(
            "INSERT INTO columns (id, board_id, name, position, color, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        )
        .bind(&id)
        .bind(board_id)
        .bind(name)
        .bind(&position)
        .bind(color)
        .bind(now)
        .execute(pool)
        .await?;

        Ok(Column {
            id,
            board_id: board_id.to_string(),
            name: name.to_string(),
            position,
            color: color.map(|s| s.to_string()),
            created_at: now,
            updated_at: now,
            archived_at: None,
        })
    }

    pub async fn get(pool: &SqlitePool, id: &str) -> Result<Option<Column>> {
        let row = sqlx::query_as::<_, Column>("SELECT * FROM columns WHERE id = ?1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
        Ok(row)
    }

    pub async fn list_by_board(pool: &SqlitePool, board_id: &str) -> Result<Vec<Column>> {
        let rows = sqlx::query_as::<_, Column>(
            "SELECT * FROM columns \
             WHERE board_id = ?1 AND archived_at IS NULL \
             ORDER BY position ASC",
        )
        .bind(board_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    pub async fn update(pool: &SqlitePool, id: &str, patch: ColumnPatch) -> Result<Column> {
        let now = now_ms();
        let mut qb = sqlx::QueryBuilder::new("UPDATE columns SET updated_at = ");
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
                entity: "column",
                id: id.to_string(),
            });
        }
        Self::get(pool, id)
            .await?
            .ok_or_else(|| KansoError::NotFound {
                entity: "column",
                id: id.to_string(),
            })
    }

    pub async fn archive(pool: &SqlitePool, id: &str) -> Result<()> {
        let now = now_ms();
        sqlx::query("UPDATE columns SET archived_at = ?1, updated_at = ?1 WHERE id = ?2")
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn unarchive(pool: &SqlitePool, id: &str) -> Result<()> {
        let now = now_ms();
        sqlx::query("UPDATE columns SET archived_at = NULL, updated_at = ?1 WHERE id = ?2")
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }
}
