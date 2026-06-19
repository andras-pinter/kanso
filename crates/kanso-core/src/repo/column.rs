use sqlx::SqlitePool;

use crate::domain::Column;
use crate::positioning;
use crate::repo::{new_id, now_ms};
use crate::Result;

pub struct ColumnRepo;

impl ColumnRepo {
    pub async fn create(pool: &SqlitePool, board_id: &str, name: &str) -> Result<Column> {
        let id = new_id();
        let now = now_ms();
        let position = positioning::between(None, None);
        sqlx::query(
            "INSERT INTO columns (id, board_id, name, position, color, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?5)",
        )
        .bind(&id)
        .bind(board_id)
        .bind(name)
        .bind(&position)
        .bind(now)
        .execute(pool)
        .await?;

        Ok(Column {
            id,
            board_id: board_id.to_string(),
            name: name.to_string(),
            position,
            color: None,
            created_at: now,
            updated_at: now,
            archived_at: None,
        })
    }
}
