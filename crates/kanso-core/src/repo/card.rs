use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::domain::{Card, Tag};
use crate::error::KansoError;
use crate::positioning;
use crate::repo::{new_id, now_ms};
use crate::Result;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CardPatch {
    pub title: Option<String>,
    /// Outer `None` = leave untouched. Inner `None` = clear to NULL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_text: Option<Option<String>>,
    /// Outer `None` = leave untouched. Inner `None` = clear to NULL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_at: Option<Option<i64>>,
}

/// Snapshot of a card's body columns. `None` blobs mean the card has never
/// had its body set; callers should mount an empty editor in that case.
#[derive(Debug, Clone)]
pub struct CardBody {
    pub body_blocksuite: Option<Vec<u8>>,
    pub body_text: Option<String>,
    pub updated_at: i64,
}

/// A search hit enriched with the column + board the card belongs to.
/// Used by the Cmd+K palette to jump across boards without follow-up
/// queries.
#[derive(Debug, Clone)]
pub struct CardSearchHit {
    pub card: Card,
    pub column_id: String,
    pub column_name: String,
    pub board_id: String,
    pub board_name: String,
}

#[derive(sqlx::FromRow)]
struct SearchRow {
    card_id: String,
    card_column_id: String,
    title: String,
    body_text: Option<String>,
    position: String,
    due_at: Option<i64>,
    created_at: i64,
    updated_at: i64,
    col_id: String,
    col_name: String,
    board_id: String,
    board_name: String,
}

impl SearchRow {
    fn into_hit(self) -> CardSearchHit {
        CardSearchHit {
            card: Card {
                id: self.card_id,
                column_id: self.card_column_id,
                title: self.title,
                body_blocksuite: None,
                body_text: self.body_text,
                position: self.position,
                due_at: self.due_at,
                created_at: self.created_at,
                updated_at: self.updated_at,
            },
            column_id: self.col_id,
            column_name: self.col_name,
            board_id: self.board_id,
            board_name: self.board_name,
        }
    }
}

pub struct CardRepo;

impl CardRepo {
    pub async fn create(pool: &SqlitePool, column_id: &str, title: &str) -> Result<Card> {
        let last_pos: Option<(String,)> = sqlx::query_as(
            "SELECT position FROM cards WHERE column_id = ?1 ORDER BY position DESC LIMIT 1",
        )
        .bind(column_id)
        .fetch_optional(pool)
        .await?;
        let position = positioning::between(last_pos.as_ref().map(|(p,)| p.as_str()), None);

        let id = new_id();
        let now = now_ms();
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
        })
    }

    pub async fn get(pool: &SqlitePool, id: &str) -> Result<Option<Card>> {
        let row = sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE id = ?1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
        Ok(row)
    }

    pub async fn list_by_column(pool: &SqlitePool, column_id: &str) -> Result<Vec<Card>> {
        let rows = sqlx::query_as::<_, Card>(
            "SELECT * FROM cards WHERE column_id = ?1 ORDER BY position ASC",
        )
        .bind(column_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    pub async fn list_all(pool: &SqlitePool) -> Result<Vec<Card>> {
        let rows = sqlx::query_as::<_, Card>(
            "SELECT * FROM cards ORDER BY column_id ASC, position ASC, id ASC",
        )
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    pub async fn list_by_column_paged(
        pool: &SqlitePool,
        column_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Card>> {
        let rows = sqlx::query_as::<_, Card>(
            "SELECT * FROM cards WHERE column_id = ?1 \
             ORDER BY position ASC, id ASC LIMIT ?2 OFFSET ?3",
        )
        .bind(column_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    pub async fn update(pool: &SqlitePool, id: &str, patch: CardPatch) -> Result<Card> {
        let now = now_ms();
        let mut qb = sqlx::QueryBuilder::new("UPDATE cards SET updated_at = ");
        qb.push_bind(now);
        if let Some(title) = &patch.title {
            qb.push(", title = ").push_bind(title);
        }
        if let Some(body_text) = &patch.body_text {
            qb.push(", body_text = ").push_bind(body_text.as_ref());
        }
        if let Some(due_at) = patch.due_at {
            qb.push(", due_at = ").push_bind(due_at);
        }
        qb.push(" WHERE id = ").push_bind(id);
        let res = qb.build().execute(pool).await?;
        if res.rows_affected() == 0 {
            return Err(KansoError::NotFound {
                entity: "card",
                id: id.to_string(),
            });
        }
        Self::get(pool, id)
            .await?
            .ok_or_else(|| KansoError::NotFound {
                entity: "card",
                id: id.to_string(),
            })
    }

    /// Hard delete. FTS content is cleaned up by the `cards_fts_ad`
    /// trigger; `card_tags` rows cascade via ON DELETE CASCADE.
    pub async fn delete(pool: &SqlitePool, id: &str) -> Result<()> {
        let res = sqlx::query("DELETE FROM cards WHERE id = ?1")
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

    /// Move `card_id` into `target_column_id` at the slot between `before`
    /// and `after`. Either neighbour may be `None` (append/prepend). When both
    /// are given they must be adjacent in the target column.
    ///
    /// Wrapped in a transaction so the neighbour read and the move write are
    /// atomic against concurrent moves on the same connection.
    pub async fn move_card(
        pool: &SqlitePool,
        card_id: &str,
        target_column_id: &str,
        before: Option<&str>,
        after: Option<&str>,
    ) -> Result<Card> {
        let mut tx = pool.begin().await?;

        let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM cards WHERE id = ?1")
            .bind(card_id)
            .fetch_optional(&mut *tx)
            .await?;
        if exists.is_none() {
            return Err(KansoError::NotFound {
                entity: "card",
                id: card_id.to_string(),
            });
        }

        let before_pos = match before {
            Some(id) => Some(Self::neighbour_position(&mut tx, target_column_id, id).await?),
            None => None,
        };
        let after_pos = match after {
            Some(id) => Some(Self::neighbour_position(&mut tx, target_column_id, id).await?),
            None => None,
        };

        let prev_pos: Option<String>;
        let next_pos: Option<String>;
        match (before_pos.as_deref(), after_pos.as_deref()) {
            (Some(b), Some(a)) => {
                if b >= a {
                    return Err(KansoError::InvalidMove(
                        "before must precede after in the target column".into(),
                    ));
                }
                let between_b_and_a: Option<(String,)> = sqlx::query_as(
                    "SELECT position FROM cards \
                     WHERE column_id = ?1 \
                       AND position > ?2 AND position < ?3 AND id != ?4 \
                     LIMIT 1",
                )
                .bind(target_column_id)
                .bind(b)
                .bind(a)
                .bind(card_id)
                .fetch_optional(&mut *tx)
                .await?;
                if between_b_and_a.is_some() {
                    return Err(KansoError::InvalidMove(
                        "before and after are not adjacent".into(),
                    ));
                }
                prev_pos = Some(b.to_string());
                next_pos = Some(a.to_string());
            }
            (Some(b), None) => {
                let next: Option<(String,)> = sqlx::query_as(
                    "SELECT position FROM cards \
                     WHERE column_id = ?1 \
                       AND position > ?2 AND id != ?3 \
                     ORDER BY position ASC LIMIT 1",
                )
                .bind(target_column_id)
                .bind(b)
                .bind(card_id)
                .fetch_optional(&mut *tx)
                .await?;
                prev_pos = Some(b.to_string());
                next_pos = next.map(|(p,)| p);
            }
            (None, Some(a)) => {
                let prev: Option<(String,)> = sqlx::query_as(
                    "SELECT position FROM cards \
                     WHERE column_id = ?1 \
                       AND position < ?2 AND id != ?3 \
                     ORDER BY position DESC LIMIT 1",
                )
                .bind(target_column_id)
                .bind(a)
                .bind(card_id)
                .fetch_optional(&mut *tx)
                .await?;
                prev_pos = prev.map(|(p,)| p);
                next_pos = Some(a.to_string());
            }
            (None, None) => {
                // Append: take the current last position in the target column,
                // excluding the moved card itself.
                let last: Option<(String,)> = sqlx::query_as(
                    "SELECT position FROM cards \
                     WHERE column_id = ?1 AND id != ?2 \
                     ORDER BY position DESC LIMIT 1",
                )
                .bind(target_column_id)
                .bind(card_id)
                .fetch_optional(&mut *tx)
                .await?;
                prev_pos = last.map(|(p,)| p);
                next_pos = None;
            }
        }

        let new_pos = positioning::between(prev_pos.as_deref(), next_pos.as_deref());
        let now = now_ms();
        sqlx::query(
            "UPDATE cards SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
        )
        .bind(target_column_id)
        .bind(&new_pos)
        .bind(now)
        .bind(card_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        Self::get(pool, card_id)
            .await?
            .ok_or_else(|| KansoError::NotFound {
                entity: "card",
                id: card_id.to_string(),
            })
    }

    async fn neighbour_position(
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        column_id: &str,
        id: &str,
    ) -> Result<String> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT position FROM cards WHERE id = ?1 AND column_id = ?2")
                .bind(id)
                .bind(column_id)
                .fetch_optional(&mut **tx)
                .await?;
        row.map(|(p,)| p).ok_or_else(|| {
            KansoError::InvalidMove(format!("neighbour {id} not found in column {column_id}"))
        })
    }

    /// Atomically write both columns of a card body and bump `updated_at`.
    /// `None` for either column clears it to NULL — this is PUT semantics, not
    /// PATCH. Returns `NotFound` if `id` does not exist.
    pub async fn set_body(
        pool: &SqlitePool,
        id: &str,
        body_blocksuite: Option<&[u8]>,
        body_text: Option<&str>,
    ) -> Result<()> {
        let now = now_ms();
        let mut tx = pool.begin().await?;
        let res = sqlx::query(
            "UPDATE cards SET body_blocksuite = ?1, body_text = ?2, updated_at = ?3 \
             WHERE id = ?4",
        )
        .bind(body_blocksuite)
        .bind(body_text)
        .bind(now)
        .bind(id)
        .execute(&mut *tx)
        .await?;

        if res.rows_affected() == 0 {
            return Err(KansoError::NotFound {
                entity: "card",
                id: id.to_string(),
            });
        }
        tx.commit().await?;
        Ok(())
    }

    /// Read the raw Yjs blob, plaintext, and current `updated_at` for `id`.
    /// `NotFound` if the card doesn't exist; both blob columns may be `None`
    /// on a card that has never had its body set.
    pub async fn get_body(pool: &SqlitePool, id: &str) -> Result<CardBody> {
        let row: Option<(Option<Vec<u8>>, Option<String>, i64)> = sqlx::query_as(
            "SELECT body_blocksuite, body_text, updated_at FROM cards WHERE id = ?1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;
        match row {
            Some((blob, text, updated_at)) => Ok(CardBody {
                body_blocksuite: blob,
                body_text: text,
                updated_at,
            }),
            None => Err(KansoError::NotFound {
                entity: "card",
                id: id.to_string(),
            }),
        }
    }

    pub async fn search(pool: &SqlitePool, query: &str) -> Result<Vec<Card>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let match_expr = fts5_quote(trimmed);
        let cards = sqlx::query_as::<_, Card>(
            "SELECT c.* FROM cards c \
             JOIN cards_fts f ON f.rowid = c.rowid \
             WHERE cards_fts MATCH ?1 \
             ORDER BY rank, c.updated_at DESC, c.id ASC",
        )
        .bind(match_expr)
        .fetch_all(pool)
        .await?;
        Ok(cards)
    }

    /// FTS5 search enriched with the column + board each hit lives in so
    /// search palettes can render `board · column` subtitles and jump
    /// across boards without a second round-trip per hit.
    pub async fn search_with_context(
        pool: &SqlitePool,
        query: &str,
    ) -> Result<Vec<CardSearchHit>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let match_expr = fts5_quote(trimmed);
        let rows = sqlx::query_as::<_, SearchRow>(
            "SELECT c.id          AS card_id, \
                    c.column_id   AS card_column_id, \
                    c.title       AS title, \
                    c.body_text   AS body_text, \
                    c.position    AS position, \
                    c.due_at      AS due_at, \
                    c.created_at  AS created_at, \
                    c.updated_at  AS updated_at, \
                    col.id        AS col_id, \
                    col.name      AS col_name, \
                    b.id          AS board_id, \
                    b.name        AS board_name \
             FROM cards c \
             JOIN cards_fts f ON f.rowid = c.rowid \
             JOIN columns col ON col.id = c.column_id \
             JOIN boards b ON b.id = col.board_id \
             WHERE cards_fts MATCH ?1 \
             ORDER BY rank, c.updated_at DESC, c.id ASC",
        )
        .bind(match_expr)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(SearchRow::into_hit).collect())
    }

    /// Paginated form of [`search_with_context`]. Same ordering and FTS rules.
    pub async fn search_with_context_paged(
        pool: &SqlitePool,
        query: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<CardSearchHit>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let match_expr = fts5_quote(trimmed);
        let rows = sqlx::query_as::<_, SearchRow>(
            "SELECT c.id          AS card_id, \
                    c.column_id   AS card_column_id, \
                    c.title       AS title, \
                    c.body_text   AS body_text, \
                    c.position    AS position, \
                    c.due_at      AS due_at, \
                    c.created_at  AS created_at, \
                    c.updated_at  AS updated_at, \
                    col.id        AS col_id, \
                    col.name      AS col_name, \
                    b.id          AS board_id, \
                    b.name        AS board_name \
             FROM cards c \
             JOIN cards_fts f ON f.rowid = c.rowid \
             JOIN columns col ON col.id = c.column_id \
             JOIN boards b ON b.id = col.board_id \
             WHERE cards_fts MATCH ?1 \
             ORDER BY rank, c.updated_at DESC, c.id ASC LIMIT ?2 OFFSET ?3",
        )
        .bind(match_expr)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(SearchRow::into_hit).collect())
    }

    /// Idempotently associate `card_id` with `tag_id`. Both entities must
    /// exist; otherwise returns `NotFound`. Re-linking is a no-op.
    pub async fn add_tag(pool: &SqlitePool, card_id: &str, tag_id: &str) -> Result<()> {
        let mut tx = pool.begin().await?;
        ensure_exists(&mut tx, "cards", "card", card_id).await?;
        ensure_exists(&mut tx, "tags", "tag", tag_id).await?;
        sqlx::query("INSERT OR IGNORE INTO card_tags (card_id, tag_id) VALUES (?1, ?2)")
            .bind(card_id)
            .bind(tag_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    /// Idempotently drop the (card, tag) link. Returns `NotFound` only when
    /// `card_id` or `tag_id` themselves do not exist; missing links succeed.
    pub async fn remove_tag(pool: &SqlitePool, card_id: &str, tag_id: &str) -> Result<()> {
        let mut tx = pool.begin().await?;
        ensure_exists(&mut tx, "cards", "card", card_id).await?;
        ensure_exists(&mut tx, "tags", "tag", tag_id).await?;
        sqlx::query("DELETE FROM card_tags WHERE card_id = ?1 AND tag_id = ?2")
            .bind(card_id)
            .bind(tag_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    /// Tags currently linked to `card_id`, alphabetised. `NotFound` if the
    /// card does not exist.
    pub async fn tags_for_card(pool: &SqlitePool, card_id: &str) -> Result<Vec<Tag>> {
        let mut tx = pool.begin().await?;
        ensure_exists(&mut tx, "cards", "card", card_id).await?;
        let rows = sqlx::query_as::<_, Tag>(
            "SELECT t.* FROM tags t \
             JOIN card_tags ct ON ct.tag_id = t.id \
             WHERE ct.card_id = ?1 \
             ORDER BY t.name COLLATE NOCASE ASC",
        )
        .bind(card_id)
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(rows)
    }

    /// Paginated form of [`tags_for_card`]. Same ordering + existence check.
    pub async fn tags_for_card_paged(
        pool: &SqlitePool,
        card_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Tag>> {
        let mut tx = pool.begin().await?;
        ensure_exists(&mut tx, "cards", "card", card_id).await?;
        let rows = sqlx::query_as::<_, Tag>(
            "SELECT t.* FROM tags t \
             JOIN card_tags ct ON ct.tag_id = t.id \
             WHERE ct.card_id = ?1 \
             ORDER BY t.name COLLATE NOCASE ASC, t.id ASC LIMIT ?2 OFFSET ?3",
        )
        .bind(card_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(rows)
    }

    /// Cards linked to `tag_id`, ordered by board layout (column position
    /// then card position) so callers receive them in the same order they
    /// appear visually on the board. `NotFound` if the tag does not exist.
    pub async fn cards_with_tag(pool: &SqlitePool, tag_id: &str) -> Result<Vec<Card>> {
        let mut tx = pool.begin().await?;
        ensure_exists(&mut tx, "tags", "tag", tag_id).await?;
        let rows = sqlx::query_as::<_, Card>(
            "SELECT c.* FROM cards c \
             JOIN card_tags ct ON ct.card_id = c.id \
             JOIN columns col ON col.id = c.column_id \
             WHERE ct.tag_id = ?1 \
             ORDER BY col.position ASC, c.position ASC",
        )
        .bind(tag_id)
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(rows)
    }

    /// Paginated form of [`cards_with_tag`]. Same ordering and existence check.
    pub async fn cards_with_tag_paged(
        pool: &SqlitePool,
        tag_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Card>> {
        let mut tx = pool.begin().await?;
        ensure_exists(&mut tx, "tags", "tag", tag_id).await?;
        let rows = sqlx::query_as::<_, Card>(
            "SELECT c.* FROM cards c \
             JOIN card_tags ct ON ct.card_id = c.id \
             JOIN columns col ON col.id = c.column_id \
             WHERE ct.tag_id = ?1 \
             ORDER BY col.position ASC, col.id ASC, c.position ASC, c.id ASC \
             LIMIT ?2 OFFSET ?3",
        )
        .bind(tag_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(rows)
    }

    /// Every `(card_id, tag_id)` link for a board. Walks `card_tags` joined
    /// through `cards`/`columns` and filters by `columns.board_id`. Returned
    /// pairs are ordered by `(card_id, tag_name, tag_id)` for determinism.
    ///
    /// Bounded by a generous 10_000-row hard cap as defense-in-depth — the
    /// link table is naturally tag-density-bounded, but if it ever grows past
    /// that, surface a `Conflict` so the UI can warn instead of OOMing.
    pub async fn card_tags_for_board<'e, E>(
        executor: E,
        board_id: &str,
    ) -> Result<Vec<(String, String)>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
    {
        const HARD_CAP: usize = 10_000;
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT ct.card_id, ct.tag_id FROM card_tags ct \
             JOIN cards c ON c.id = ct.card_id \
             JOIN columns col ON col.id = c.column_id \
             JOIN tags t ON t.id = ct.tag_id \
             WHERE col.board_id = ?1 \
             ORDER BY ct.card_id, t.name COLLATE NOCASE ASC, ct.tag_id \
             LIMIT ?2",
        )
        .bind(board_id)
        .bind((HARD_CAP + 1) as i64)
        .fetch_all(executor)
        .await?;
        if rows.len() > HARD_CAP {
            return Err(KansoError::Conflict(format!(
                "board has more than {HARD_CAP} card-tag links; refusing to load"
            )));
        }
        Ok(rows)
    }

    pub async fn card_tags_all(pool: &SqlitePool) -> Result<Vec<(String, String)>> {
        let rows = sqlx::query_as(
            "SELECT card_id, tag_id FROM card_tags ORDER BY card_id ASC, tag_id ASC",
        )
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }
}

async fn ensure_exists(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    table: &str,
    entity: &'static str,
    id: &str,
) -> Result<()> {
    let sql = format!("SELECT 1 FROM {table} WHERE id = ?1");
    let row: Option<(i64,)> = sqlx::query_as(&sql)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?;
    if row.is_none() {
        return Err(KansoError::NotFound {
            entity,
            id: id.to_string(),
        });
    }
    Ok(())
}

/// Wrap user input as a single FTS5 quoted phrase. FTS5 strings are escaped
/// by doubling embedded double quotes. This neutralises FTS5 operators
/// (`AND`, `OR`, `NOT`, `NEAR`, `*`, parens, column filters) so callers get
/// substring-style matching of the typed phrase.
fn fts5_quote(s: &str) -> String {
    let escaped = s.replace('"', "\"\"");
    format!("\"{escaped}\"")
}
