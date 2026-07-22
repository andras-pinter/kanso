use sqlx::SqlitePool;

use crate::domain::Column;
use crate::positioning;
use crate::repo::new_id;
use crate::Result;

/// The four fixed kanban columns, in seed order. Users cannot create,
/// rename, reorder, or delete columns — every board has exactly these.
pub const FIXED_COLUMNS: &[(&str, &str)] = &[
    ("Incoming", "#9c9084"),
    ("Todo", "#4d6ea9"),
    ("In Progress", "#c47a2f"),
    ("Done", "#5c8f6a"),
];

pub struct ColumnRepo;

impl ColumnRepo {
    pub async fn get(pool: &SqlitePool, id: &str) -> Result<Option<Column>> {
        let row = sqlx::query_as::<_, Column>("SELECT * FROM columns WHERE id = ?1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
        Ok(row)
    }

    pub async fn list_by_board(pool: &SqlitePool, board_id: &str) -> Result<Vec<Column>> {
        let rows = sqlx::query_as::<_, Column>(
            "SELECT * FROM columns WHERE board_id = ?1 ORDER BY position ASC",
        )
        .bind(board_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    pub async fn list_all(pool: &SqlitePool) -> Result<Vec<Column>> {
        let rows = sqlx::query_as::<_, Column>(
            "SELECT * FROM columns ORDER BY board_id ASC, position ASC, id ASC",
        )
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    pub async fn list_by_board_paged(
        pool: &SqlitePool,
        board_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Column>> {
        let rows = sqlx::query_as::<_, Column>(
            "SELECT * FROM columns WHERE board_id = ?1 \
             ORDER BY position ASC, id ASC LIMIT ?2 OFFSET ?3",
        )
        .bind(board_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Seed the four fixed columns for a new board inside the caller's
    /// transaction. Called by [`super::BoardRepo::create`] so column
    /// creation stays private — users cannot create columns.
    pub(crate) async fn seed_fixed_columns(
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        board_id: &str,
        now: i64,
    ) -> Result<Vec<Column>> {
        let mut prev: Option<String> = None;
        let mut out = Vec::with_capacity(FIXED_COLUMNS.len());
        for (name, color) in FIXED_COLUMNS {
            let position = positioning::between(prev.as_deref(), None);
            let id = new_id();
            sqlx::query(
                "INSERT INTO columns \
                 (id, board_id, name, position, color, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            )
            .bind(&id)
            .bind(board_id)
            .bind(name)
            .bind(&position)
            .bind(color)
            .bind(now)
            .execute(&mut **tx)
            .await?;
            out.push(Column {
                id,
                board_id: board_id.to_string(),
                name: (*name).to_string(),
                position: position.clone(),
                color: Some((*color).to_string()),
                created_at: now,
                updated_at: now,
            });
            prev = Some(position);
        }
        Ok(out)
    }
}
