use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::domain::Board;
use crate::error::KansoError;
use crate::positioning;
use crate::repo::{new_id, now_ms};
use crate::Result;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BoardPatch {
    pub name: Option<String>,
    pub color: Option<Option<String>>,
}

pub struct BoardRepo;

impl BoardRepo {
    pub async fn create(pool: &SqlitePool, name: &str) -> Result<Board> {
        let last_pos: Option<(String,)> = sqlx::query_as(
            "SELECT position FROM boards ORDER BY position DESC LIMIT 1",
        )
        .fetch_optional(pool)
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
        .execute(pool)
        .await?;

        Ok(Board {
            id,
            name: name.to_string(),
            position,
            color: None,
            created_at: now,
            updated_at: now,
            archived_at: None,
        })
    }

    pub async fn get(pool: &SqlitePool, id: &str) -> Result<Option<Board>> {
        let row = sqlx::query_as::<_, Board>("SELECT * FROM boards WHERE id = ?1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
        Ok(row)
    }

    pub async fn list_all(pool: &SqlitePool, include_archived: bool) -> Result<Vec<Board>> {
        let sql = if include_archived {
            "SELECT * FROM boards ORDER BY position ASC"
        } else {
            "SELECT * FROM boards WHERE archived_at IS NULL ORDER BY position ASC"
        };
        let rows = sqlx::query_as::<_, Board>(sql).fetch_all(pool).await?;
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

    pub async fn archive(pool: &SqlitePool, id: &str) -> Result<()> {
        let now = now_ms();
        let res = sqlx::query("UPDATE boards SET archived_at = ?1, updated_at = ?1 WHERE id = ?2")
            .bind(now)
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

    pub async fn unarchive(pool: &SqlitePool, id: &str) -> Result<()> {
        let now = now_ms();
        let res =
            sqlx::query("UPDATE boards SET archived_at = NULL, updated_at = ?1 WHERE id = ?2")
                .bind(now)
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
}
