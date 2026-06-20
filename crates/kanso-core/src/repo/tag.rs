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
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(KansoError::InvalidInput("tag name cannot be empty".into()));
        }
        let id = new_id();
        let now = now_ms();
        let res = sqlx::query(
            "INSERT INTO tags (id, name, color, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?4)",
        )
        .bind(&id)
        .bind(trimmed)
        .bind(color)
        .bind(now)
        .execute(pool)
        .await;

        match res {
            Ok(_) => Ok(Tag {
                id,
                name: trimmed.to_string(),
                color: color.map(|s| s.to_string()),
                created_at: now,
                updated_at: now,
                archived_at: None,
            }),
            Err(e) if is_tag_name_unique_violation(&e) => Err(KansoError::Conflict(format!(
                "tag name '{trimmed}' already exists"
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

    pub async fn list_paged(
        pool: &SqlitePool,
        include_archived: bool,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Tag>> {
        let sql = if include_archived {
            "SELECT * FROM tags ORDER BY name COLLATE NOCASE ASC LIMIT ?1 OFFSET ?2"
        } else {
            "SELECT * FROM tags WHERE archived_at IS NULL \
             ORDER BY name COLLATE NOCASE ASC LIMIT ?1 OFFSET ?2"
        };
        let rows = sqlx::query_as::<_, Tag>(sql)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await?;
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
        let trimmed_name = match patch.name.as_deref() {
            Some(n) => {
                let t = n.trim();
                if t.is_empty() {
                    return Err(KansoError::InvalidInput("tag name cannot be empty".into()));
                }
                Some(t.to_string())
            }
            None => None,
        };
        let now = now_ms();
        let mut qb = sqlx::QueryBuilder::new("UPDATE tags SET updated_at = ");
        qb.push_bind(now);
        if let Some(name) = trimmed_name.as_deref() {
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
            Err(e) if is_tag_name_unique_violation(&e) => Err(KansoError::Conflict(format!(
                "tag name '{}' already exists",
                trimmed_name.as_deref().unwrap_or("")
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

/// True only when the error is SQLITE_CONSTRAINT_UNIQUE on `tags.name`.
/// We require both the extended code (2067) and a mention of the actual
/// constrained column so future UNIQUE constraints on `tags` don't get
/// silently folded into "tag name already exists".
fn is_tag_name_unique_violation(e: &sqlx::Error) -> bool {
    let sqlx::Error::Database(db) = e else {
        return false;
    };
    let code_ok = db
        .code()
        .as_deref()
        .map(|c| c == "2067" || c == "19")
        .unwrap_or(false);
    code_ok && db.message().contains("tags.name")
}
