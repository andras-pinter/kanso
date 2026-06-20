//! Wire-format DTOs shared by the axum router and the Tauri command layer.
//!
//! These live in `kanso-api` because HTTP is the canonical contract.
//! `kanso-tauri` re-uses them to guarantee a single shape per entity.

use serde::{Deserialize, Deserializer, Serialize};

/// Distinguish "field absent" (outer `None`) from "field present and null"
/// (outer `Some(None)`) for patch DTOs. Default serde collapses both to `None`.
fn double_option<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(de).map(Some)
}

use kanso_core::domain::{Board, Card, Column, Tag};
use kanso_core::repo::{BoardPatch, CardPatch, ColumnPatch, TagPatch};

// ---------- Board ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardDto {
    pub id: String,
    pub name: String,
    pub position: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
}

impl From<Board> for BoardDto {
    fn from(b: Board) -> Self {
        Self {
            id: b.id,
            name: b.name,
            position: b.position,
            color: b.color,
            created_at: b.created_at,
            updated_at: b.updated_at,
            archived_at: b.archived_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateBoardBody {
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct BoardPatchDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "double_option"
    )]
    pub color: Option<Option<String>>,
}

impl From<BoardPatchDto> for BoardPatch {
    fn from(d: BoardPatchDto) -> Self {
        Self {
            name: d.name,
            color: d.color,
        }
    }
}

// ---------- Column ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDto {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub position: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
}

impl From<Column> for ColumnDto {
    fn from(c: Column) -> Self {
        Self {
            id: c.id,
            board_id: c.board_id,
            name: c.name,
            position: c.position,
            color: c.color,
            created_at: c.created_at,
            updated_at: c.updated_at,
            archived_at: c.archived_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateColumnBody {
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct ColumnPatchDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "double_option"
    )]
    pub color: Option<Option<String>>,
}

impl From<ColumnPatchDto> for ColumnPatch {
    fn from(d: ColumnPatchDto) -> Self {
        Self {
            name: d.name,
            color: d.color,
        }
    }
}

// ---------- Card ----------

/// Card wire format. `body_blocksuite` (binary YDoc state) is intentionally
/// omitted; Wave 5 will add a dedicated body get/set when wiring BlockSuite.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardDto {
    pub id: String,
    pub column_id: String,
    pub title: String,
    pub body_text: Option<String>,
    pub position: String,
    pub due_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
}

impl From<Card> for CardDto {
    fn from(c: Card) -> Self {
        Self {
            id: c.id,
            column_id: c.column_id,
            title: c.title,
            body_text: c.body_text,
            position: c.position,
            due_at: c.due_at,
            created_at: c.created_at,
            updated_at: c.updated_at,
            archived_at: c.archived_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCardBody {
    pub title: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct CardPatchDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Outer absent => leave untouched. Present `null` => clear. Present value => set.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "double_option"
    )]
    pub body_text: Option<Option<String>>,
    /// Outer absent => leave untouched. Present `null` => clear. Present value => set.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "double_option"
    )]
    pub due_at: Option<Option<i64>>,
}

impl From<CardPatchDto> for CardPatch {
    fn from(d: CardPatchDto) -> Self {
        Self {
            title: d.title,
            body_text: d.body_text,
            due_at: d.due_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct MoveCardBody {
    pub target_column_id: String,
    #[serde(default)]
    pub before: Option<String>,
    #[serde(default)]
    pub after: Option<String>,
}

/// FTS5 hit enriched with the board + column the card lives in.
/// Powers the Cmd+K palette so a click can jump across boards without
/// a follow-up lookup per result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardSearchHitDto {
    pub card: CardDto,
    pub column_id: String,
    pub column_name: String,
    pub board_id: String,
    pub board_name: String,
}

impl From<kanso_core::repo::CardSearchHit> for CardSearchHitDto {
    fn from(h: kanso_core::repo::CardSearchHit) -> Self {
        Self {
            card: CardDto::from(h.card),
            column_id: h.column_id,
            column_name: h.column_name,
            board_id: h.board_id,
            board_name: h.board_name,
        }
    }
}

// ---------- Card body (BlockSuite blob) ----------

/// Response shape for `GET /cards/:id/body`. Mirrors the Tauri command
/// `card_body_get`. Both blob fields are `None` until the card has been
/// edited for the first time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardBodyDto {
    /// Yjs `encodeStateAsUpdate` snapshot, base64 (STANDARD, padded).
    pub body_blocksuite_b64: Option<String>,
    /// Plaintext mirror used by FTS5.
    pub body_text: Option<String>,
    pub updated_at: i64,
}

/// Request shape for `PUT /cards/:id/body`. Always sets both columns
/// atomically — there is no patch semantics here.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardBodySetDto {
    pub body_blocksuite_b64: String,
    pub body_text: String,
}

// ---------- Tag ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagDto {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
}

impl From<Tag> for TagDto {
    fn from(t: Tag) -> Self {
        Self {
            id: t.id,
            name: t.name,
            color: t.color,
            created_at: t.created_at,
            updated_at: t.updated_at,
            archived_at: t.archived_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateTagBody {
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct TagPatchDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Outer absent => leave untouched. Present `null` => clear. Present value => set.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "double_option"
    )]
    pub color: Option<Option<String>>,
}

impl From<TagPatchDto> for TagPatch {
    fn from(d: TagPatchDto) -> Self {
        Self {
            name: d.name,
            color: d.color,
        }
    }
}

// ---------- Column reorder ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardTagLinkDto {
    pub card_id: String,
    pub tag_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MoveColumnBody {
    #[serde(default)]
    pub before: Option<String>,
    #[serde(default)]
    pub after: Option<String>,
}
