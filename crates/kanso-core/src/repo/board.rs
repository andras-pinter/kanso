use sqlx::SqlitePool;

use crate::domain::Board;
use crate::positioning;
use crate::repo::{new_id, now_ms};
use crate::Result;

pub struct BoardRepo;

impl BoardRepo {
    pub async fn create(pool: &SqlitePool, name: &str) -> Result<Board> {
        let id = new_id();
        let now = now_ms();
        let position = positioning::between(None, None);
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
}
