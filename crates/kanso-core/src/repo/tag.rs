use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::domain::Tag;
use crate::error::KansoError;
use crate::repo::{new_id, now_ms};
use crate::Result;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TagPatch {
    pub name: Option<String>,
    /// Outer `None` = leave untouched. Inner `None` = clear to NULL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Option<String>>,
}

pub struct TagRepo;

impl TagRepo {
    pub async fn create(pool: &SqlitePool, name: &str, color: Option<&str>) -> Result<Tag> {
        let id = new_id();
        let now = now_ms();
        let res = sqlx::query(
            "INSERT INTO tags (id, name, color, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?4)",
        )
        .bind(&id)
        .bind(name)
        .bind(color)
        .bind(now)
        .execute(pool)
        .await;

        match res {
            Ok(_) => Ok(Tag {
                id,
                name: name.to_string(),
                color: color.map(|s| s.to_string()),
                created_at: now,
                updated_at: now,
                archived_at: None,
            }),
            Err(e) if is_unique_violation(&e) => Err(KansoError::Conflict(format!(
                "tag name '{name}' already exists"
            ))),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn list(pool: &SqlitePool, include_archived: bool) -> Result<Vec<Tag>> {
        let sql = if include_archived {
            "SELECT * FROM tags ORDER BY name COLLATE NOCASE ASC"
        } else {
            "SELECT * FROM tags WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE ASC"
        };
        let rows = sqlx::query_as::<_, Tag>(sql).fetch_all(pool).await?;
        Ok(rows)
    }

    pub async fn get(pool: &SqlitePool, id: &str) -> Result<Tag> {
        sqlx::query_as::<_, Tag>("SELECT * FROM tags WHERE id = ?1")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| KansoError::NotFound {
                entity: "tag",
                id: id.to_string(),
            })
    }

    pub async fn update(pool: &SqlitePool, id: &str, patch: TagPatch) -> Result<Tag> {
        let now = now_ms();
        let mut qb = sqlx::QueryBuilder::new("UPDATE tags SET updated_at = ");
        qb.push_bind(now);
        if let Some(name) = &patch.name {
            qb.push(", name = ").push_bind(name);
        }
        if let Some(color) = &patch.color {
            qb.push(", color = ").push_bind(color.as_ref());
        }
        qb.push(" WHERE id = ").push_bind(id);
        let res = qb.build().execute(pool).await;
        match res {
            Ok(r) if r.rows_affected() == 0 => Err(KansoError::NotFound {
                entity: "tag",
                id: id.to_string(),
            }),
            Ok(_) => Self::get(pool, id).await,
            Err(e) if is_unique_violation(&e) => Err(KansoError::Conflict(format!(
                "tag name '{}' already exists",
                patch.name.as_deref().unwrap_or("")
            ))),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn archive(pool: &SqlitePool, id: &str) -> Result<()> {
        let now = now_ms();
        let res = sqlx::query("UPDATE tags SET archived_at = ?1, updated_at = ?1 WHERE id = ?2")
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(KansoError::NotFound {
                entity: "tag",
                id: id.to_string(),
            });
        }
        Ok(())
    }

    pub async fn unarchive(pool: &SqlitePool, id: &str) -> Result<()> {
        let now = now_ms();
        let res = sqlx::query("UPDATE tags SET archived_at = NULL, updated_at = ?1 WHERE id = ?2")
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(KansoError::NotFound {
                entity: "tag",
                id: id.to_string(),
            });
        }
        Ok(())
    }

    /// Hard delete. `card_tags` rows pointing at this tag are removed by
    /// `ON DELETE CASCADE`. Prefer [`archive`] for user-visible removals.
    pub async fn delete(pool: &SqlitePool, id: &str) -> Result<()> {
        let res = sqlx::query("DELETE FROM tags WHERE id = ?1")
            .bind(id)
            .execute(pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(KansoError::NotFound {
                entity: "tag",
                id: id.to_string(),
            });
        }
        Ok(())
    }
}

fn is_unique_violation(e: &sqlx::Error) -> bool {
    matches!(e, sqlx::Error::Database(db) if db.code().as_deref() == Some("2067") || db.message().contains("UNIQUE"))
}
