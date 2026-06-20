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

    pub async fn list_by_board(
        pool: &SqlitePool,
        board_id: &str,
        include_archived: bool,
    ) -> Result<Vec<Column>> {
        let sql = if include_archived {
            "SELECT * FROM columns WHERE board_id = ?1 ORDER BY position ASC"
        } else {
            "SELECT * FROM columns \
             WHERE board_id = ?1 AND archived_at IS NULL \
             ORDER BY position ASC"
        };
        let rows = sqlx::query_as::<_, Column>(sql)
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
        let res = sqlx::query("UPDATE columns SET archived_at = ?1, updated_at = ?1 WHERE id = ?2")
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(KansoError::NotFound {
                entity: "column",
                id: id.to_string(),
            });
        }
        Ok(())
    }

    pub async fn unarchive(pool: &SqlitePool, id: &str) -> Result<()> {
        let now = now_ms();
        let res =
            sqlx::query("UPDATE columns SET archived_at = NULL, updated_at = ?1 WHERE id = ?2")
                .bind(now)
                .bind(id)
                .execute(pool)
                .await?;
        if res.rows_affected() == 0 {
            return Err(KansoError::NotFound {
                entity: "column",
                id: id.to_string(),
            });
        }
        Ok(())
    }

    /// Reorder a column within its board between two neighbours. `before`
    /// and `after` are sibling column ids in the same board. Mirrors the
    /// neighbour-based semantics of [`super::CardRepo::move_card`] so the
    /// frontend uses the same drag-and-drop pattern for both rows and
    /// columns.
    pub async fn move_column(
        pool: &SqlitePool,
        column_id: &str,
        before: Option<&str>,
        after: Option<&str>,
    ) -> Result<Column> {
        let mut tx = pool.begin().await?;

        let board_id: Option<(String,)> =
            sqlx::query_as("SELECT board_id FROM columns WHERE id = ?1")
                .bind(column_id)
                .fetch_optional(&mut *tx)
                .await?;
        let board_id = board_id.map(|(b,)| b).ok_or_else(|| KansoError::NotFound {
            entity: "column",
            id: column_id.to_string(),
        })?;

        let before_pos = match before {
            Some(id) => Some(Self::neighbour_position(&mut tx, &board_id, id).await?),
            None => None,
        };
        let after_pos = match after {
            Some(id) => Some(Self::neighbour_position(&mut tx, &board_id, id).await?),
            None => None,
        };

        let prev_pos: Option<String>;
        let next_pos: Option<String>;
        match (before_pos.as_deref(), after_pos.as_deref()) {
            (Some(b), Some(a)) => {
                if b >= a {
                    return Err(KansoError::InvalidMove(
                        "before must precede after in the board".into(),
                    ));
                }
                let between: Option<(String,)> = sqlx::query_as(
                    "SELECT position FROM columns \
                     WHERE board_id = ?1 AND archived_at IS NULL \
                       AND position > ?2 AND position < ?3 AND id != ?4 \
                     LIMIT 1",
                )
                .bind(&board_id)
                .bind(b)
                .bind(a)
                .bind(column_id)
                .fetch_optional(&mut *tx)
                .await?;
                if between.is_some() {
                    return Err(KansoError::InvalidMove(
                        "before and after are not adjacent".into(),
                    ));
                }
                prev_pos = Some(b.to_string());
                next_pos = Some(a.to_string());
            }
            (Some(b), None) => {
                let next: Option<(String,)> = sqlx::query_as(
                    "SELECT position FROM columns \
                     WHERE board_id = ?1 AND archived_at IS NULL \
                       AND position > ?2 AND id != ?3 \
                     ORDER BY position ASC LIMIT 1",
                )
                .bind(&board_id)
                .bind(b)
                .bind(column_id)
                .fetch_optional(&mut *tx)
                .await?;
                prev_pos = Some(b.to_string());
                next_pos = next.map(|(p,)| p);
            }
            (None, Some(a)) => {
                let prev: Option<(String,)> = sqlx::query_as(
                    "SELECT position FROM columns \
                     WHERE board_id = ?1 AND archived_at IS NULL \
                       AND position < ?2 AND id != ?3 \
                     ORDER BY position DESC LIMIT 1",
                )
                .bind(&board_id)
                .bind(a)
                .bind(column_id)
                .fetch_optional(&mut *tx)
                .await?;
                prev_pos = prev.map(|(p,)| p);
                next_pos = Some(a.to_string());
            }
            (None, None) => {
                let last: Option<(String,)> = sqlx::query_as(
                    "SELECT position FROM columns \
                     WHERE board_id = ?1 AND archived_at IS NULL AND id != ?2 \
                     ORDER BY position DESC LIMIT 1",
                )
                .bind(&board_id)
                .bind(column_id)
                .fetch_optional(&mut *tx)
                .await?;
                prev_pos = last.map(|(p,)| p);
                next_pos = None;
            }
        }

        let new_pos = positioning::between(prev_pos.as_deref(), next_pos.as_deref());
        let now = now_ms();
        sqlx::query("UPDATE columns SET position = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(&new_pos)
            .bind(now)
            .bind(column_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;

        Self::get(pool, column_id)
            .await?
            .ok_or_else(|| KansoError::NotFound {
                entity: "column",
                id: column_id.to_string(),
            })
    }

    async fn neighbour_position(
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        board_id: &str,
        id: &str,
    ) -> Result<String> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT position FROM columns WHERE id = ?1 AND board_id = ?2")
                .bind(id)
                .bind(board_id)
                .fetch_optional(&mut **tx)
                .await?;
        row.map(|(p,)| p).ok_or_else(|| {
            KansoError::InvalidMove(format!("neighbour {id} not found in board {board_id}"))
        })
    }
}
