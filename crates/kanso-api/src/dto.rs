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
use kanso_core::repo::{BoardFull, BoardPatch, CardPatch, TagPatch};

// ---------- Board ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardDto {
    pub id: String,
    pub name: String,
    pub position: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
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
        }
    }
}

// ---------- Card ----------

/// Full card wire format. Only used by the dedicated single-card endpoint
/// (`GET /cards/:id`) — everything else (list/search/board snapshot, plus
/// create/update/move/put_body responses) returns [`CardListDto`] to keep
/// wire size independent of body length.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardDto {
    pub id: String,
    pub column_id: String,
    pub title: String,
    pub body_markdown: Option<String>,
    pub position: String,
    pub due_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Card> for CardDto {
    fn from(c: Card) -> Self {
        Self {
            id: c.id,
            column_id: c.column_id,
            title: c.title,
            body_markdown: c.body_markdown,
            position: c.position,
            due_at: c.due_at,
            created_at: c.created_at,
            updated_at: c.updated_at,
        }
    }
}

/// Card metadata without the markdown body. `has_body` is `true` when the
/// card has a non-blank body (whitespace-only counts as empty). Fetch the
/// full markdown via `GET /cards/:id/body` when needed. All list/board/
/// search endpoints and every write endpoint return this shape so payload
/// size stays bounded regardless of how large individual card bodies grow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardListDto {
    pub id: String,
    pub column_id: String,
    pub title: String,
    pub has_body: bool,
    pub position: String,
    pub due_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Card> for CardListDto {
    fn from(c: Card) -> Self {
        let has_body = c
            .body_markdown
            .as_deref()
            .is_some_and(|s| !s.trim().is_empty());
        Self {
            id: c.id,
            column_id: c.column_id,
            title: c.title,
            has_body,
            position: c.position,
            due_at: c.due_at,
            created_at: c.created_at,
            updated_at: c.updated_at,
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
    pub body_markdown: Option<Option<String>>,
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
            body_markdown: d.body_markdown,
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
/// a follow-up lookup per result. The embedded card is [`CardListDto`] —
/// call the body endpoint if you need the markdown for a specific hit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardSearchHitDto {
    pub card: CardListDto,
    pub column_id: String,
    pub column_name: String,
    pub board_id: String,
    pub board_name: String,
}

impl From<kanso_core::repo::CardSearchHit> for CardSearchHitDto {
    fn from(h: kanso_core::repo::CardSearchHit) -> Self {
        Self {
            card: CardListDto::from(h.card),
            column_id: h.column_id,
            column_name: h.column_name,
            board_id: h.board_id,
            board_name: h.board_name,
        }
    }
}

// ---------- Card body (markdown) ----------

/// Response shape for `GET /cards/:id/body`. Mirrors the Tauri command
/// `card_body_get`. `body_markdown` is `None` until the card has been
/// edited for the first time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardBodyDto {
    /// Card body as CommonMark markdown. Also serves as the FTS payload —
    /// FTS5's `unicode61` tokenizer strips `#`, `-`, `*`, `` ` `` etc. as
    /// non-word chars, so search "just works" on raw markdown.
    pub body_markdown: Option<String>,
    pub updated_at: i64,
}

/// Request shape for `PUT /cards/:id/body`. `body_markdown` is required;
/// pass an empty string to clear the body to NULL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardBodySetDto {
    pub body_markdown: String,
}

// ---------- Tag ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagDto {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Tag> for TagDto {
    fn from(t: Tag) -> Self {
        Self {
            id: t.id,
            name: t.name,
            color: t.color,
            created_at: t.created_at,
            updated_at: t.updated_at,
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

// ---------- Card→Tag links ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardTagLinkDto {
    pub card_id: String,
    pub tag_id: String,
}

// ---------- Board (full snapshot) ----------

/// Card payload inside [`ColumnWithCardsDto`]. `tag_ids` references
/// [`BoardFullDto::tags`] so the wire format avoids duplicating tag rows.
/// The embedded card is [`CardListDto`] — call `GET /cards/:id/body` for
/// the markdown of a specific card in the snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardWithTagIdsDto {
    pub card: CardListDto,
    pub tag_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnWithCardsDto {
    pub column: ColumnDto,
    pub cards: Vec<CardWithTagIdsDto>,
}

/// Response shape for `GET /boards/:id/_full`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardFullDto {
    pub board: BoardDto,
    pub tags: Vec<TagDto>,
    pub columns: Vec<ColumnWithCardsDto>,
}

impl From<BoardFull> for BoardFullDto {
    fn from(f: BoardFull) -> Self {
        Self {
            board: BoardDto::from(f.board),
            tags: f.tags.into_iter().map(TagDto::from).collect(),
            columns: f
                .columns
                .into_iter()
                .map(|c| ColumnWithCardsDto {
                    column: ColumnDto::from(c.column),
                    cards: c
                        .cards
                        .into_iter()
                        .map(|cwt| CardWithTagIdsDto {
                            card: CardListDto::from(cwt.card),
                            tag_ids: cwt.tag_ids,
                        })
                        .collect(),
                })
                .collect(),
        }
    }
}
