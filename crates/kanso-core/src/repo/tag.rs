use sqlx::SqlitePool;

use crate::domain::Tag;
use crate::repo::{new_id, now_ms};
use crate::Result;

pub struct TagRepo;

impl TagRepo {
    pub async fn create(pool: &SqlitePool, name: &str) -> Result<Tag> {
        let id = new_id();
        let now = now_ms();
        sqlx::query(
            "INSERT INTO tags (id, name, color, created_at, updated_at) \
             VALUES (?1, ?2, NULL, ?3, ?3)",
        )
        .bind(&id)
        .bind(name)
        .bind(now)
        .execute(pool)
        .await?;

        Ok(Tag {
            id,
            name: name.to_string(),
            color: None,
            created_at: now,
            updated_at: now,
            archived_at: None,
        })
    }
}
